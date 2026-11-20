import { createHash } from 'node:crypto';
import { effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';
import { supportedPlatform } from '../../../packages/gozar-node/platform.mjs';

const inventoryUrl = 'https://api.ngrok.com/reserved_domains';
const inventorySlot = 'domain-inventory';
const domainSource = 'ngrok-domain-source';
const maxPageBytes = 256 * 1024;
const maxPages = 10;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function credential(bytes) {
  if (!bytes?.length || bytes.length > 512) return null;
  const value = new TextDecoder().decode(bytes).trim();
  return /^[!-~]+$/.test(value) ? value : null;
}

async function boundedJson(response) {
  if (!response.body) throw new Error('missing response');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxPageBytes) throw new Error('response too large');
      chunks.push(Buffer.from(chunk.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

// HTTPS GET only. Keep the API key inside the host's secret callback and refuse
// redirects or pagination outside the exact documented resource.
async function listDomains(bytes, request) {
  const key = credential(bytes);
  if (!key) return { state: 'denied' };
  const seen = new Set(), domains = new Set(), endpoint = new URL(inventoryUrl);
  try {
    const signal = AbortSignal.timeout(5000);
    let url = endpoint;
    for (let page = 0; page < maxPages; page += 1) {
      if (seen.has(url.href) || url.origin !== endpoint.origin || url.pathname !== endpoint.pathname ||
          url.username || url.password || url.hash) return { state: 'unavailable' };
      seen.add(url.href);
      const response = await request(url.href, {
        method: 'GET', headers: { Authorization: 'Bearer ' + key, 'Ngrok-Version': '2' }, redirect: 'error', signal,
      });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        return { state: [401, 403].includes(response.status) ? 'denied' : 'unavailable' };
      }
      const data = await boundedJson(response);
      if (!Array.isArray(data?.reserved_domains)) return { state: 'unavailable' };
      for (const row of data.reserved_domains) {
        if (typeof row?.id === 'string' && row.id.startsWith('rd_') && domainPattern.test(row.domain)) domains.add(row.domain);
      }
      if (data.next_page_uri === null) return { state: 'complete', domains: [...domains].sort() };
      if (typeof data.next_page_uri !== 'string' || !data.next_page_uri) return { state: 'unavailable' };
      url = new URL(data.next_page_uri, endpoint);
    }
  } catch { /* Provider/network errors can contain credentials. */ }
  return { state: 'unavailable' };
}

export function ngrokSetup({ definition, authAction, domainAction, sdkAvailable, fetchManagement, runtimeInstallable = () => true, sdkUnavailableReason = () => 'The optional ngrok SDK is missing. Confirm installation and refresh after the host can load it.' }) {
  const action = (fields, actor, permission, verification, purpose, options) => {
    const { digest: _digest, ...body } = fields;
    const result = { disclosure: definition.disclosure, ...body, step: { actor,
      permission: { id: body.id, label: permission }, verification, purpose, ...(options ? { options } : {}) } };
    return { ...result, digest: sha(result) };
  };
  const auth = action({ ...authAction, inputId: 'auth',
    help: 'Sign up or sign in to ngrok. In the dashboard for the intended account, open Your Authtoken and paste the agent authtoken into this private input. Use the same account when choosing a domain. API keys and MCP credentials have different purposes.',
  }, 'owner', 'Supply the agent credential for this listener', 'host', 'authorize');
  const domain = options => action({ ...domainAction, inputId: 'reserved-domain',
    help: options
      ? 'Choose a domain observed in the inventory key’s account. The SDK still checks the agent credential and domain pairing when an approved route starts.'
      : 'Open Domains in the intended account. Copy the assigned development domain or a reserved hostname the plan already permits. If the account has no domain, ask its owner to acquire or assign one and review any cost there. Return and enter the hostname without a scheme, port or path.',
  }, 'owner', 'Select an existing ngrok HTTPS domain', options ? 'provider' : 'host', 'configure', options);
  const dashboard = { value: 'dashboard', label: 'Copy from the ngrok dashboard' };
  const source = action({ id: domainSource, kind: 'provide-value', label: 'Choose where to get your ngrok domain',
    valueLabel: 'Domain source', valueFormat: 'text', required: true,
    help: 'Use the dashboard to copy a hostname. If an administrator has supplied a suitably scoped API key, Gozar can read the account’s reserved domains.' },
  'owner', 'Select the source of domain inventory', 'host', 'configure',
  [dashboard, { value: 'inventory', label: 'Read the account inventory with an API key' }]);
  const useDashboard = action({ ...source, label: 'Switch to the ngrok dashboard', required: false,
    help: 'Use the dashboard to choose an existing hostname and approve forgetting the local inventory key.',
  }, 'owner', 'Switch away from domain inventory', 'host', 'configure', [dashboard]);
  const management = action({ id: 'ngrok-management-key', inputId: 'ngrok-management-key', kind: 'provide-secret',
    label: 'Provide an ngrok API key for domain inventory', secretLabel: 'ngrok management API key',
    obtainUrl: 'https://dashboard.ngrok.com/api-keys',
    help: 'Ask the administrator of the intended account for a dedicated API key authorized to list reserved domains. An API key can have wider account permissions. Gozar uses this key only for GET requests to the reserved domains inventory. If you cannot obtain suitable authority, clear Domain source in the draft and choose the dashboard.',
  }, 'owner', 'Read reserved domains from api.ngrok.com', 'provider', 'authorize');
  const disconnect = action({ id: 'ngrok-disconnect-inventory', kind: 'gozar-runs', label: 'Forget the local ngrok domain inventory key',
    help: 'Remove the private copy stored by this setup. The agent credential, ngrok account API key and existing domains remain available.',
  }, 'owner', 'Delete this operation’s local domain inventory key', 'host', 'disconnect');
  const entry = action({ id: 'ngrok-setup', kind: 'gozar-runs', label: 'Set up an ngrok HTTPS listener',
    help: 'Check the SDK and guide account credential and domain selection for the HTTPS listener.' },
  'machine', 'Read ngrok HTTPS setup prerequisites', 'host', 'authorize');
  const artifact = (platform, architecture) => action({
    id: 'install-sdk', kind: 'install-artifact', label: 'Install the optional ngrok SDK 1.7.0',
    instructions: 'Approve installation into the application that hosts Gozar. If its installer is unavailable, run npm install @ngrok/ngrok@1.7.0 in that application and restart it.',
    artifact: { url: 'https://registry.npmjs.org/@ngrok/ngrok/-/ngrok-1.7.0.tgz',
      sha256: 'f3b20ab9a9848f10ac1009dba25d928dc722a5591c38272b64236b988e8736fe', platform, architecture },
    effects: { writes: ['Application dependency files and node_modules'], networkOrigins: ['https://registry.npmjs.org'],
      requiresPrivilege: false, restartRequired: true },
  }, 'owner', 'Install the pinned optional SDK into the host application', 'host', 'configure');

  // The test harness must never fall through to the real provider network.
  const read = (ctx, bytes) => listDomains(bytes, ctx.dispatchEffect ? async (url, request) => {
    const reply = await ctx.dispatchEffect({ kind: 'network', operation: 'fetch', input: { url, method: request.method, headers: request.headers } });
    if (reply?.status !== 200) return new Response(null, { status: reply?.status });
    const chunks = reply.chunks ?? [];
    if (!Array.isArray(chunks) || chunks.some(chunk => typeof chunk?.data !== 'string') ||
        chunks.reduce((size, chunk) => size + chunk.data.length, 0) > 2 * maxPageBytes) throw new Error('Invalid inventory observation');
    return new Response(Buffer.concat(chunks.map(chunk => Buffer.from(chunk.data, 'base64'))), { status: 200 });
  } : fetchManagement);

  async function observeSetup(ctx, operation) {
    const outcome = (state, nextAction, summary, stepId = nextAction?.id ?? 'ngrok-ready', source = nextAction?.step.verification ?? 'host') =>
      ({ state, nextAction, evidence: { operationId: operation.id, stepId, source, observedAt: new Date(ctx.now()).toISOString(), summary } });
    const disconnectIfRetained = () => ctx.hasManagementSecret(inventorySlot)
      ? outcome('pending', disconnect, 'This setup retains a local domain inventory key.') : null;
    if (operation.cancelled) {
      const recovery = disconnectIfRetained();
      if (recovery) return recovery;
      return outcome('complete', null, 'No local domain inventory key is retained by this setup. The account’s existing credentials and domains are retained.', disconnect.id);
    }
    if (operation.lastActionId === null) return outcome('authorization-required', entry, entry.help);
    const configuration = await ctx.configurationPresence();
    const values = configuration?.values ?? {};
    const selected = values[domainSource];
    if (selected !== 'inventory') {
      const recovery = disconnectIfRetained();
      if (recovery) return recovery;
    }
    if (!supportedPlatform(ctx.platform)) return outcome('blocked', null, 'The ngrok runtime is unavailable on this platform.', 'ngrok-platform');
    if (!await sdkAvailable(ctx)) {
      // The host said whether Gozar may offer a runtime install. Without that explicit authority the
      // SDK prerequisite is unavailable with a fixed plain reason and no impossible install action.
      if (runtimeInstallable(ctx)) return outcome('blocked', artifact(ctx.platform, ctx.architecture ?? process.arch),
        'The optional ngrok SDK is missing. Confirm installation and refresh after the host can load it.');
      return outcome('blocked', null, sdkUnavailableReason(ctx), 'ngrok-sdk');
    }
    const agent = configuration?.credentials?.auth;
    if (!agent?.known || agent.value !== true) return outcome('authorization-required', auth, 'Agent credential intake is required. Browser sign-in alone supplies no agent credential.');
    if (selected !== 'dashboard' && selected !== 'inventory') return outcome('authorization-required', source, source.help);

    const saved = values['reserved-domain'];
    if (selected === 'inventory') {
      let inventory;
      try { inventory = await ctx.withManagementSecret(inventorySlot, bytes => read(ctx, bytes)); } catch { /* Missing private grant. */ }
      if (!inventory) return outcome('authorization-required', management, 'The optional domain inventory needs its own management credential.');
      if (inventory.state !== 'complete') return outcome('blocked', management, inventory.state === 'denied'
        ? 'The management API refused domain inventory. Check the API key’s account and policy.'
        : 'The management API did not return a complete domain inventory. Refresh or select the dashboard source.');
      if (!inventory.domains.length) return outcome('blocked', action({
        id: 'ngrok-no-domain', kind: 'instructions', label: 'Obtain an HTTPS hostname in the intended account',
        instructions: 'Open https://dashboard.ngrok.com/domains. Ask the account owner to check the assigned development domain, reserved domains and plan entitlements. To use an assigned hostname absent from the management inventory, choose the dashboard source in a new setup.',
      }, 'administrator', 'Manage domains and plan entitlements', 'provider', 'configure'), 'The management inventory returned no exact hostnames.');
      if (!inventory.domains.includes(saved)) return outcome('authorization-required',
        domain(inventory.domains.map(value => ({ value, label: value }))),
        'Choose a hostname returned by this management account. Existing agent credentials are checked separately.');
    } else if (!domainPattern.test(saved ?? '')) {
      return outcome('authorization-required', domain(), 'Enter the account hostname shown in the dashboard.');
    }
    const readiness = 'Setup inputs are ready. An approved listener start must verify the credential and domain pairing, and route proof must succeed before publication.';
    const summary = operation.lastActionId === disconnect.id ? 'No local domain inventory key is retained by this setup. ' + readiness : readiness;
    return outcome('complete', selected === 'inventory' ? useDashboard : null, summary, 'ngrok-ready');
  }

  return {
    entry,
    configurationActions: () => [authAction, domainAction, entry],
    observeSetup,
    async executeSetup(ctx, { action: approved }) {
      if (approved.id === disconnect.id) {
        await ctx.disconnectManagementSecret(inventorySlot);
      } else if (approved.id === auth.id) {
        if (!await ctx.withInputSecret(async bytes => Boolean(credential(bytes))))
          throw effectError('setup_required', 'Enter a single ngrok agent authtoken.');
        return { state: 'complete', bindInputSecret: true };
      } else if (approved.id === management.id) {
        const inventory = await ctx.withInputSecret(bytes => read(ctx, bytes));
        if (inventory?.state !== 'complete') throw effectError('setup_required', 'The management API did not verify read access to reserved domains.');
        await ctx.retainManagementSecret(inventorySlot);
      }
      return { state: 'complete' };
    },
  };
}
