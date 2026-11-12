#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir, networkInterfaces } from 'node:os';
import { readFile, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { loadCatalog, loadDefinition, loadActiveDrop, loadDropRequirements, safeOrigin } from '../packages/gozar-node/catalog.mjs';
import { loadCore } from '../packages/gozar-node/core.mjs';
import { Journal, atomicWrite } from '../packages/gozar-node/journal.mjs';
import { EffectDriver } from '../packages/gozar-node/driver.mjs';
import { Controller } from '../packages/gozar-node/controller.mjs';
import { control, launch, serve, recoverStop, stopSession } from '../packages/gozar-node/daemon.mjs';
import { render, renderDetection, exposeSnapshot, installLink } from '../packages/gozar-node/render.mjs';
import { validateLifetimeMs } from '../packages/gozar-node/gate.mjs';
import { selectedInterfaceAddress } from '../packages/gozar-node/interfaces.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reaches = ['internet', 'tailnet', 'lan', 'this-device', 'unknown'];
export function parseArgs(argv) {
  const options = { command: argv[0] ?? 'help', clientReach: 'unknown' };
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (['--yes', '--json', '--alternatives', '--operational', '--sse', '--streamable-http', '--oauth-dcr', '--observe-process-output'].includes(flag)) options[flag.slice(2)] = true;
    else if (['--port', '--client-reach', '--origin', '--adapter', '--bind-address', '--firewall-ack', '--client-profile', '--install-link-template', '--transport', '--local-name', '--probe-directory', '--probe-request', '--probe-receipt', '--probe-executor-id', '--probe-wait-ms', '--lifetime-ms'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      options[{ '--port': 'port', '--client-reach': 'clientReach', '--origin': 'origin', '--adapter': 'adapterId', '--bind-address': 'bindAddress', '--firewall-ack': 'firewallAck', '--client-profile': 'clientProfileId', '--install-link-template': 'installLinkTemplate', '--transport': 'transport', '--local-name': 'localName', '--probe-directory': 'probeDirectory', '--probe-request': 'probeRequest', '--probe-receipt': 'probeReceipt', '--probe-executor-id': 'probeExecutorId', '--probe-wait-ms': 'probeWaitMs', '--lifetime-ms': 'lifetimeMs' }[flag]] = value;
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (!['expose', 'detect', 'status', 'health', 'update-origin', 'stop', 'demo-server', 'help', '--help'].includes(options.command)) throw new Error('Use expose, detect, status, stop or demo-server');
  if (options.port !== undefined) {
    if (!/^\d+$/.test(options.port) || Number(options.port) < (options.command === 'demo-server' ? 0 : 1) || Number(options.port) > 65535) throw new Error('--port must be 1..65535');
    options.port = Number(options.port);
  }
  if (options.lifetimeMs !== undefined) {
    if (options.command !== 'expose' || !/^\d+$/.test(options.lifetimeMs)) throw new Error('--lifetime-ms is for expose and must be 1..2147483647');
    options.lifetimeMs = validateLifetimeMs(Number(options.lifetimeMs));
  }
  if (!reaches.includes(options.clientReach)) throw new Error(`--client-reach must be ${reaches.join('|')}`);
  if (options.origin) options.origin = safeOrigin(options.origin);
  if (options.bindAddress && !selectedInterfaceAddress(options.bindAddress)) throw new Error('--bind-address must name one unicast non-loopback interface address');
  if (options.firewallAck && options.firewallAck !== options.bindAddress) throw new Error('--firewall-ack must match the exact --bind-address');
  if (options.probeWaitMs !== undefined) {
    if (!/^\d+$/.test(options.probeWaitMs) || Number(options.probeWaitMs) < 1000 || Number(options.probeWaitMs) > 600000) throw new Error('--probe-wait-ms must be 1000..600000');
    options.probeWaitMs = Number(options.probeWaitMs);
  }
  if ((options.probeRequest || options.probeReceipt) && (!options.probeRequest || !options.probeReceipt || !options.probeExecutorId || dirname(resolve(options.probeRequest)) !== dirname(resolve(options.probeReceipt)))) throw new Error('Trusted fixed probe channel requires same-directory --probe-request, --probe-receipt and --probe-executor-id');
  if (options.probeExecutorId && !/^[A-Za-z0-9_.:-]{1,128}$/.test(options.probeExecutorId)) throw new Error('Invalid probe executor identity');
  if (options.localName && (options.localName.length > 253 || !options.localName.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)))) throw new Error('--local-name must be a DNS name; client resolution still requires verification');
  if (options.transport && !['http', 'https', 'tls', 'tcp'].includes(options.transport)) throw new Error('--transport must be http|https|tls|tcp');
  if (options.installLinkTemplate && !installLink(options.installLinkTemplate, 'https://endpoint.example/mcp')) throw new Error('--install-link-template requires a credential-free HTTPS template containing {url}');
  return options;
}

async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await prompt.question(question)).trim(); } finally { prompt.close(); }
}

