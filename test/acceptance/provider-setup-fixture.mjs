// This adapter is copied beside the generated fake. Its JSON file stands in for
// state held by an external provider across Gozar host restarts.
import base from './base.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const stateFile = new URL('./world.json', import.meta.url);
const world = () => JSON.parse(readFileSync(stateFile, 'utf8'));
const action = (id, kind, actor, purpose, extra = {}, step = {}) => ({
  id, kind, label: id, digest: 'fixture:' + id, required: true,
  disclosure: { revision: 'fixture-v1', text: 'Exact synthetic setup', links: [] },
  step: { actor, purpose, permission: { id, label: id }, verification: 'provider', ...step },
  ...extra,
});

function offers(current, configuration) {
  if (current.mode === 'browser') {
    if (current.grant !== 'verified') {
      return [action('grant', 'open-url', 'owner', 'authorize', { href: 'https://fixture.invalid/authorize' },
        { browser: { expiresAt: current.expiresAt, pollAfterMs: 50 } })];
    }
    if (!configuration?.account) return [action('account', 'provide-value', 'owner', 'configure', { valueFormat: 'text' },
      { options: [{ value: 'account-1', label: 'Fixture account' }], prerequisites: ['grant'] })];
    if (!current.connectorCredential) return [action('connector', 'provide-secret', 'owner', 'configure', { secretLabel: 'Connector credential' })];
    if (!current.admin) return [action('allow-route', 'instructions', 'administrator', 'configure',
      { instructions: 'Allow the exact fixture route in account policy.' })];
  }
  if (current.resources.tunnel) {
    return [action('remove-tunnel', 'gozar-runs', 'machine', 'remove-resource')];
  }
  return [action('create-tunnel', 'gozar-runs', 'machine', 'provision')];
}

export default {
  ...base,
  async detect(ctx) {
    const current = world();
    const configuration = await ctx.configuration(null);
    return { state: 'action-required', facts: { offers: offers(current, configuration), price: current.price } };
  },
  configurationActions: undefined,
  setupActions: facts => facts?.offers ?? [],
  // The setup executor supplies effects. A future orchestration layer supplies
  // the journal and admission. This counter advances only when called.
  async setup(ctx, id, secretHandle) {
    const current = world();
    current.calls.push(id);
    if (id === 'connector') {
      current.connectorCredential = await ctx.withSecret(secretHandle, async bytes => bytes.byteLength > 0);
    }
    if (id === 'create-tunnel') {
      current.resources.tunnel = 'fixture-tunnel';
      current.creates += 1;
    }
    if (id === 'remove-tunnel') delete current.resources.tunnel;
    writeFileSync(stateFile, JSON.stringify(current));
    if (id === 'create-tunnel' && current.loseResponse) {
      throw new Error('synthetic provider lost response');
    }
    return { state: 'complete', nextAction: null };
  },
  // Read-only fixture observations used by the setup-operation runner when
  // implemented. Browser return is deliberately independent of grant evidence.
  async observeSetup() {
    const current = world();
    return {
      grant: current.grant,
      administrator: current.admin,
      resources: current.readable ? current.resources : null,
    };
  },
};
