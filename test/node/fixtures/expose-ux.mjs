import { loadCatalog } from '../../../packages/gozar-node/catalog.mjs';
export const adapters = await loadCatalog(new URL('../../../', import.meta.url).pathname, { operational: true });
export const planned = { snapshot: {
  phase: 'planned', adapterId: 'tailscale-funnel', recommendations: ['tailscale-funnel', 'localhost-run', 'own-address'],
  observations: Object.fromEntries(adapters.map(a => [a.id, a.id === 'own-address' ? 'unknown' : 'present'])),
  plans: adapters.map(a => ({ adapterId: a.id, eligibility: 'needs-validation', preconditionActions: a.id === 'own-address' ? a.actions : [] })),
  limitations: [...new Set(adapters.flatMap(a => a.unknowns ?? []))], resources: [],
} };
export const ready = { ...planned, lifetimeMs: 900000, snapshot: { ...planned.snapshot, phase: 'published-ready', published: 'https://node.tailnet.test:8443' },
  validation: { probeReceipt: { tls: true, instanceMatched: true, sse: true, vantage: 'public' } } };
export const failed = { snapshot: { ...planned.snapshot, phase: 'degraded', published: null, candidate: 'https://node.tailnet.test:8443',
  resources: [{ ownership: 'owned', cleanup: 'active' }], limitations: ['Current origin health proof failed or expired; external owner action required'] } };
export const cleaned = { ...failed, snapshot: { ...failed.snapshot, phase: 'stopped', resources: [{ ownership: 'owned', cleanup: 'removed' }] }, localCleanupFailures: [] };
