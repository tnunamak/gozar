import { createHash } from 'node:crypto';
import { effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';

const baseUrl = 'https://api.cloudflare.com/client/v4';
const tokensUrl = 'https://dash.cloudflare.com/profile/api-tokens';
const tokenDocs = 'https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/';
const slot = 'cloudflare-api';
const hex = /^[0-9a-f]{32}$/i;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const refuse = () => { throw effectError('provider_unavailable', 'Cloudflare did not confirm this operation'); };

function endpoint(subject, identity) {
  if (subject.kind === 'dns' && hex.test(subject.zone) && (!identity || hex.test(identity.id))) {
    return '/zones/' + subject.zone + '/dns_records' + (identity ? '/' + identity.id : '');
  }
  if (hex.test(subject.account) && (!identity || uuid.test(identity.id))) {
    return '/accounts/' + subject.account + '/cfd_tunnel' + (identity ? '/' + identity.id : '');
  }
  refuse();
}

async function rest(ctx, bytes, method, path, body) {
  const token = new TextDecoder().decode(bytes);
  if (!/^[\x21-\x7e]{1,4096}$/.test(token)) refuse();
  let reply;
  if (ctx.dispatchEffect) {
    reply = await ctx.dispatchEffect({ kind: 'cloudflare-api', operation: 'request', input: { method, path, token, body } });
  } else {
    const response = await fetch(baseUrl + path, { method, redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }) });
    reply = { status: response.status, body: await response.json() };
  }
  return reply;
}

const result = reply => {
  if (!(reply.status >= 200 && reply.status < 300 && reply.body?.success === true)) refuse();
  return reply.body.result;
};
const management = (ctx, use) => ctx.withManagementSecret(slot, bytes => use((method, path, body) => rest(ctx, bytes, method, path, body)));
const dnsByName = subject => endpoint(subject) + '?name.exact=' + encodeURIComponent(subject.name);
async function knownTunnelAbsent(call, subject, id) {
  const active = result(await call('GET', endpoint(subject) + '?is_deleted=false&uuid=' + id));
  return Array.isArray(active) && active.length === 0;
}
// Both APIs expose provider-issued IDs. A same-name match cannot recover a lost create response.
const exactTunnel = (row, tunnel, identity) => tunnel?.id === identity.id && tunnel.account_tag === row.subject.account &&
  tunnel.name === row.subject.name && tunnel.config_src === 'cloudflare' && tunnel.created_at === identity.createdAt;
const exactDNS = (row, record, identity) => record?.id === identity.id && record.name === row.subject.name &&
  record.type === 'CNAME' && record.proxied === true && record.content === row.subject.content &&
  record.created_on === identity.createdAt && record.modified_on === identity.modifiedAt;
const exact = (row, value, identity) => row.kind === 'dns' ? exactDNS(row, value, identity) : exactTunnel(row, value, identity);

function ingress(subject) {
  return [{ hostname: subject.hostname, service: 'http://127.0.0.1:' + subject.port }, { service: 'http_status:404' }];
}
const sameIngress = (actual, expected) => Array.isArray(actual) && actual.length === expected.length &&
  actual.every((row, index) => row.hostname === expected[index].hostname && row.service === expected[index].service);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

async function readResource(call, row) {
  const identity = row.identity ?? row.receiptIdentity;
  if (!identity) return { status: 'pending' };
  if (row.kind === 'credential') {
    const path = endpoint(row.subject, { id: row.subject.tunnelId });
    const reply = await call('GET', path + '/token');
    if (row.identity && reply.status === 404 && await knownTunnelAbsent(call, row.subject, row.subject.tunnelId)) {
      return { status: 'absent', identity };
    }
    const token = result(reply);
    if (typeof token !== 'string' || !token) refuse();
    if (digest(token) === identity.fingerprint) return { status: 'present', identity };
    return row.identity ? { status: 'absent', identity } : { status: 'pending' };
  }
  const reply = await call('GET', endpoint(row.subject, identity));
  if (row.identity && reply.status === 404) {
    if (row.kind === 'tunnel') {
      if (await knownTunnelAbsent(call, row.subject, identity.id)) return { status: 'absent', identity };
    } else {
      const matchingName = result(await call('GET', dnsByName(row.subject)));
      if (Array.isArray(matchingName) && matchingName.every(record => record.id !== identity.id)) return { status: 'absent', identity };
    }
    return { status: 'pending' };
  }
  const current = result(reply);
  if (!exact(row, current, identity)) return { status: 'pending' };
  if (row.kind === 'tunnel' && timestamp(current.deleted_at)) return row.identity ? { status: 'absent', identity } : { status: 'pending' };
  return { status: 'present', identity };
}