export function clientRequirements(options, defaults = {}, profile = {}) {
  return {
    clientReach: options.clientReach,
    httpsRequired: options.clientReach === 'internet' || options.transport === 'https' || (defaults.httpsRequired === true && (!defaults.clientReach || defaults.clientReach === options.clientReach)) || profile.httpsRequired === true,
    sse: options.sse === true || defaults.sse === true || profile.sse === true,
    streamableHttp: options['streamable-http'] === true || defaults.streamableHttp === true || profile.streamableHttp === true,
    oauthDcr: options['oauth-dcr'] === true || defaults.oauthDcr === true || profile.oauthDcr === true,
  };
}

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'service') {
    const { serviceMain } = await import('../packages/gozar-node/service-cli.mjs');
    await serviceMain(argv.slice(1));
    return;
  }
  if (argv[0] === '--daemon') {
    const directory = argv[1];
    try { await serve(directory); }
    catch (error) { await atomicWrite(join(directory, 'failure.json'), { message: error.message }); process.exitCode = 1; }
    return;
  }
  const options = parseArgs(argv);
  if (options.command === 'demo-server') {
    const { startDummy } = await import('../harness/dummy-server.mjs');
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
    console.log('Service routes (existing owner-managed ingress):\n  gozar service add --origin URL --target HOST:PORT [--verify-cmd COMMAND] --json\n  gozar service status [--origin URL] --json\n  gozar service remove --origin URL --json\n');
    console.log('Gozar\n  gozar demo-server [--port N]\n  gozar expose --port N [--client-reach internet|tailnet|lan|this-device|unknown] [--origin URL] [--lifetime-ms N]\n  gozar detect --port N\n  gozar status [--port N]\n  gozar health [--port N]\n  gozar update-origin --origin URL [--port N]\n  gozar stop [--port N]\n\n--yes approves only the displayed selected route and exact loopback target.\n--adapter ID selects a catalog route. --json returns machine-readable status.\n--install-link-template HTTPS_TEMPLATE supplies a client install link using {url}; only the link is printed.\n--alternatives expands the route alternatives. No route is installed automatically.\n--probe-directory PATH selects the private challenge/receipt channel for the trusted outside verifier.\n--sse --streamable-http --oauth-dcr require those protocol checks; no inferred success.\n--operational opts into only the operational plans listed in the adapter manifest.\nLAN: --bind-address IP --firewall-ack IP records your exact-interface firewall approval.\n--transport http|https|tls|tcp and --client-profile ID select catalog data; unsupported modes remain blocked.');
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
  let adapters = await loadCatalog(root, { operational: true });
  const activeIds = await loadActiveDrop(root);
  if (options.adapterId && options.command === 'expose') {
    const operational = adapters.find(adapter => adapter.id === options.adapterId && adapter.planVersion === 1 && adapter.admission?.state === 'admitted');
    if (!activeIds.includes(options.adapterId) && !operational) throw new Error('Selected route is not available in this version. Run detect to see available routes.');
    const definition = await loadDefinition(root, options.adapterId);
    adapters = [...adapters.filter(adapter => adapter.id !== definition.id), definition];
  }
  const print = reply => {
    const view = options.command === 'detect' ? reply : { ...reply, snapshot: exposeSnapshot(reply.snapshot, activeIds) };
    if (['cleanup-pending', 'stopping'].includes(view.snapshot?.phase) || view.localCleanupFailures?.length) {
      view.nextAction = { command: `gozar stop --port ${options.port}`, expectedSuccess: 'Exposure stopped, with no remaining cleanup failures.' };
    } else if (view.snapshot?.phase === 'unknown') {
      view.nextAction = { command: `gozar expose --port ${options.port}`, expectedSuccess: 'The guided setup starts a fresh controller for this service.' };
    } else if (['failed', 'blocked', 'degraded'].includes(view.snapshot?.phase)) {
      const immutableLoss = adapters.some(adapter => adapter.id === view.snapshot.adapterId && adapter.originPolicy === 'immutable') &&
        view.snapshot.lastRouteChange && !view.snapshot.candidate && !view.snapshot.published;
      if (view.action?.recheckCommand === 'stop' || immutableLoss) {
        if (immutableLoss && view.action?.recheckCommand !== 'stop') view.action = { kind: 'external', instruction: 'Stop the current session and start a new route.', recheckCommand: 'stop' };
        view.nextAction = { command: `gozar stop --port ${options.port}`, expectedSuccess: 'Stop the session, then start a new route.' };
      } else {
        view.nextAction = { command: `gozar health --port ${options.port}`, expectedSuccess: 'Route checks pass and a validated URL is printed.' };
      }
    }
    console.log(options.json ? JSON.stringify(view) : render(view, adapters, options));
  };
  if (['status', 'health', 'update-origin', 'stop'].includes(options.command)) {
    try { print(options.command === 'stop' ? await stopSession(directory) : await control(directory, { type: options.command, ...(options.command === 'update-origin' ? { origin: options.origin } : {}) }, 120_000)); }
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
  if (options.origin) {
    const external = adapters.filter(adapter => adapter.ownership === 'external-owned' && (!options.adapterId || adapter.id === options.adapterId));
    if (external.length !== 1) throw new Error('--origin requires exactly one external-owned catalog route');
    external[0].endpoint = options.origin; options.adapterId = external[0].id;
  }
  const defaults = options.command === 'expose' ? await loadDropRequirements(root) : {};
  const requirements = clientRequirements(options, defaults);
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
  Object.assign(requirements, clientRequirements(options, defaults));
  if (options.clientReach === 'internet' && options.transport === 'http') throw new Error('Internet clients require public HTTPS. Run again with --transport https.');
  const planned = await planner.command({ type: 'recommend' });
  if (options.command === 'detect' && !options.json) console.log(renderDetection({ snapshot: planned.snapshot }, adapters, await loadActiveDrop(root)));
  else if (options.command === 'detect') print({ snapshot: planned.snapshot, action: planned.action });
  if (options.command === 'detect') return;
  const recommendation = planned.snapshot.recommendations?.find(item => activeIds.includes(typeof item === 'string' ? item : item.adapterId));
  const selectedId = options.adapterId ?? (typeof recommendation === 'string' ? recommendation : recommendation?.adapterId);
  if (!selectedId) throw new Error('No eligible route. Check the listed prerequisites and client requirements, then run expose again.');
  const selected = adapters.find(adapter => adapter.id === selectedId);
  if (!selected) throw new Error('Selected route is not in the admitted catalog');
  if (!options.json) print({ snapshot: { ...planned.snapshot, adapterId: selectedId }, action: planned.action });
  if (selected.ownership !== 'external-owned' && !selected.recipes?.create) throw new Error(`${selected.copy?.fix ?? selected.fix ?? 'This route has detection data only; no admitted create recipe is available.'}`);
  const clientProfile = options.clientProfileId ? selected.clientProfiles?.find(profile => profile.id === options.clientProfileId) : selected.clientProfile ?? selected.profile;
  if (options.clientProfileId && !clientProfile) throw new Error('Client profile is not in this route catalog record');
  if (clientProfile) { selected.clientProfile = clientProfile; }
  if (options.installLinkTemplate) selected.clientProfile = { ...selected.clientProfile, installLinkTemplate: options.installLinkTemplate };
  const profileRequirements = clientProfile?.clientRequirements;
  if (profileRequirements) Object.assign(requirements, clientRequirements(options, requirements, profileRequirements));
  if (requirements.httpsRequired && selected.capabilities?.https === false) throw new Error('This route provides HTTP. Configure a trusted HTTPS listener, then run expose with --origin https://your-service.example.');
  const interfaceInput = Object.values(selected.bindings ?? {}).some(binding => binding.type === 'selected-interface-address');
  const originInput = Object.values(selected.bindings ?? {}).some(binding => binding.type === 'credential-free-https-origin');
  const requestInput = async action => {
    if (options.json) console.log(JSON.stringify({ action }));
    else console.log(`${action.title}\n${action.instruction}`);
    process.exitCode = 2;
  };
  if (originInput && !options.origin) {
    await requestInput({ kind: 'input', field: 'origin', title: 'Choose the existing HTTPS origin', instruction: `Run gozar expose --port ${options.port} --origin https://your-service.example` }); return;
  }
  if (interfaceInput) {
    if (options.localName) throw new Error('Local-name routing needs separate DNS proof. Run again with --bind-address IP and omit --local-name.');
    const addresses = Object.values(networkInterfaces()).flat().filter(address => !address.internal && selectedInterfaceAddress(address.address)).map(address => address.address);
    if (!options.bindAddress) {
      if (!options.json && process.stdin.isTTY) {
        options.bindAddress = await ask(`Choose the exact interface address: ${addresses.join(', ')}\n> `);
        if (!addresses.includes(options.bindAddress)) throw new Error('Choose a listed interface address with --bind-address IP');
      } else { await requestInput({ kind: 'input', field: 'bindAddress', title: 'Choose a local network interface', choices: addresses, instruction: `Run gozar expose --port ${options.port} --client-reach ${options.clientReach} --bind-address IP` }); return; }
    }
    if (!addresses.includes(options.bindAddress)) throw new Error(`Selected interface is not currently assigned. Run expose --port ${options.port} --client-reach ${options.clientReach} without --bind-address to choose a current interface.`);
    for (const [key, flag, title] of [['firewallAck', '--firewall-ack', 'Approve inbound traffic on this exact interface and an ephemeral HTTP port']]) {
      if (options[key]) continue;
      if (!options.json && process.stdin.isTTY) {
        if (!['y', 'yes'].includes((await ask(`${title}: ${options.bindAddress}, forward to http://127.0.0.1:${options.port}? [y/N] `)).toLowerCase())) return;
        options[key] = options.bindAddress;
      } else { await requestInput({ kind: 'confirm', field: key, title, target: { bindAddress: options.bindAddress, port: 0, targetHost: '127.0.0.1', targetPort: options.port, scheme: 'http' }, instruction: `Repeat this command with ${flag} ${options.bindAddress}` }); return; }
    }
  }
  if (!options.json) console.log(`Target: http://127.0.0.1:${options.port}`);
  if (!options.json && selected.copy?.consent) console.log(selected.copy.consent);
  if (!options.yes) {
    if (!process.stdin.isTTY) throw new Error('Exposure requires approval. Review the selected route and run again with --yes.');
    if (!['y', 'yes'].includes((await ask(`Expose http://127.0.0.1:${options.port} using ${selected.displayName ?? selected.label ?? selected.id}? [y/N] `)).toLowerCase())) return;
  }
  const reply = await launch(directory, { adapters, requirements, targetPort: options.port, adapterId: selectedId,
    lifetimeMs: options.lifetimeMs, origin: options.origin, bindAddresses: options.bindAddress ? [options.bindAddress] : [], firewallApproved: Boolean(options.firewallAck), clientProfileId: options.clientProfileId, operational: selected.planVersion === 1, probeDirectory: options.probeRequest ? dirname(resolve(options.probeRequest)) : options.probeDirectory ?? process.env.GOZAR_PROBE_DIRECTORY, probeRequest: options.probeRequest && resolve(options.probeRequest), probeReceipt: options.probeReceipt && resolve(options.probeReceipt), probeExecutorId: options.probeExecutorId, probeWaitMs: options.probeWaitMs, observeProcessOutput: options['observe-process-output'] === true, consent: true, approveOrigin: true }, fileURLToPath(import.meta.url));
  await atomicWrite(join(home, 'last.json'), { port: options.port });
  print(reply);
  if (['failed', 'blocked', 'unknown', 'degraded', 'cleanup-pending'].includes(reply.snapshot?.phase)) process.exitCode = 1;
}

if (process.argv[1] && await realpath(resolve(process.argv[1])).catch(() => null) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const argv = process.argv.slice(2), port = argv[argv.indexOf('--port') + 1];
    if (argv[0] === 'service') {
      if (argv.includes('--json')) console.log(JSON.stringify({ schemaVersion: 1, error: { code: 'SERVICE_ERROR', message: error.message } }));
      else console.error(`Gozar service: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    const next = `gozar detect --port ${/^\d+$/.test(port ?? '') ? port : 'N'}`;
    if (argv.includes('--json')) console.log(JSON.stringify({ error: error.message, action: { kind: 'repair', instruction: `Run ${next} to inspect prerequisites.`, command: next, expectedSuccess: 'Detection lists route prerequisites for this service port.' } }));
    else console.error(`Gozar: ${error.message}\nNext: ${next}\nSuccess: detection lists route prerequisites for this service port.`);
    process.exitCode = 1;
  });
}
