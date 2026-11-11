#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { isIP } from 'node:net';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { readFile, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadCatalog, loadDefinition, loadActiveDrop, loadDropRequirements, safeOrigin } from '../packages/gozar-node/catalog.mjs';
import { loadCore } from '../packages/gozar-node/core.mjs';
import { Journal, atomicWrite } from '../packages/gozar-node/journal.mjs';
import { EffectDriver } from '../packages/gozar-node/driver.mjs';
import { Controller } from '../packages/gozar-node/controller.mjs';
import { control, launch, serve, recoverStop } from '../packages/gozar-node/daemon.mjs';
import { render, renderDetection, exposeSnapshot } from '../packages/gozar-node/render.mjs';
import { startDummy } from '../harness/dummy-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reaches = ['internet', 'tailnet', 'lan', 'this-device', 'unknown'];
export function parseArgs(argv) {
  const options = { command: argv[0] ?? 'help', clientReach: 'unknown' };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (['--yes', '--json', '--alternatives', '--operational', '--sse', '--streamable-http', '--oauth-dcr', '--observe-process-output'].includes(flag)) options[flag.slice(2)] = true;
    else if (['--port', '--client-reach', '--origin', '--adapter', '--bind-address', '--firewall-ack', '--client-profile', '--transport', '--local-name', '--probe-directory', '--probe-request', '--probe-receipt', '--probe-executor-id', '--probe-wait-ms'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      options[{ '--port': 'port', '--client-reach': 'clientReach', '--origin': 'origin', '--adapter': 'adapterId', '--bind-address': 'bindAddress', '--firewall-ack': 'firewallAck', '--client-profile': 'clientProfileId', '--transport': 'transport', '--local-name': 'localName', '--probe-directory': 'probeDirectory', '--probe-request': 'probeRequest', '--probe-receipt': 'probeReceipt', '--probe-executor-id': 'probeExecutorId', '--probe-wait-ms': 'probeWaitMs' }[flag]] = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!['expose', 'detect', 'status', 'health', 'update-origin', 'stop', 'demo-server', 'help', '--help'].includes(options.command)) throw new Error('Use expose, detect, status, stop or demo-server');
  if (options.port !== undefined) {
    if (!/^\d+$/.test(options.port) || Number(options.port) < (options.command === 'demo-server' ? 0 : 1) || Number(options.port) > 65535) throw new Error('--port must be 1..65535');
    options.port = Number(options.port);
  }
  if (!reaches.includes(options.clientReach)) throw new Error(`--client-reach must be ${reaches.join('|')}`);
  if (options.origin) options.origin = safeOrigin(options.origin);
  if (options.bindAddress && (!isIP(options.bindAddress) || ['0.0.0.0', '::', '127.0.0.1', '::1'].includes(options.bindAddress))) throw new Error('--bind-address must name one non-loopback interface address');
  if (options.firewallAck && options.firewallAck !== options.bindAddress) throw new Error('--firewall-ack must match the exact --bind-address');
  if (options.probeWaitMs !== undefined) {
    if (!/^\d+$/.test(options.probeWaitMs) || Number(options.probeWaitMs) < 1000 || Number(options.probeWaitMs) > 600000) throw new Error('--probe-wait-ms must be 1000..600000');
    options.probeWaitMs = Number(options.probeWaitMs);
  }
  if ((options.probeRequest || options.probeReceipt) && (!options.probeRequest || !options.probeReceipt || !options.probeExecutorId || dirname(resolve(options.probeRequest)) !== dirname(resolve(options.probeReceipt)))) throw new Error('Trusted fixed probe channel requires same-directory --probe-request, --probe-receipt and --probe-executor-id');
  if (options.probeExecutorId && !/^[A-Za-z0-9_.:-]{1,128}$/.test(options.probeExecutorId)) throw new Error('Invalid probe executor identity');
  if (options.localName && (options.localName.length > 253 || !options.localName.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)))) throw new Error('--local-name must be a DNS name; client resolution still requires verification');
  if (options.transport && !['http', 'https', 'tls', 'tcp'].includes(options.transport)) throw new Error('--transport must be http|https|tls|tcp');
  return options;
}

