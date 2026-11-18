// Copied beside the generated fake. Its file stands in for the external provider.
import base from './base.mjs';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';

import { join } from 'node:path';

const stateFile = new URL('./world.json', import.meta.url);
function obstructJournal(home) {
  const file = join(home, 'embedding-state.json');
  renameSync(file, file + '.saved');
  mkdirSync(file, { mode: 0o700 });
}
const world = () => JSON.parse(readFileSync(stateFile, 'utf8'));
const action = (id, kind, actor, purpose, extra = {}, step = {}) => ({
  id, kind, label: id, digest: 'fixture:' + id, required: true,
  disclosure: { revision: 'fixture-v1', text: 'Exact synthetic setup', links: [] },
  step: { actor, purpose, permission: { id, label: id }, verification: 'provider', ...step },
  ...extra,
});

function offer(current, configuration) {
  if (current.mode === 'browser') {
    if (current.grant !== 'verified') {
      return action('grant', 'open-url', 'owner', 'authorize', { href: 'https://fixture.invalid/authorize?session=transient-fixture-canary' },
        { browser: { expiresAt: current.expiresAt, pollAfterMs: 50 } });
    }
    if (!configuration?.account) return action('account', 'provide-value', 'owner', 'configure', { valueFormat: 'text' },
      { options: [{ value: 'account-1', label: 'Fixture account' }], prerequisites: ['grant'] });
    if (!current.connectorCredential) return action('connector', 'provide-secret', 'owner', 'configure', { secretLabel: 'Connector credential' });
    if (!current.admin) return action('allow-route', 'instructions', 'administrator', 'configure',
      { instructions: 'Allow the exact fixture route in account policy.' });
  }
  return action('create-tunnel', 'gozar-runs', 'machine', 'provision');
}

const next = (state, nextAction, extra = {}) => ({ state, nextAction, ...extra });
const subject = operation => ({ provider: 'fixture', allocationKey: operation.id });

export default {
  ...base,
  async detect(ctx) {
    const current = world();
    const configuration = await ctx.configuration(null);
    return { state: 'action-required', facts: { offer: offer(current, configuration), price: current.price } };
  },
  configurationActions: undefined,
  setupActions: facts => facts?.offer ? [facts.offer] : [],
  async setup() { throw new Error('legacy setup bypass'); },
  async executeSetup(ctx, { action, intent, resource }) {
    const current = world();
    current.calls.push(action.id);
    if (action.id === 'connector') {
      current.connectorCredential = await ctx.withInputSecret(async bytes => bytes.byteLength > 0);
    }
    if (action.id === 'create-tunnel') {
      const allocation = { id: 'fixture-tunnel-' + intent.id, intentId: intent.id };
      if (current.deferCreate) current.pendingAllocation = allocation;
      else {
        current.allocation = allocation;
        current.resources.tunnel = allocation.id;
      }
      current.creates += 1;
    }
    if (action.id === 'remove-tunnel' && current.resources.tunnel === resource.identity.id) delete current.resources.tunnel;
    writeFileSync(stateFile, JSON.stringify(current));
    if (action.id === 'create-tunnel' && current.journalFault === 'after') obstructJournal(ctx.home);
    if (action.id === 'create-tunnel' && current.loseResponse) throw new Error('synthetic provider lost response');
    return { state: 'complete' };
  },
  async observeSetup(ctx, operation) {
    const current = world();
    const observedAt = new Date().toISOString();
    const nextAction = offer(current, await ctx.configuration(null));
    const evidence = current.grant === 'pending' ? undefined :
      { operationId: operation.id, stepId: 'grant', source: 'provider', observedAt, summary: 'Provider authorization status observed.' };
    if (current.grant !== 'verified') return next(current.grant, current.grant === 'pending' ? nextAction : null, { evidence });

    if (current.completion) return next('complete', null, {
      evidence: current.completion === 'foreign' ? { ...evidence, operationId: 'another-operation' } : undefined,
    });

    const [row] = operation.resources;
    if (row?.settledAbsent && current.offerAgain && !operation.cancelled) return next('pending',
      action('create-tunnel', 'gozar-runs', 'machine', 'provision'),
      { evidence, intent: { kind: 'tunnel', label: 'Fixture tunnel', subject: subject(operation) } });
    if (!row && current.journalFault === 'before') obstructJournal(ctx.home);
    if (!row) return next('pending', nextAction, { evidence, ...(nextAction.id === 'create-tunnel' && {
      intent: { kind: 'tunnel', label: 'Fixture tunnel', subject: subject(operation) },
    }) });
    const allocation = current.allocation;
    const exactAllocation = current.readable && allocation?.intentId === row.id;
    const exactPresent = exactAllocation && allocation.id === current.resources.tunnel;
    const status = exactPresent ? 'present' : exactAllocation && row.identity ? 'absent' : 'pending';
    const observations = [{ intentId: row.id, subject: subject(operation), status, observedAt,
      ...(status !== 'pending' && { identity: { id: allocation.id } }) }];
    return next(status === 'pending' ? 'reconciling' : 'complete', exactPresent
      ? action('remove-tunnel', 'gozar-runs', 'machine', 'remove-resource', {}, { resourceHandle: row.id })
      : null, { evidence, observations });
  },
};
