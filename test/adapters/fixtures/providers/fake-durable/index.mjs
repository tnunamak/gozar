// A synthetic durable provider: an in-memory, versioned rule store with slots and optional expiring leases.
// This directory plus one registry entry is all it takes; no core file names it. The store is exported so a test
// can play the other programs that write to it (foreign rules, version bumps) and inject failures.
import { recipeAdapter } from '../../../../../packages/gozar-node/adapter-runtime.mjs';
import { isDeepStrictEqual } from 'node:util';

export const store = {
  identity: 'store-1', version: 1, entries: new Map(), leaseMs: null, writes: [],
  alwaysConflict: false, crashOnPut: false, failRenew: false, renewals: 0, putCalls: 0,
  reset() { Object.assign(this, { identity: 'store-1', version: 1, entries: new Map(), leaseMs: null, writes: [], alwaysConflict: false, crashOnPut: false, failRenew: false, renewals: 0, putCalls: 0 }); },
  // What another program does: write without the facet. It bumps the version, as any write would.
  foreignWrite(slot, rule, extra = {}) { this.entries.set(slot, { rule, foreign: true, ...extra }); this.version += 1; },
  edit(slot, rule) { this.entries.get(slot).rule = rule; this.version += 1; },
  view() { return JSON.parse(JSON.stringify([...this.entries])); },
};

const slotIds = ['a', 'b', 'c'];
const lease = () => store.leaseMs === null ? null : new Date(Date.now() + store.leaseMs).toISOString();

function durableFacet(definition) {
  return {
    family: 'fake',
    definition,
    async observe() {
      return { identity: store.identity, snapshot: { identity: store.identity, entries: Object.fromEntries(structuredClone([...store.entries])) }, version: String(store.version) };
    },
    slots: snapshot => slotIds.map(slot => ({ slot, origin: `https://${slot}.fake.test`, permitted: true })),
    // Every rule lives under the one store identity, so a rule pinned to another identity is not here.
    read: (snapshot, slot, identity = snapshot.identity) => identity === snapshot.identity ? snapshot.entries[slot]?.rule ?? null : null,
    foreign: (snapshot, slot) => snapshot.entries[slot]?.foreign === true,
    occupied: (snapshot, slot) => snapshot.entries[slot] !== undefined,
    expand: target => ({ forward: target }),
    expiresAt: (snapshot, slot) => snapshot.entries[slot]?.expiresAt ?? null,
    async put(ctx, { slot, rule, version }) {
      store.putCalls += 1;
      if (store.alwaysConflict || version !== String(store.version)) return 'conflict';
      if (store.crashOnPut) throw new Error('simulated crash before the write');
      store.entries.set(slot, { rule: structuredClone(rule), expiresAt: lease() });
      store.version += 1; store.writes.push({ op: 'put', slot });
      return 'written';
    },
    async delete(ctx, { slot, rule, version }) {
      if (store.alwaysConflict || version !== String(store.version)) return 'conflict';
      if (!isDeepStrictEqual(store.entries.get(slot)?.rule, rule)) return 'conflict';
      store.entries.delete(slot);
      store.version += 1; store.writes.push({ op: 'delete', slot });
      return 'written';
    },
    async renew(ctx, { slot }) {
      if (store.failRenew) throw new Error('lease service is down');
      store.renewals += 1;
      store.entries.get(slot).expiresAt = lease();
      return { expiresAt: store.entries.get(slot).expiresAt };
    },
  };
}

export default recipeAdapter({
  definition: new URL('./definition.json', import.meta.url),
  extend: ({ wrapped }) => ({ durable: durableFacet(wrapped) }),
});
