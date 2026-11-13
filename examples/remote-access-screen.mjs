import { catalogRoutes, storeSecret } from '@tnunamak/gozar';
import { createRouteApi, fakeReadContext, fakeRegistry, fakeRouteScenarios } from '@tnunamak/gozar/testing';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const show = observation => observation.known ? JSON.stringify(observation.value) : `unknown (${observation.reason})`;

export function renderFacts(facts) {
  const groups = Map.groupBy(facts, fact => fact.group);
  return [...groups].flatMap(([group, rows]) => [group, ...rows.map(fact =>
    `  ${fact.label}: ${fact.known ? JSON.stringify(fact.value) : `unknown (${fact.reason})`}; source=${fact.source}; asOf=${fact.asOf ?? 'unknown'}${fact.affectsConsent ? '; show before approval' : ''}`)]);
}

export function renderScreen(catalog, routes = [], host = { password: 'host-owned', restart: 'host-owned' }) {
  const lines = ['Remote access', `Host inputs: ${JSON.stringify(host)}`];
  for (const choice of catalog.candidates) {
    lines.push(`Choice: ${choice.display.label}`, `Reach: ${choice.properties.reach}`, `Payload readers: ${choice.properties.traffic.providerCanReadPayload === null ? 'unknown' : JSON.stringify(choice.properties.traffic.readers)}`,
      `Address: ${choice.properties.address.stability}; ports=${JSON.stringify(choice.properties.address.ports)}`, `Cost: ${choice.properties.cost.kind}`,
      `Availability: ${JSON.stringify(choice.availability)}`, `Setup: ${choice.setup.state}`);
    for (const item of choice.prerequisites) lines.push(`Prerequisite: ${item.label}: ${item.state}; observed=${item.observedAt}; version=${show(item.version)}; fix=${item.remedy?.label ?? 'no automatic fix'}`);
    for (const field of choice.configuration.inputRequirements) lines.push(`Input requirement: ${field.label}; kind=${field.kind}; secret=${field.secret}; help=${field.help}; validation=${field.validation}; obtain=${field.obtainUrl ?? 'not supplied'}`);
    for (const [id, present] of Object.entries(choice.configuration.credentials)) lines.push(`Credential present (${id}): ${show(present)}`);
    lines.push(`Saved values: ${JSON.stringify(choice.configuration.values)}`, `Edit/rotate: ${choice.configuration.actions.map(action => action.label).join(', ') || 'no stored fields'}`,
      ...renderFacts(choice.facts));
  }
  for (const route of routes) lines.push(`Route: ${route.handle.kind} ${route.routeState}; cleanup=${route.cleanup.state}`,
    `Proof: ${route.verification.status}; checked=${route.verification.checkedAt ?? 'unknown'}; expiry=${show(route.verification.validUntil)}; vantage=${route.verification.vantage}; results=${JSON.stringify(route.verification.results)}`,
    `Lifetime: ${show(route.expiresAt)}`, `Host configuration: ${JSON.stringify(route.hostConfiguration)}`, `Actions: ${route.actions.join(', ')}`, ...renderFacts(route.facts));
  return lines.join('\n');
}

export async function main(flag) {
  if (!['--fakes', '--detect'].includes(flag) || process.argv.slice(2).length !== 1) throw new Error('Choose exactly --fakes or --detect');
  const base = join(homedir(), '.tmp');
  await mkdir(base, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(join(base, 'remote-access-screen-'));
  const query = { schemaVersion: 1, owner: 'screen-example', target: '127.0.0.1:18765', home,
    usage: { kind: 'session', lifetimeMs: 60_000 }, requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'allow', protocols: [] } };
  try {
    if (flag === '--detect') {
      for (const usage of [query.usage, { kind: 'attached' }, { kind: 'durable', routeId: 'screen-example' }]) console.log(renderScreen(await catalogRoutes({ ...query, usage })));
    } else {
      const disclosure = { revision: 'fixture-1', text: 'Fixture setup', links: [] };
      const setupActions = [{ id: 'credential', kind: 'provide-secret', label: 'Credential', secretLabel: 'Credential', digest: 'fixture-secret', disclosure },
        { id: 'address', kind: 'provide-value', label: 'Address', valueFormat: 'domain', digest: 'fixture-address', disclosure }];
      const registry = await fakeRegistry({ setupActions, id: 'screen-fixture', kinds: ['session', 'durable'], reach: 'internet', dir: join(home, 'registry') });
      try {
        const api = createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home }), profileHome: join(home, 'profile') });
        const initial = await api.catalogRoutes(query);
        for (const action of initial.candidates[0].configuration.actions) {
          const approval = { digest: action.digest, disclosureRevision: action.disclosure.revision };
          if (action.kind === 'provide-secret') {
            const { handle } = await storeSecret({ home, value: 'fixture-credential-value' });
            await api.runSetupAction({ home, actionId: action.id, secretHandle: handle, approval });
          } else await api.runSetupAction({ home, actionId: action.id, value: 'screen.example.invalid', approval });
        }
        console.log(renderScreen(await api.catalogRoutes(query), fakeRouteScenarios({ target: query.target })));
      } finally { await registry.cleanup(); }
    }
  } finally { await rm(home, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv[2]);