async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await prompt.question(question)).trim(); } finally { prompt.close(); }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === '--daemon') {
    const directory = argv[1];
    try { await serve(directory); }
    catch (error) { await atomicWrite(join(directory, 'failure.json'), { message: error.message }); process.exitCode = 1; }
    return;
  }
  const options = parseArgs(argv);
  if (options.command === 'demo-server') {
    const server = await startDummy({ port: options.port ?? 18765, toolName: 'echo' });
    const stop = async () => {
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
      await server.close();
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    console.log(`Echo MCP server listening on port ${server.port}: ${server.origin}`);
    return;
  }
  if (['help', '--help'].includes(options.command)) {
    console.log('Gozar\n  gozar demo-server [--port N]\n  gozar expose --port N [--client-reach internet|tailnet|lan|this-device|unknown] [--origin URL]\n  gozar detect --port N\n  gozar status [--port N]\n  gozar stop [--port N]\n\n--yes approves only the displayed selected route and exact loopback target.\n--adapter ID selects a catalog route. --json returns machine-readable status.\n--alternatives expands the route alternatives. No route is installed automatically.\n--probe-directory PATH selects the private challenge/receipt channel for the trusted outside verifier.\n--sse --streamable-http --oauth-dcr require those protocol checks; no inferred success.\n--operational opts into only the operational plans listed in the adapter manifest.\nLAN: --bind-address IP --firewall-ack IP records your exact-interface firewall approval.\n--transport http|https|tls|tcp and --client-profile ID select catalog data; unsupported modes remain blocked.');
    return;
  }
  const home = process.env.GOZAR_HOME ?? join(homedir(), '.local', 'state', 'gozar');
  if (!options.port && ['status', 'health', 'update-origin', 'stop'].includes(options.command)) {
    try { options.port = JSON.parse(await readFile(join(home, 'last.json'), 'utf8')).port; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!options.port) throw new Error('Supply the exact local service port with --port N');
  if (options.command === 'update-origin' && !options.origin) throw new Error('update-origin requires --origin with the exact new HTTPS origin');
  const directory = join(home, `port-${options.port}`);
  let adapters = await loadCatalog(root, { operational: options.operational === true || options.command === 'expose' });
  const activeIds = await loadActiveDrop(root);
  if (options.adapterId && options.command === 'expose') {
    if (!activeIds.includes(options.adapterId)) throw new Error('Selected mode is NEXT DROP. Run detect to see current mode states.');
    const definition = await loadDefinition(root, options.adapterId);
    adapters = [...adapters.filter(adapter => adapter.id !== definition.id), definition];
  }
  const print = reply => {
    const view = options.command === 'detect' ? reply : { ...reply, snapshot: exposeSnapshot(reply.snapshot, activeIds) };
    console.log(options.json ? JSON.stringify(view) : render(view, adapters, options));
  };
  if (['status', 'health', 'update-origin', 'stop'].includes(options.command)) {
    try { print(await control(directory, { type: options.command, ...(options.command === 'update-origin' ? { origin: options.origin } : {}) }, 120_000)); }
    catch (error) {
      if (options.command === 'stop') {
        try { print(await recoverStop(directory)); return; }
        catch (recoveryError) { error = recoveryError; }
      }
      const journal = new Journal(directory); await journal.load();
      // Historical state is useful for recovery, but never presented as current readiness.
      const debt = Object.keys(journal.value.owned).length;
      const reply = { snapshot: { phase: debt ? 'cleanup-pending' : 'unknown', candidate: null, published: null, limitations: [
        `Controller unavailable: ${error.message}`, ...(debt ? ['Owned resources remain recorded; restart reconciliation is required.'] : [])] }, journalPath: journal.path };
      print(reply); process.exitCode = 1;
    }
    return;
  }
  if (options.clientReach === 'unknown' && options.command === 'expose') {
    const question = 'Where does the app that will use this run?';
    if (!process.stdin.isTTY) {
      if (options.json) console.log(JSON.stringify({ action: { kind: 'choose', title: question, choices: reaches.slice(0, 4) } }));
      else console.log(`${question}\n${reaches.slice(0, 4).join(' | ')}\nFor an internet client, run: gozar expose --port ${options.port} --client-reach internet`);
      process.exitCode = 2; return;
    }
    options.clientReach = await ask(`${question}\n${reaches.slice(0, 4).join(' | ')}\n> `);
    if (!reaches.slice(0, 4).includes(options.clientReach)) throw new Error('Choose internet, tailnet, lan or this-device');
  }
  if (options.origin) {
    const external = adapters.filter(adapter => adapter.ownership === 'external-owned' && (!options.adapterId || adapter.id === options.adapterId));
    if (external.length !== 1) throw new Error('--origin requires one explicit external-owned catalog route selected with --adapter');
    external[0].endpoint = options.origin; options.adapterId = external[0].id;
  }
  if (options.clientReach === 'lan' && !options.json) {
    const addresses = Object.values(networkInterfaces()).flat().filter(address => !address.internal).map(address => address.address);
    console.log(`Local interfaces: ${addresses.join(', ') || 'none available'}`);
    console.log(`Local name candidate: ${options.localName ?? `${hostname().split('.')[0]}.local`} (check DNS/mDNS from your client).`);
    console.log('Choose an exact interface IP with --bind-address IP, or configure a client-reachable local name. HTTP stays HTTP; client-trusted TLS needs a separate configured listener.');
  }
  const requirements = { clientReach: options.clientReach, httpsRequired: options.clientReach === 'internet', sse: Boolean(options.sse), streamableHttp: Boolean(options['streamable-http']), oauthDcr: Boolean(options['oauth-dcr']) };
  if (options.transport) {
    // The current core protocol only models HTTP(S); never silently reinterpret passthrough as HTTPS.
    if (!['http', 'https'].includes(options.transport)) throw new Error('Selected transport needs an admitted core transport contract; no substitution is available.');
    if (options.clientReach === 'internet' && options.transport === 'http') throw new Error('Internet clients require public HTTPS.');
    requirements.httpsRequired = options.transport === 'https' || requirements.httpsRequired;
  }
  const step = await loadCore();
  // Detection has no prompts or mutation authority. Planner state is separate from the live session journal.
  const memoryJournal = { value: { owned: {}, intents: {} }, async save() {}, async intent() { throw new Error('Detection cannot persist mutation intents'); } };
  const planner = new Controller({ step, journal: memoryJournal, adapters, requirements, targetPort: options.port,
    driver: new EffectDriver({ adapters, journal: memoryJournal, targetPort: options.port, sessionId: 'planning' }), sessionId: 'planning' });
  await planner.command({ type: 'detect' });
  const planned = await planner.command({ type: 'recommend' });
  if (options.command === 'detect' && !options.json) console.log(renderDetection({ snapshot: planned.snapshot }, adapters, await loadActiveDrop(root)));
  else if (options.command === 'detect' || !options.json) print({ snapshot: planned.snapshot, action: planned.action });
  if (options.command === 'detect') return;
  const recommendation = planned.snapshot.recommendations?.find(item => activeIds.includes(typeof item === 'string' ? item : item.adapterId));
  const selectedId = options.adapterId ?? (typeof recommendation === 'string' ? recommendation : recommendation?.adapterId);
  if (!selectedId) throw new Error('No eligible route. Check the listed prerequisites and client requirements, then run expose again.');
  const selected = adapters.find(adapter => adapter.id === selectedId);
  if (!selected) throw new Error('Selected route is not in the admitted catalog');
  if (selected.ownership !== 'external-owned' && !selected.recipes?.create) throw new Error(`${selected.copy?.fix ?? selected.fix ?? 'This route has detection data only; no admitted create recipe is available.'}`);
  const dropRequirements = activeIds.includes(selectedId) ? await loadDropRequirements(root) : {};
  Object.assign(requirements, dropRequirements, { clientReach: options.clientReach, httpsRequired: requirements.httpsRequired || dropRequirements.httpsRequired === true, sse: requirements.sse || dropRequirements.sse === true, streamableHttp: requirements.streamableHttp || dropRequirements.streamableHttp === true, oauthDcr: requirements.oauthDcr || dropRequirements.oauthDcr === true });
  const clientProfile = options.clientProfileId ? selected.clientProfiles?.find(profile => profile.id === options.clientProfileId) : selected.clientProfile ?? selected.profile;
  if (options.clientProfileId && !clientProfile) throw new Error('Client profile is not in this route catalog record');
  const profileRequirements = clientProfile?.clientRequirements;
  if (profileRequirements) Object.assign(requirements, profileRequirements, { clientReach: options.clientReach, httpsRequired: options.clientReach === 'internet' || profileRequirements.httpsRequired === true, sse: requirements.sse || profileRequirements.sse === true, streamableHttp: requirements.streamableHttp || profileRequirements.streamableHttp === true, oauthDcr: requirements.oauthDcr || profileRequirements.oauthDcr === true });
  if (!options.json) console.log(`Target: http://127.0.0.1:${options.port}`);
  if (!options.json && selected.copy?.consent) console.log(selected.copy.consent);
  if (!options.yes) {
    if (!process.stdin.isTTY) throw new Error('Exposure requires approval. Review the selected route and run again with --yes.');
    if (!['y', 'yes'].includes((await ask(`Expose this exact target using ${selected.displayName ?? selected.id}? [y/N] `)).toLowerCase())) return;
  }
  const reply = await launch(directory, { adapters, requirements, targetPort: options.port, adapterId: selectedId,
    origin: options.origin, bindAddresses: options.bindAddress ? [options.bindAddress] : [], firewallApproved: Boolean(options.firewallAck), clientProfileId: options.clientProfileId, operational: selected.planVersion === 1, probeDirectory: options.probeRequest ? dirname(resolve(options.probeRequest)) : options.probeDirectory ?? process.env.GOZAR_PROBE_DIRECTORY, probeRequest: options.probeRequest && resolve(options.probeRequest), probeReceipt: options.probeReceipt && resolve(options.probeReceipt), probeExecutorId: options.probeExecutorId, probeWaitMs: options.probeWaitMs, observeProcessOutput: options['observe-process-output'] === true, consent: true, approveOrigin: true }, fileURLToPath(import.meta.url));
  await atomicWrite(join(home, 'last.json'), { port: options.port });
  print(reply);
}

if (process.argv[1] && await realpath(resolve(process.argv[1])).catch(() => null) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Gozar: ${error.message}`); process.exitCode = 1; });
}
