// Fake `tailscale` CLI for durable-route tests. State lives in FAKE_TAILSCALE_STATE.
// It models only what durable routes use: status, serve status, serve/funnel --bg and serve off.
// `etag` is an internal version counter, like the LocalAPI serve-config ETag; as in the real
// CLI, `serve status --json` does not print it.
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.env.FAKE_TAILSCALE_STATE;
const state = JSON.parse(readFileSync(path, 'utf8'));
const args = process.argv.slice(2);
state.audit.push(args);
const save = () => writeFileSync(path, JSON.stringify(state));
const out = value => { save(); process.stdout.write(JSON.stringify(value)); };
const flag = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
// Simulate the calling process crashing around a mutation.
const crash = () => { save(); process.kill(process.ppid, 'SIGKILL'); process.exit(1); };

if (args[0] === 'status') {
  const capMap = { funnel: null, https: null };
  if (state.funnelPorts.length) capMap[`https://tailscale.com/cap/funnel-ports?ports=${state.funnelPorts.join(',')}`] = null;
  out({ BackendState: state.backendState, Self: { ID: state.nodeId, DNSName: state.dnsName + '.', CapMap: capMap },
    CurrentTailnet: { StableID: 'tailnet-test', MagicDNSSuffix: 'tailnet.test', MagicDNSEnabled: true } });
} else if (args[0] === 'serve' && args[1] === 'status') {
  out(state.config);
} else if (['serve', 'funnel'].includes(args[0])) {
  const port = Number(flag('https'));
  const hostPort = `${state.dnsName}:${port}`;
  const config = state.config;
  if (args.at(-1) === 'off') {
    // Another program edits this listener after the caller's readback. The real CLI reads a
    // fresh ETag itself, so its removal then deletes the edited rule.
    if (state.raceBeforeOff) { config.Web[hostPort] = { Handlers: { '/': { Proxy: state.raceBeforeOff.proxy } } }; state.raceBeforeOff = null; state.etag++; }
    for (const [key, field] of [['TCP', String(port)], ['Web', hostPort], ['AllowFunnel', hostPort]]) {
      if (!config[key]) continue;
      delete config[key][field];
      if (!Object.keys(config[key]).length) delete config[key];
    }
  } else {
    if (!args.includes('--bg') || flag('set-path') !== '/') { save(); process.exit(2); }
    if (state.createDelayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, state.createDelayMs);
    if (state.crash === 'before-apply') { state.crash = null; crash(); }
    // Like the real CLI, a new rule replaces what is on that port: refusing is the caller's job.
    const proxy = state.createProxy ?? args.at(-1);
    (config.TCP ??= {})[port] = { HTTPS: true };
    (config.Web ??= {})[hostPort] = { Handlers: { '/': { Proxy: proxy } } };
    if (args[0] === 'funnel') (config.AllowFunnel ??= {})[hostPort] = true;
    state.etag++;
    if (state.crash === 'after-apply') { state.crash = null; crash(); }
  }
  if (args.at(-1) === 'off') state.etag++;
  save();
} else { save(); process.exit(2); }
