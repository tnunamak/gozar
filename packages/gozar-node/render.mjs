import { cliCommand } from './cli-command.mjs';
import { safeOrigin } from './catalog.mjs';
import { ways, trafficFacts } from './expose-copy.mjs';
import { plainCaveat, reachWords } from './plain-copy.mjs';

export function installLink(template, endpoint) {
  if (typeof template !== 'string' || !template.includes('{url}')) return null;
  try {
    const url = new URL(template.replaceAll('{url}', encodeURIComponent(endpoint)));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function renderEngineering(reply, adapters, { alternatives = false, port } = {}) {
  const snapshot = reply.snapshot;
  if (!snapshot) return `Status unknown. Run ${cliCommand('status', port)} to recheck the controller.`;
  if (snapshot.phase === 'stopped') {
    const lines = ['Gozar · stopped', 'Exposure stopped.'];
    for (const failure of reply.localCleanupFailures ?? []) lines.push(`Cleanup needs attention: ${typeof failure === 'string' ? failure : JSON.stringify(failure)}`);
    if (reply.localCleanupFailures?.length) lines.push(`Retry: ${reply.nextAction?.command ?? cliCommand('stop', port)}`, 'Success: Exposure stopped, with no remaining cleanup failures.');
    if (reply.journalPath) lines.push(`Local state: ${reply.journalPath}`);
    return lines.join('\n');
  }
  const recommendations = snapshot.recommendations ?? [];
  const first = recommendations[0];
  const id = typeof first === 'string' ? first : first?.adapterId ?? first?.id;
  const selected = adapters.find(adapter => adapter.id === (snapshot.adapterId ?? id));
  const lines = [`Gozar · ${snapshot.phase}`];
  if (selected) {
    const reason = id === selected.id && typeof first === 'object' ? first.reason : selected.copy?.reason ?? selected.reason;
    lines.push(`Recommended: ${selected.displayName ?? selected.label ?? selected.id}${reason ? ` — ${reason}` : ''}`);
  }
  if (recommendations.length > 1) {
    if (alternatives) lines.push(`Alternatives: ${recommendations.slice(1).map(item => {
      const key = typeof item === 'string' ? item : item.adapterId ?? item.id;
      return adapters.find(adapter => adapter.id === key)?.displayName ?? key;
    }).join(', ')}`);
    else lines.push(`${recommendations.length - 1} alternatives · use --alternatives`);
  }
  const plan = snapshot.plans?.find(plan => plan.adapterId === (snapshot.adapterId ?? id));
  if (snapshot.phase !== 'published-ready' && plan?.eligibility === 'needs-validation') lines.push(snapshot.phase === 'planned' ? 'Required transport and streaming checks run automatically after approval.' : 'Validation required before this route can be used.');
  const prerequisite = snapshot.phase === 'published-ready' || snapshot.observations?.[snapshot.adapterId ?? id] === 'present' ? undefined : plan?.preconditionActions?.[0];
  if (prerequisite) lines.push(`${prerequisite.label}: ${prerequisite.reason}`);
  const observations = snapshot.observations ?? {};
  const unknowns = Object.entries(observations).filter(([adapterId, observation]) => (alternatives || !selected || adapterId === selected.id) && ['unknown','blocked','signed-out'].includes(observation) && (alternatives || snapshot.phase !== 'published-ready'));
  for (const [adapterId, observation] of alternatives ? unknowns : unknowns.slice(0, 2)) {
    if (observation === 'unknown' || observation === 'blocked' || observation === 'signed-out') {
      const adapter = adapters.find(item => item.id === adapterId);
      lines.push(`${adapter?.displayName ?? adapterId}: ${observation === 'signed-out' ? 'blocked' : observation}. ${adapter?.copy?.fix ?? adapter?.fix ?? 'Check the route prerequisites, then run expose again.'}`);
    }
  }
  if (!alternatives && unknowns.length > 2) lines.push(`${unknowns.length - 2} more prerequisite checks · use --alternatives`);
  if (snapshot.published && snapshot.phase === 'published-ready') {
    let endpoint;
    try { endpoint = safeOrigin(snapshot.published); } catch { endpoint = null; }
    if (endpoint) {
      const mcpUrl = `${endpoint}/mcp`;
      lines.push('MCP setup (if your service supports /mcp):', 'Add to MCP client', `URL: ${mcpUrl}`,
        "Authentication: use your service's configured method.");
      lines.push('Your client connection and tool call still need checking.',
        'Keep this device and service awake. Route validation expires; sleep or network loss can interrupt access.');
      if (selected?.planVersion === 1) lines.push(`Instance proxy lifetime: up to ${(reply.lifetimeMs ?? 900_000) / 60_000} minutes. After expiry, run stop, then expose again.`);
      const template = reply.connectionProfile?.installLinkTemplate ?? selected?.clientProfile?.installLinkTemplate ?? selected?.profile?.installLinkTemplate;
      const link = installLink(template, mcpUrl);
      if (link) lines.push(`Install link: ${link}`);
      lines.push(JSON.stringify({ mcpServers: { service: { url: mcpUrl } } }, null, 2));
    }
  } else if (snapshot.candidate && snapshot.phase === 'candidate-ready') {
    lines.push(`Candidate: ${snapshot.candidate}`, 'Origin approval pending. This URL has not been published.');
  }
  const catalogUnknowns = new Set(adapters.flatMap(adapter => adapter.unknowns ?? []));
  const selectedUnknowns = new Set(selected?.unknowns ?? []);
  const limitations = (snapshot.limitations ?? []).filter(limitation => alternatives || !catalogUnknowns.has(limitation) || (!['planned', 'published-ready'].includes(snapshot.phase) && selectedUnknowns.has(limitation)));
  for (const limitation of alternatives ? limitations : limitations.slice(0, 2)) lines.push(limitation);
  if (!alternatives && limitations.length > 2) lines.push(`${limitations.length - 2} more route limitations · use --alternatives`);
  if (reply.action?.kind === 'external') lines.push(reply.action.instruction);
  if (reply.gateTarget) lines.push(`Proxy target for this instance: ${reply.gateTarget}`);
  if (reply.journalPath) lines.push(`Local state: ${reply.journalPath}`);
  if (snapshot.phase === 'cleanup-pending' || snapshot.phase === 'stopping') {
    lines.push('Route removal is not confirmed.', `Retry: ${reply.nextAction?.command ?? cliCommand('stop', port)}`, 'Success: Exposure stopped, with no remaining cleanup failures.');
  } else if (!['planned', 'stopped'].includes(snapshot.phase)) {
    lines.push(`Status: ${cliCommand('status', port)}`, `Stop: ${cliCommand('stop', port)}`);
    if (snapshot.phase !== 'published-ready') lines.push(`Next: ${reply.nextAction?.command ?? cliCommand('health', port)}`, `Success: ${reply.nextAction?.expectedSuccess ?? 'route checks pass and a validated URL is printed.'}`);
    else lines.push(`After sleep or network loss: ${cliCommand('health', port)}; if the route cannot recover, stop it and run expose again.`);
  }
  return lines.join('\n');
}


const adapterName = adapter => adapter?.displayName ?? adapter?.label ?? adapter?.id ?? 'selected service';
const adapterId = item => typeof item === 'string' ? item : item?.adapterId ?? item?.id;

function usableWays(snapshot, adapters) {
  const ids = (snapshot.recommendations ?? []).map(adapterId);
  return ids.map(id => adapters.find(a => a.id === id)).filter(a => a && ways[a.id] &&
    (a.ownership === 'external-owned' || a.recipes?.create));
}
function wayStatus(snapshot, adapter) {
  if (adapter.ownership === 'external-owned' && !adapter.endpoint) return 'needs setup';
  return ({ present: 'detected', absent: 'needs setup', 'signed-out': 'needs setup', blocked: 'needs setup' })[snapshot.observations?.[adapter.id]] ?? 'needs setup';
}
function alternativeRows(snapshot, adapters, selected, reach, target) {
  return [`Ways to make this reachable from ${reachWords[reach]}:`, ...usableWays(snapshot, adapters).map(a => {
    const way = ways[a.id], status = wayStatus(snapshot, a);
    const details = [rowFact(trafficFacts[a.id]), a.ownership === 'external-owned' ? plainCaveat(a.copy?.consent).plain : undefined].filter(Boolean);
    return `  ${a.id === selected?.id ? '●' : '○'} ${adapterName(a)} (${way.name})  ${status}  ${status === 'detected' ? `not yet checked; ${way.summary}` : way.setup.replaceAll('{target}', target)}${details.length ? `; ${details.join(' ')}` : ''}`;
  }), 'Pick one with --via <name>.'];
}
// A provider address with placeholders is a pattern; say so, and that the exact address comes after approval.
const addressLine = address => !address ? 'not known yet' : address.includes('<') ? `${address} (a pattern; the exact address comes after you approve)` : address;
// In a one-line row a traffic sentence becomes a clause: "The relay cannot read the traffic." -> "relay cannot read traffic".
const rowFact = text => text?.replace(/^The /, '').replace(/ the traffic/, ' traffic').replace(/\.$/, '');
function lifetime(reply, selected, port, options) {
  if (selected?.planVersion === 1) return `up to ${(reply.lifetimeMs ?? options.lifetimeMs ?? 900_000) / 60_000} minutes in the background`;
  return selected?.ownership === 'external-owned' ? `your address stays under your control; stop checking with ${cliCommand('stop', port)}` : `until you run ${cliCommand('stop', port)}`;
}
function chosenCaveats(snapshot, adapters, selected) {
  const catalog = new Set(adapters.flatMap(a => a.unknowns ?? []));
  const own = new Set(selected?.unknowns ?? []);
  return (snapshot.limitations ?? []).filter(text => !catalog.has(text) || own.has(text))
    .map(text => plainCaveat(text)).filter(item => item.plain);
}

export function render(reply, adapters, options = {}) {
  const { port, alternatives = false, verbose = false } = options;
  const snapshot = reply.snapshot;
  if (!snapshot) return `Status could not be checked. Run ${cliCommand('status', port)}.`;
  const selected = adapters.find(a => a.id === (snapshot.adapterId ?? adapterId(snapshot.recommendations?.[0])));
  const name = adapterName(selected), target = `http://127.0.0.1:${port ?? 'N'}`;
  const caveats = chosenCaveats(snapshot, adapters, selected);
  const failure = caveats.find(item => item.kind === 'failure');
  const failureText = failure?.plain ?? 'The route could not be verified. The cause was not recorded.';
  const inspect = `Inspect first: ${cliCommand('health', port)}`;
  const expose = `${cliCommand('expose', port)} --client-reach ${options.clientReach ?? 'internet'}`;
  const retry = `After stopping it and fixing the cause, retry: ${expose}`;
  const retryClean = `After fixing the cause, retry: ${expose}`;
  const cleanupWarning = 'Public access or a background process may remain. Cleanup is not confirmed.';
  const cleanupDone = "Cleanup confirmed: nothing Gozar created is still published. Your server's settings were not changed.";
  const cleanupConfirmed = snapshot.phase === 'stopped' && Array.isArray(reply.localCleanupFailures) && !reply.localCleanupFailures.length &&
    (snapshot.resources ?? []).every(resource => resource.ownership !== 'owned' || resource.cleanup === 'removed');
  const cleanupPending = ['cleanup-pending', 'stopping'].includes(snapshot.phase) || Boolean(reply.localCleanupFailures?.length);
  const lines = [];
  if (cleanupPending) {
    if (failure) lines.push(`✗ ${failureText}`);
    lines.push(cleanupWarning, `Stop: ${cliCommand('stop', port)}`, inspect);
  } else if (snapshot.phase === 'stopped') {
    if (failure) lines.push(`✗ ${failureText}`);
    if (cleanupConfirmed) lines.push(cleanupDone);
    else lines.push(cleanupWarning, `Stop: ${cliCommand('stop', port)}`);
    if (failure) lines.push(inspect, cleanupConfirmed ? retryClean : retry);
  } else if (snapshot.phase === 'planned') {
    if (alternatives) lines.push(...alternativeRows(snapshot, adapters, selected, options.clientReach ?? 'unknown', reply.gateTarget ?? target), '');
    lines.push(`Gozar will make ${target} reachable from ${reachWords[options.clientReach ?? 'unknown']} after its checks pass.`,
      `${['internet', 'unknown'].includes(options.clientReach ?? 'unknown') ? 'Anyone' : `Anyone on ${reachWords[options.clientReach]}`} with the address can reach it; Gozar adds no sign-in.`, '',
      `  Using    ${name}${snapshot.observations?.[selected?.id] === 'present' ? ' (set up on this computer; checked after you approve)' : ''}`,
      `  Address  ${selected?.endpoint ?? addressLine(ways[selected?.id]?.address)}`,
      `  Lasts    ${lifetime(reply, selected, port, options)}${selected?.planVersion === 1 ? '; the stop command below ends it sooner' : ''}`);
    if (trafficFacts[selected?.id] && !alternatives) lines.push(trafficFacts[selected.id]);
    const ownership = plainCaveat(selected?.copy?.consent).plain;
    if (ownership) lines.push(ownership);
    lines.push(`Stop: ${cliCommand('stop', port)}`);
    const note = caveats.find(item => item.decision);
    if (note) lines.push('', `  Note: ${note.plain}`);
    const others = usableWays(snapshot, adapters).filter(a => a.id !== selected?.id);
    if (!alternatives && others.length) lines.push('', `Other ways: ${others.map(a => `${adapterName(a).replace(/^Your /, 'your ')}`).join(', ')}. See --alternatives.`);
  } else if (snapshot.phase === 'published-ready' && snapshot.published) {
    let endpoint;
    try { endpoint = safeOrigin(snapshot.published); } catch { endpoint = null; }
    if (endpoint) {
      const receipt = reply.validation?.probeReceipt;
      const checks = [];
      if (receipt?.tls === true) checks.push(receipt.vantage === 'public' ? 'HTTPS answers from the internet' : 'HTTPS answers');
      if (receipt?.instanceMatched === true) checks.push('the address reaches this instance');
      if (receipt?.sse === true) checks.push('streaming works');
      lines.push(`Public URL: ${endpoint}`,
        `Checked: ${checks.length ? checks.join('; ') : 'no check results were recorded'}. Your app's own sign-in and requests are not checked.`,
        `Forwarding to ${target}`,
        selected?.planVersion === 1 ? `Lasts: ${lifetime(reply, selected, port, options)}. Stop sooner: ${cliCommand('stop', port)}` : `Lasts: ${lifetime(reply, selected, port, options)}`);
      // A client profile the user supplied (an install link template or a saved profile) says the target is an
      // MCP service; only then print the client setup. An adapter's own default profile is not that request.
      if (reply.connectionProfile) {
        const template = reply.connectionProfile.installLinkTemplate ?? selected?.clientProfile?.installLinkTemplate ?? selected?.profile?.installLinkTemplate;
        const mcpUrl = `${endpoint}/mcp`, link = installLink(template, mcpUrl);
        lines.push('', `MCP client URL: ${mcpUrl}`, ...(link ? [`Install link: ${link}`] : []),
          "Authentication: use your service's configured method. Your client connection and tool call still need checking.",
          JSON.stringify({ mcpServers: { service: { url: mcpUrl } } }));
      }
      lines.push(`After sleep or network loss: ${cliCommand('health', port)}`);
    } else lines.push('The saved address is invalid. Recheck the route.', `Next: ${cliCommand('health', port)}`);
  } else if (['failed', 'blocked', 'degraded'].includes(snapshot.phase)) {
    lines.push(`✗ ${failureText}`, cleanupWarning, `Stop: ${cliCommand('stop', port)}`, inspect, retry);
  } else if (snapshot.phase === 'unknown') {
    lines.push('The background controller could not be reached.', `Next: ${cliCommand('status', port)}`);
  } else {
    lines.push(snapshot.phase === 'candidate-ready' ? `Address awaiting approval: ${snapshot.candidate ?? 'not assigned yet'}` : `${name}: ${snapshot.phase === 'needs-setup' ? 'setup needed' : 'checking the route'}.`);
    const action = snapshot.plans?.find(plan => plan.adapterId === selected?.id)?.preconditionActions?.[0];
    const setup = action && plainCaveat(action.reason);
    if (setup?.plain) lines.push(setup.plain);
    if (failure) lines.push(failure.plain);
    if (reply.gateTarget && selected?.ownership === 'external-owned') lines.push(`Point your HTTPS proxy to ${reply.gateTarget}.`);
    lines.push(`Next: ${cliCommand('health', port)}`, `Stop: ${cliCommand('stop', port)}`);
  }
  if (verbose) {
    lines.push('', 'Full detail:', renderEngineering(reply, adapters, { port, alternatives: true }));
    if (selected?.copy?.consent) lines.push(selected.copy.consent);
    // The old stopped screen omitted limitations; retain them in the detail view too.
    if (snapshot.phase === 'stopped') lines.push(...(snapshot.limitations ?? []));
  }
  return lines.join('\n');
}

export function renderDetection(reply, adapters, activeIds = []) {
  const observations = reply.snapshot?.observations ?? {};
  const lines = ['Gozar · detection (read-only)'];
  for (const adapter of adapters) {
    const state = observations[adapter.id] ?? 'unknown';
    const next = !activeIds.includes(adapter.id);
    lines.push(`${adapter.displayName ?? adapter.label ?? adapter.id}: ${state === 'signed-out' ? 'blocked' : state}${next ? ' · unavailable in this version' : ' · validation required'}`);
    lines.push('  Login: unknown unless verified by account-state evidence. Capability: unknown until required probes pass.');
    if (['unknown', 'blocked', 'signed-out'].includes(state)) {
      const fix = adapter.copy?.fix ?? adapter.fix;
      if (fix) lines.push(`  ${fix}`);
    }
  }
  lines.push('A detected CLI is not a verified public route.');
  return lines.join('\n');
}

// Presentation policy for the active drop; the opaque core state remains unchanged.
export function exposeSnapshot(snapshot, activeIds) {
  if (!snapshot) return snapshot;
  const active = new Set(activeIds);
  const observations = Object.fromEntries(Object.entries(snapshot.observations ?? {}).filter(([id]) => active.has(id)));
  return { ...snapshot,
    recommendations: (snapshot.recommendations ?? []).filter(item => active.has(typeof item === 'string' ? item : item.adapterId ?? item.id)),
    observations,
    plans: (snapshot.plans ?? []).filter(plan => active.has(plan.adapterId)).map(plan => ({ ...plan,
      preconditionActions: observations[plan.adapterId] === 'present' ? [] : plan.preconditionActions,
    })),
  };
}