async function zonesFor(call) {
  const zones = [];
  for (let page = 1; page <= 20; page++) {
    const reply = await call('GET', '/zones?status=active&per_page=50&page=' + page);
    const rows = result(reply);
    if (!Array.isArray(rows)) refuse();
    zones.push(...rows.filter(zone => hex.test(zone.id) && hex.test(zone.account?.id) && typeof zone.name === 'string'));
    if (rows.length < 50 || reply.body.result_info?.total_pages === page) return zones;
  }
  refuse();
}

export function managedCloudflareSetup(action, dependencies) {
  const step = (id, kind, label, purpose, extra = {}, detail = {}) => action(id, kind, label, {
    ...extra, step: { actor: kind === 'gozar-runs' ? 'machine' : 'owner', purpose, verification: 'provider',
      permission: { id, label }, ...detail },
  });
  const instruct = (id, label, purpose, instructions, extra = {}) => step(id, 'instructions', label, purpose, { instructions, ...extra });
  const source = (id, label, format, options) => step(id, 'provide-value', label, 'configure',
    { valueLabel: label, valueFormat: format, required: true }, options ? { options } : {});
  const access = (purpose = 'authorize') => step('managed-api-token', 'provide-secret', 'Authorize managed Cloudflare setup', purpose, {
    secretLabel: 'Scoped Cloudflare API token', obtainUrl: tokensUrl, required: true,
    instructions: 'Create a Custom API token in My Profile → API Tokens. Grant Cloudflare Tunnel Edit for one account, Zone Read and DNS Edit for one existing Cloudflare zone, and set an expiry long enough for cleanup. Enter that API token in the private input. Gozar uses it to manage the tunnel, create the DNS record and verify DNS removal. Keep its dashboard entry until cleanup. Browser-only management authorization is unavailable here.',
  });
  const initial = () => access();
  const accountInput = options => source('managed-account', 'Cloudflare account', 'text', options);
  const zoneInput = options => source('managed-zone', 'Cloudflare DNS zone', 'text', options);
  const hostnameInput = (label = 'Unused hostname') => source('managed-hostname', label, 'domain');
  const portInput = () => step('managed-port', 'provide-value',
    'Local connector gate port', 'configure', { valueFormat: 'text', required: true,
      help: 'Choose an unused local port between 1024 and 65535, distinct from the port your app listens on.' });
  const configurationInputActions = () => [accountInput(), zoneInput(), hostnameInput(), portInput()];
  const next = (state, nextAction = null, extra = {}) => ({ state, nextAction, ...extra });

  async function observeSetup(ctx, operation) {
    const configuration = await ctx.configurationPresence();
    const values = configuration?.values ?? {};
    const reauthorize = configuration ? access(operation.cancelled ? 'reconcile' : 'authorize') :
      instruct('retained-management-required', 'Restore cleanup authority for the retained operation', 'reconcile',
        'The original configuration is unavailable, and the retained API token cannot currently authorize cleanup. Preserve this operation and check your Cloudflare account activity. Gozar cannot confirm removal.');
    let verification;
    try { verification = await management(ctx, call => call('GET', '/user/tokens/verify')); }
    catch { return next('blocked', reauthorize); }
    if (!verification) {
      if (operation.cancelled && !operation.resources.some(row => !row.settledAbsent)) return next('complete');
      return next('authorization-required', reauthorize);
    }
    const verified = verification.body?.result;
    const evidence = (stepId, summary) => ({
      operationId: operation.id, stepId, source: 'provider', observedAt: new Date().toISOString(), summary,
    });
    if (verification.status === 401 || verification.status === 403 || ['disabled', 'expired'].includes(verified?.status) ||
        (timestamp(verified?.expires_on) && Date.parse(verified.expires_on) <= Date.now())) {
      const expired = verified?.status === 'expired' || (timestamp(verified?.expires_on) && Date.parse(verified.expires_on) <= Date.now());
      const state = expired ? 'expired' : 'denied';
      return next(state, reauthorize, {
        evidence: evidence('managed-api-token', expired ? 'Cloudflare reports that the API token expired.' : 'Cloudflare refused this API token.'),
        observations: operation.resources.filter(row => !row.settledAbsent).map(row => ({
          intentId: row.id, subject: row.subject, status: 'pending', observedAt: new Date().toISOString(),
        })),
      });
    }
    if (verification.status !== 200 || verification.body.success !== true || verified?.status !== 'active') {
      return next('blocked', instruct('check-management', 'Check API token status', 'reconcile',
        'Cloudflare did not confirm active API authorization. Check the token and try the read again.', { href: tokensUrl }));
    }
    const grant = evidence('managed-api-token', 'Cloudflare verified the API token. Endpoint permissions are checked when used.');
    return management(ctx, async call => {
      const rows = operation.resources.filter(row => !row.settledAbsent);
      const observed = await Promise.all(rows.map(async row => {
        const observation = await readResource(call, row).catch(() => ({ status: 'pending' }));
        return { intentId: row.id, subject: row.subject, observedAt: new Date().toISOString(), ...observation };
      }));
      const present = kind => rows.find((row, index) => row.kind === kind && observed[index].status === 'present');
      const absent = row => row.settledAbsent || observed.find(item => item.intentId === row.id)?.status === 'absent';
      const reply = (state, offer, extra) => next(state, offer, { evidence: grant, observations: observed, ...extra });

      if (observed.some(item => item.status === 'pending')) {
        return reply('reconciling', instruct('review-uncertain', 'Review unresolved Cloudflare resources', 'reconcile',
          'Gozar cannot confirm the exact resource identity or absence. Check Cloudflare activity and restore scoped API access if needed. Do not create a replacement or delete a resource based on its name.'));
      }
      const tunnel = present('tunnel'), dns = present('dns'), credential = present('credential');
      if (operation.cancelled) {
        if (ctx.configurationInUse()) return reply('pending', instruct('managed-stop-connector', 'Stop the attached route', 'stop-connector',
          'Close the active route in Gozar and confirm its cleanup. Refresh here to remove the owned DNS and tunnel resources.'));
        if (dns) {
          const { zone, name, content } = dns.subject;
          const { id, modifiedAt } = dns.identity ?? dns.receiptIdentity;
          const account = operation.resources.find(row => row.kind === 'tunnel')?.subject.account;
          return reply('pending', step('managed-owner-remove-dns', 'instructions', 'Remove the exact owned DNS record in Cloudflare', 'remove-resource', {
            href: 'https://dash.cloudflare.com/' + account,
            instructions: `As the Cloudflare zone owner, open account ${account} and go to DNS → Records for zone ${zone}. ` +
              `Confirm the proxied CNAME ${name} points to ${content}, has record ID ${id} and was last modified at ${modifiedAt}. ` +
              'Use the zone’s DNS record details or API inventory to confirm the ID and timestamp. If any detail changed, leave the record in place and reconcile it with the zone owner. ' +
              'Remove only the matching record from Cloudflare, then refresh this operation so Gozar can verify exact absence.',
          }, { resourceHandle: dns.id }));
        }
        if (credential) return reply('pending', step('managed-revoke-run-token', 'instructions', 'Rotate the owned tunnel run token', 'revoke-credential', {
          href: tokenDocs, instructions: 'Close the attached route in Gozar. In Cloudflare Networking → Tunnels, select ' +
            credential.subject.name + ' (' + credential.subject.tunnelId + '), choose Rotate token, then refresh here. Gozar checks that the exact previous token is no longer current. Rotation affects new connections. Existing connectors need to be stopped.',
        }, { resourceHandle: credential.id }));
        if (tunnel) return reply('pending', step('managed-remove-tunnel', 'gozar-runs', 'Remove the exact owned tunnel', 'remove-resource',
          { help: 'Close the attached route before removing the tunnel. Gozar does not force-disconnect other connectors.' }, { resourceHandle: tunnel.id }));
        if (operation.resources.some(row => row.kind === 'credential' && absent(row)) && operation.connectorInputs.includes('token')) {
          return reply('pending', step('managed-disconnect-connector', 'gozar-runs', 'Forget the local connector credential', 'disconnect'));
        }
        return reply('complete', step('managed-disconnect-api', 'gozar-runs', 'Disconnect the Cloudflare API token', 'disconnect', {
          href: tokensUrl, help: 'This removes the local reference and secret. To revoke the imported API token at Cloudflare, delete the exact token in My Profile → API Tokens.',
        }));
      }

      if (!tunnel && operation.resources.length) return reply('blocked', instruct('missing-tunnel', 'Review the missing owned tunnel', 'reconcile',
        'The owned tunnel has disappeared. Cancel this operation to reconcile any remaining DNS and credentials.'));
      if (!tunnel) {
        const missingDependency = await dependencies(ctx);
        if (missingDependency) return reply('blocked', missingDependency);
        const zones = await zonesFor(call);
        const accounts = [...new Map(zones.map(zone => [zone.account.id, { value: zone.account.id, label: zone.account.name ?? zone.account.id }])).values()];
        if (!accounts.length) return reply('blocked', instruct('add-zone', 'Make a Cloudflare zone available', 'configure',
          'Activate a zone on Cloudflare DNS and scope the API token to that account and zone. Refresh after activation.', { href: 'https://dash.cloudflare.com/' }));
        const account = values['managed-account'];
        if (!accounts.some(choice => choice.value === account)) return reply('pending',
          accountInput(accounts));
        const accountZones = zones.filter(zone => zone.account.id === account);
        const zone = accountZones.find(zone => zone.id === values['managed-zone']);
        if (!zone) return reply('pending', zoneInput(accountZones.map(zone => ({ label: zone.name, value: zone.id }))));
        const hostname = values['managed-hostname'];
        if (!hostname?.endsWith('.' + zone.name)) return reply('pending', hostnameInput('Unused hostname under ' + zone.name));
        const port = Number(values['managed-port']);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) return reply('pending', portInput());
        const records = result(await call('GET', dnsByName({ kind: 'dns', zone: zone.id, name: hostname })));
        if (!Array.isArray(records)) refuse();
        if (records.length) return reply('blocked', hostnameInput('Choose a hostname with no existing DNS record under ' + zone.name));
        const subject = { kind: 'tunnel', account, zone: zone.id, hostname, port, name: 'gozar-' + digest(operation.id).slice(0, 24) };
        return reply('pending', step('managed-create-tunnel', 'gozar-runs', 'Create a Cloudflare tunnel for ' + hostname, 'provision',
          { help: 'The owned tunnel will use a loopback gate on port ' + port + '. Cloudflare terminates HTTPS.' }),
        { intent: { kind: 'tunnel', label: 'Cloudflare tunnel for ' + hostname, subject } });
      }

      const identity = tunnel.identity ?? tunnel.receiptIdentity;
      const path = endpoint(tunnel.subject, identity);
      const wantedIngress = ingress(tunnel.subject);
      if (!sameIngress(result(await call('GET', path + '/configurations'))?.config?.ingress, wantedIngress)) {
        return reply('pending', step('managed-configure-tunnel', 'gozar-runs', 'Map ' + tunnel.subject.hostname + ' to loopback gate port ' + tunnel.subject.port,
          'configure', {}, { resourceHandle: tunnel.id }));
      }
      if (!dns) {
        if (operation.resources.some(row => row.kind === 'dns' && row.identity)) return reply('blocked', instruct('missing-dns',
          'Review the missing owned DNS record', 'reconcile', 'The owned DNS record is gone. Cancel this operation to clean up its tunnel.'));
        const subject = { kind: 'dns', zone: tunnel.subject.zone, name: tunnel.subject.hostname, content: identity.id + '.cfargotunnel.com' };
        const records = result(await call('GET', dnsByName(subject)));
        if (!Array.isArray(records) || records.length) return reply('blocked', instruct('dns-conflict',
          'Resolve the conflicting Cloudflare DNS record', 'reconcile',
          'An existing DNS record occupies the exact hostname. Gozar leaves it in place. Cancel managed setup or ask the zone owner to resolve the conflict.'));
        return reply('pending', step('managed-create-dns', 'gozar-runs', 'Create the proxied CNAME for ' + subject.name,
          'provision', { help: 'CNAME target ' + subject.content }), { intent: { kind: 'dns', label: 'Cloudflare DNS for ' + subject.name, subject } });
      }
      if (!credential) {
        if (operation.resources.some(row => row.kind === 'credential' && row.identity)) return reply('blocked', instruct('rotated-credential',
          'Review the changed tunnel credential', 'reconcile', 'The recorded run token changed. Cancel this operation to clean up its tunnel.'));
        const subject = { kind: 'credential', account: tunnel.subject.account, name: tunnel.subject.name, tunnelId: identity.id,
          hostname: tunnel.subject.hostname, port: tunnel.subject.port };
        return reply('pending', step('managed-capture-run-token', 'gozar-runs', 'Save the exact tunnel run token', 'provision'),
          { intent: { kind: 'credential', label: 'Cloudflare run token for ' + subject.hostname, subject } });
      }
      if (!configuration?.credentials?.token?.value) return reply('blocked', instruct('connector-token-unavailable',
        'Restore the private connector credential', 'reconcile',
        'The provider token is verified but the local connector binding is unavailable. Restore the secret backend, or cancel and remove this setup.'));
      return reply('complete', null);
    }).catch(() => next('blocked', instruct('check-scoped-access', 'Check Cloudflare account and zone access', 'reconcile',
      'Cloudflare did not confirm an account or zone read. Check the scoped token has Cloudflare Tunnel Edit, Zone Read and DNS Edit, then retry, or use a new setup operation with the corrected token.',
      { href: tokensUrl })));
  }

  async function executeSetup(ctx, { action: offer, intent, resource, value }) {
    if (offer.id === 'managed-api-token') {
      const valid = await ctx.withInputSecret(async bytes => /^[\x21-\x7e]{1,4096}$/.test(new TextDecoder().decode(bytes)));
      if (!valid) return { state: 'blocked' };
      await ctx.retainManagementSecret(slot);
      return { state: 'complete' };
    }
    if (offer.id === 'managed-disconnect-api') {
      await ctx.disconnectManagementSecret(slot);
      return { state: 'complete' };
    }
    if (offer.id === 'managed-disconnect-connector') {
      await ctx.disconnectConnectorSecret('token');
      return { state: 'complete' };
    }
    if (offer.id === 'managed-port' && (!/^[1-9][0-9]{3,4}$/.test(value) || Number(value) < 1024 || Number(value) > 65535)) {
      return { state: 'blocked' };
    }
    if (offer.kind !== 'gozar-runs') return { state: 'complete' };

    const executed = await management(ctx, async call => {
      const { subject } = intent ?? resource;
      switch (offer.id) {
        case 'managed-create-tunnel': {
          const tunnel = result(await call('POST', endpoint(subject), { name: subject.name, config_src: 'cloudflare' }));
          if (!uuid.test(tunnel?.id) || !timestamp(tunnel.created_at)) refuse();
          await ctx.recordAllocation({ id: tunnel.id, createdAt: tunnel.created_at });
          break;
        }
        case 'managed-configure-tunnel': {
          const path = endpoint(subject, resource.identity);
          if ((await readResource(call, resource)).status !== 'present') refuse();
          result(await call('PUT', path + '/configurations', { config: { ingress: ingress(subject) } }));
          break;
        }
        case 'managed-create-dns': {
          const dns = result(await call('POST', endpoint(subject), { name: subject.name, content: subject.content, type: 'CNAME', proxied: true, ttl: 1 }));
          if (!hex.test(dns?.id) || !timestamp(dns.created_on) || !timestamp(dns.modified_on)) refuse();
          await ctx.recordAllocation({ id: dns.id, createdAt: dns.created_on, modifiedAt: dns.modified_on });
          break;
        }
        case 'managed-capture-run-token': {
          const token = result(await call('GET', endpoint(subject, { id: subject.tunnelId }) + '/token'));
          if (typeof token !== 'string' || !token || token.length > 65536) refuse();
          const bytes = new TextEncoder().encode(token);
          try {
            await ctx.bindConnectorSecret('token', bytes);
            ctx.bindConfigurationValue('origin', 'https://' + subject.hostname);
            ctx.bindConfigurationValue('gate-port', String(subject.port));
            await ctx.recordAllocation({ fingerprint: digest(token) });
          } finally { bytes.fill(0); }
          break;
        }
        case 'managed-remove-tunnel': {
          if ((await readResource(call, resource)).status !== 'present') refuse();
          result(await call('DELETE', endpoint(subject, resource.identity)));
          break;
        }
        default: refuse();
      }
      return true;
    });
    return { state: executed ? 'complete' : 'blocked' };
  }

  return { initial, configurationInputActions, observeSetup, executeSetup };
}
