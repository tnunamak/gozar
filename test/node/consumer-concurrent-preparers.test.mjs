// Consumer acceptance repro 1c (DataConnect adoption of 0.5.2): three concurrent `prepareTurnOn` calls on one
// localhost-run session profile ended at `configuration_stale` on 0.5.2 and at a review on 0.5.1.
//
// Provenance: reference-implementation/test/reachability-upgrade-state.test.ts "three preparers on one profile all end
// at a review, never at a stale dead end" (adoption branch ra-gozar/adopt-052-1119 at 94f88e2e..., not imported here).
// Finding (see the 1c report): the same consumer test fails intermittently on 0.5.1, on the 0.5.2 package and on this
// candidate, at load-dependent rates. The first failing reply is the SDK's documented compare-and-set refusal: of
// several commits against one revision exactly one wins and the others get `configuration_stale`. The dead end is
// the host's restart chain (losers discard the draft the winner still needs; `draft_not_found`). This test pins the
// SDK side so a future change cannot turn that refusal into a second winner, a different code or a lost update.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createEmbeddingServices } from '../../packages/gozar-node/embedding-services.mjs';

test('three concurrent commits of one revision: exactly one wins, the others are refused configuration_stale', async () => {
  const home = await mkdtemp(join(homedir(), '.tmp', 'preparers-'));
  const services = createEmbeddingServices({ registryId: 'concurrent-preparers' });
  try {
    const scope = { home, providerId: 'localhost-run' };
    const applied = await services.readConfiguration(scope);
    const drafts = await Promise.all([1, 2, 3].map(() => services.beginConfigurationDraft({ ...scope, expectedConfigurationRevision: applied.revision })));
    const outcomes = await Promise.allSettled(drafts.map(draft => services.commitConfigurationDraft({ ...scope, draftId: draft.draftId, expectedConfigurationRevision: draft.configuration.revision })));
    const won = outcomes.filter(item => item.status === 'fulfilled'), lost = outcomes.filter(item => item.status === 'rejected');
    assert.equal(won.length, 1, 'exactly one preparer commits');
    for (const item of lost) assert.equal(item.reason.code, 'configuration_stale', 'every other preparer gets the restartable code, nothing else');
    const after = await services.readConfiguration(scope);
    assert.equal(after.revision, won[0].value.revision, 'the winner\'s revision is the applied one: no lost update');
    // A restart re-reads the state and begins again from the new revision: it is never stuck stale.
    const again = await services.beginConfigurationDraft({ ...scope, expectedConfigurationRevision: after.revision });
    const second = await services.commitConfigurationDraft({ ...scope, draftId: again.draftId, expectedConfigurationRevision: again.configuration.revision });
    assert.ok(second.revision);
  } finally { await rm(home, { recursive: true, force: true }); }
});
