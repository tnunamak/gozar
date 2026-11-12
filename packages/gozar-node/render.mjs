import { safeOrigin } from './catalog.mjs';

export function installLink(template, endpoint) {
  if (typeof template !== 'string' || !template.includes('{url}')) return null;
  try {
    const url = new URL(template.replaceAll('{url}', encodeURIComponent(endpoint)));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function render(reply, adapters, { alternatives = false, port } = {}) {
  const snapshot = reply.snapshot;
  if (!snapshot) return 'Status unknown. Run status to recheck the controller.';
  if (snapshot.phase === 'stopped') {
    const lines = ['Gozar · stopped', 'Exposure stopped.'];
    for (const failure of reply.localCleanupFailures ?? []) lines.push(`Cleanup needs attention: ${typeof failure === 'string' ? failure : JSON.stringify(failure)}`);
    if (reply.localCleanupFailures?.length) lines.push(`Retry: gozar stop --port ${port}`, 'Success: Exposure stopped, with no remaining cleanup failures.');
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
      lines.push('Route checks passed. Connect your MCP client.', 'Add to MCP client', `URL: ${mcpUrl}`,
        "Authentication: use your service's configured method.",
        'For gozar demo-server only, select no authentication.');
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
    lines.push('Route removal is not confirmed.', `Retry: gozar stop --port ${port}`, 'Success: Exposure stopped, with no remaining cleanup failures.');
  } else if (!['planned', 'stopped'].includes(snapshot.phase)) {
    const scope = port ? ` --port ${port}` : '';
    lines.push(`Status: gozar status${scope}`, `Stop: gozar stop${scope}`);
    if (snapshot.phase !== 'published-ready') lines.push(`Next: ${reply.nextAction?.command ?? `gozar health${scope}`}`, `Success: ${reply.nextAction?.expectedSuccess ?? 'route checks pass and a validated URL is printed.'}`);
    else lines.push(`After sleep or network loss: gozar health${scope}; if the route cannot recover, stop it and run expose again.`);
  }
  return lines.join('\n');
}

export function renderDetection(reply, adapters, activeIds = []) {
  const observations = reply.snapshot?.observations ?? {};
  const lines = ['Gozar · detection (read-only)'];
  for (const adapter of adapters) {
    const state = observations[adapter.id] ?? 'unknown';
    const next = !activeIds.includes(adapter.id);
    lines.push(`${adapter.displayName ?? adapter.label ?? adapter.id}: ${state === 'signed-out' ? 'blocked' : state}${next ? ' · NEXT DROP' : ' · validation required'}`);
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
