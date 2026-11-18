// Machine check of the Gozar consumer contract: schemas, fixtures and the error table must agree.
// The validator below implements only the JSON Schema keywords the two schemas use; it throws on any
// other keyword, so a schema cannot silently rely on a keyword this test does not enforce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const catalogSchema = await json('runtime/route-catalog.schema.json');
const adapterSchema = await json('runtime/adapter.schema.json');
const fixtures = await json('test/fixtures/route-contract.json');
const schemas = { 'route-catalog': catalogSchema, adapter: adapterSchema };

const annotations = new Set(['$schema', '$id', 'title', 'description', '$defs']);
const kinds = {
  string: v => typeof v === 'string', number: v => typeof v === 'number' && Number.isFinite(v), integer: v => Number.isInteger(v),
  boolean: v => typeof v === 'boolean', null: v => v === null, array: Array.isArray,
  object: v => typeof v === 'object' && v !== null && !Array.isArray(v),
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Returns a list of error strings; empty means valid. */
function validate(schema, value, defs, path = '$') {
  const errors = [];
  for (const key of Object.keys(schema)) {
    if (annotations.has(key)) continue;
    switch (key) {
      case '$ref': {
        const match = /^#\/\$defs\/([A-Za-z0-9]+)$/.exec(schema.$ref);
        if (!match || !defs[match[1]]) throw new Error(`Unresolvable $ref ${schema.$ref}`);
        errors.push(...validate(defs[match[1]], value, defs, path));
        break;
      }
      case 'type': {
        const types = [].concat(schema.type);
        for (const type of types) if (!kinds[type]) throw new Error(`Unsupported type ${type}`);
        if (!types.some(type => kinds[type](value))) errors.push(`${path}: expected ${types.join('|')}`);
        break;
      }
      case 'const': if (!same(value, schema.const)) errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`); break;
      case 'enum': if (!schema.enum.some(item => same(item, value))) errors.push(`${path}: not in enum`); break;
      case 'minimum': if (typeof value === 'number' && value < schema.minimum) errors.push(`${path}: below minimum`); break;
      case 'pattern': if (typeof value === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern mismatch`); break;
      case 'required':
        if (kinds.object(value)) for (const name of schema.required) if (!Object.hasOwn(value, name)) errors.push(`${path}: missing ${name}`);
        break;
      case 'properties':
        if (kinds.object(value)) for (const [name, sub] of Object.entries(schema.properties)) if (Object.hasOwn(value, name)) errors.push(...validate(sub, value[name], defs, `${path}.${name}`));
        break;
      case 'additionalProperties':
        if (kinds.object(value)) for (const name of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, name)) {
          if (schema.additionalProperties === false) errors.push(`${path}: unknown property ${name}`);
          else errors.push(...validate(schema.additionalProperties, value[name], defs, `${path}.${name}`));
        }
        break;
      case 'items': if (Array.isArray(value)) value.forEach((item, i) => errors.push(...validate(schema.items, item, defs, `${path}[${i}]`))); break;
      case 'oneOf': {
        const hits = schema.oneOf.filter(sub => validate(sub, value, defs, path).length === 0).length;
        if (hits !== 1) errors.push(`${path}: matches ${hits} oneOf branches`);
        break;
      }
      case 'anyOf': if (!schema.anyOf.some(sub => validate(sub, value, defs, path).length === 0)) errors.push(`${path}: matches no anyOf branch`); break;
      case 'not': if (!validate(schema.not, value, defs, path).length) errors.push(`${path}: matches forbidden schema`); break;
      default: throw new Error(`Unsupported schema keyword ${key} at ${path}`);
    }
  }
  return errors;
}
const check = (schemaName, shape, value) => {
  const defs = schemas[schemaName].$defs;
  assert.ok(defs[shape], `${schemaName} has no $defs.${shape}`);
  return validate(defs[shape], value, defs);
};

const consumerShapes = ['Reach', 'Usage', 'Requirements', 'Query', 'Disclosure', 'Action', 'Properties', 'Candidate', 'Catalog', 'Handle', 'Ingress', 'RouteView', 'Approval',
  'GozarError', 'ErrorCode', 'PreferenceRecord', 'SetupActionResult', 'WatchEvent', 'InspectLegacyRouteResult', 'ResolveClientAddressResult', 'Binding', 'Availability', 'Prerequisite', 'Fact'];

test('both schemas parse, use only supported keywords and resolve every $ref', () => {
  for (const [name, schema] of Object.entries(schemas)) {
    const defs = schema.$defs;
    for (const [shape, def] of Object.entries(defs)) assert.doesNotThrow(() => validate(def, null, defs), `${name}.${shape}`);
  }
});

test('request and response schema versions are explicit', () => {
  for (const shape of ['Query', 'Catalog', 'RouteView', 'GozarError', 'PreferenceRecord', 'SetupActionResult', 'WatchEvent', 'InspectLegacyRouteResult']) {
    assert.deepEqual(catalogSchema.$defs[shape].properties.schemaVersion, { const: ['Catalog','RouteView'].includes(shape) ? 2 : 1 }, shape);
  }
  assert.deepEqual(adapterSchema.$defs.AdapterDefinition.properties.schemaVersion, { const: 1 });
});

test('route-catalog.schema.json has a $defs entry per consumer shape', () => {
  for (const shape of consumerShapes) assert.ok(catalogSchema.$defs[shape], shape);
});

test('adapter.schema.json shares Cost, Properties, Reach and Disclosure with the catalog schema verbatim', () => {
  for (const shape of ['Cost', 'Properties', 'Reach', 'Disclosure']) assert.deepEqual(adapterSchema.$defs[shape], catalogSchema.$defs[shape], shape);
});

test('closed shapes reject unknown properties', () => {
  for (const [name, schema] of Object.entries(schemas)) {
    for (const [shape, def] of Object.entries(schema.$defs)) if (def.type === 'object' && !['Configuration'].includes(shape)) assert.equal(def.additionalProperties, false, `${name}.${shape}`);
  }
});

test('every consumer shape has at least one valid fixture, and every valid fixture passes', () => {
  const covered = new Set(fixtures.valid.map(item => item.shape));
  for (const shape of [...consumerShapes, 'AdapterDefinition', 'ProviderEntry', 'AdapterPlan', 'AdapterEffectError']) assert.ok(covered.has(shape), `no valid fixture for ${shape}`);
  assert.deepEqual(fixtures.valid.flatMap(item=>check(item.schema,item.shape,item.value).map(error=>`${item.shape}: ${item.name}: ${error}`)),[]);
});

test('valid catalog fixtures cover eligible, ineligible, macOS-unsupported, setup-required and unknown-privacy candidates', () => {
  const candidates = fixtures.valid.filter(item => item.shape === 'Candidate').map(item => item.value);
  assert.ok(candidates.some(c => c.eligible && c.setup.state === 'ready' && c.candidateToken));
  assert.ok(candidates.some(c => !c.eligible && c.unmet.length && c.candidateToken === null));
  assert.ok(candidates.some(c => c.setup.state === 'unsupported' && c.unmet.some(u => u.actual === 'darwin')));
  assert.ok(candidates.some(c => c.setup.state === 'action-required' && c.setup.actions.length));
  assert.ok(candidates.some(c => c.properties.traffic.providerCanReadPayload === null && c.properties.address.stability === 'unknown'));
});

test('every invalid fixture is rejected, names its shape and says why', () => {
  assert.ok(fixtures.invalid.length >= 7);
  for (const item of fixtures.invalid) {
    assert.ok(item.shape && item.why && item.name, JSON.stringify(item.name));
    assert.notDeepEqual(check(item.schema, item.shape, item.value), [], `${item.shape}: ${item.name} must fail`);
  }
});

test('the required invalid cases are present', () => {
  const has = pattern => fixtures.invalid.some(item => pattern.test(`${item.shape} ${item.name}`));
  for (const pattern of [/unknown schemaVersion/, /missing cost/, /missing needsAccount/, /missing traffic/, /extra unknown property/, /incomplete/, /Query provider-enum field adapterId/, /action-required candidate carries a token/, /Requirements reach unknown/, /AdoptRouteRequest intent create/]) assert.ok(has(pattern), String(pattern));
});

test('every errorNormalization target is in the frozen union, which equals the schema enum', () => {
  assert.deepEqual([...fixtures.frozenErrorCodes].sort(), [...catalogSchema.$defs.ErrorCode.enum].sort());
  assert.equal(fixtures.frozenErrorCodes.length, 31);
  for (const [code, entry] of Object.entries(fixtures.errorNormalization)) assert.ok(fixtures.frozenErrorCodes.includes(entry.target), `${code} -> ${entry.target}`);
});

test('every adapterEffectErrors target is in the frozen union and the keys match the d.ts AdapterEffectError', async () => {
  for (const [code, entry] of Object.entries(fixtures.adapterEffectErrors)) assert.ok(fixtures.frozenErrorCodes.includes(entry.target), `${code} -> ${entry.target}`);
  assert.equal(fixtures.adapterEffectErrors.precondition_failed.target, 'provider_unavailable');
  const text = await readFile(join(root, 'packages/gozar-node/adapter-contract.d.ts'), 'utf8');
  const block = /export type AdapterEffectError = \{\s*code:([^;]+);/.exec(text)[1];
  assert.deepEqual([...block.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort(), Object.keys(fixtures.adapterEffectErrors).sort());
  assert.deepEqual([...adapterSchema.$defs.AdapterEffectError.properties.code.enum].sort(), Object.keys(fixtures.adapterEffectErrors).sort());
  // Every non-internal adapter outcome is itself a frozen code.
  for (const code of Object.keys(fixtures.adapterEffectErrors)) if (code !== 'precondition_failed') assert.ok(fixtures.frozenErrorCodes.includes(code), code);
});

test('the frozen union is the same list the d.ts declares', async () => {
  const text = await readFile(join(root, 'packages/gozar-node/route-contract.d.ts'), 'utf8');
  const block = /export type GozarErrorCode =([^;]+);/.exec(text)[1];
  assert.deepEqual([...block.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort(), [...fixtures.frozenErrorCodes].sort());
});

// Error codes the source can produce today: literal first arguments of refuse()/typed()/gozarError() and `code: '...'`.
// Amendment 3: a code in the frozen union is mapped to itself, so it needs no fixture key.
const codePatterns = [/\brefuse\(\s*'([^']+)'/g, /\btyped\(\s*'([^']+)'/g, /\bgozarError\(\s*'([^']+)'/g, /\bcode:\s*'([^']+)'/g];
export const scanCodes = text => [...codePatterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => match[1]))];
export const unmappedCodes = (codes, normalization, frozen) => codes.filter(code => !Object.hasOwn(normalization, code) && !frozen.includes(code));

async function sourceCodes() {
  const files = (await readdir(join(root, 'packages/gozar-node'))).filter(name => name.endsWith('.mjs')).map(name => `packages/gozar-node/${name}`);
  files.push('bin/gozar.mjs');
  // Adapters raise errors that reach apps too, including the provider code they share under adapters/providers/_shared.
  const providers = await readdir(join(root, 'adapters/providers'), { recursive: true });
  files.push(...providers.filter(name => name.endsWith('.mjs')).map(name => `adapters/providers/${name}`));
  const found = new Set();
  let dynamic = false;
  for (const file of files) {
    const text = await readFile(join(root, file), 'utf8');
    for (const code of scanCodes(text)) found.add(code);
    if (/\brefuse\(\s*(?:record|current)\.state\b/.test(text)) dynamic = true;
  }
  return { found, dynamic };
}

test('the error codes in the source equal the errorNormalization keys', async () => {
  const { found, dynamic } = await sourceCodes();
  const keys = new Set(Object.keys(fixtures.errorNormalization));
  const dynamicKeys = Object.entries(fixtures.errorNormalization).filter(([, entry]) => entry.dynamic).map(([code]) => code);
  const unmapped = unmappedCodes([...found], fixtures.errorNormalization, fixtures.frozenErrorCodes);
  assert.deepEqual(unmapped, [], `source codes have no errorNormalization entry and are not frozen: ${unmapped.join(', ')}`);
  for (const code of keys) if (!found.has(code)) assert.ok(dynamicKeys.includes(code), `errorNormalization.${code} no longer appears in the source`);
  if (dynamicKeys.length) assert.ok(dynamic, 'dynamic state codes are listed but the source no longer throws refuse(<record>.state)');
});

test('red: the scan still fails on a non-union code that has no fixture key, and accepts a frozen one', () => {
  const mutated = "throw gozarError('made_up_provider_code', 'x'); throw refuse('invalid_input', 'y'); const e = { code: 'also_made_up' };";
  assert.deepEqual(unmappedCodes(scanCodes(mutated), fixtures.errorNormalization, fixtures.frozenErrorCodes), ['made_up_provider_code', 'also_made_up']);
  assert.deepEqual(unmappedCodes(scanCodes("gozarError('route_not_found', 'x')"), fixtures.errorNormalization, fixtures.frozenErrorCodes), []);
});

test('a candidate token appears only when eligible and setup is ready; unmet entries use the closed vocabulary', () => {
  const candidates = fixtures.valid.flatMap(item => item.shape === 'Catalog' ? item.value.candidates : item.shape === 'Candidate' ? [item.value] : []);
  assert.ok(candidates.length >= 5);
  for (const c of candidates) {
    if (c.candidateToken !== null) assert.ok(c.eligible && c.setup.state === 'ready', c.name);
    for (const u of c.unmet) {
      assert.ok(['reach', 'transport', 'payloadAccess', 'address', 'setup', 'protocols', 'usage', 'platform'].includes(u.requirement), u.requirement);
      assert.ok(['not_met', 'unknown', 'unsupported_platform'].includes(u.reasonCode), u.reasonCode);
    }
  }
  assert.ok(candidates.some(c => c.setup.state === 'action-required' && c.candidateToken === null));
});

test('every provisional mapping carries its open question', () => {
  for (const [code, entry] of Object.entries(fixtures.errorNormalization)) if (entry.provisional) assert.ok(entry.question, code);
});

test('no fixture holds a real-looking secret or private name', async () => {
  const text = await readFile(join(root, 'test/fixtures/route-contract.json'), 'utf8');
  for (const token of text.matchAll(/"(tok_[A-Za-z0-9_]+)"/g)) assert.match(token[1], /^tok_synthetic_/);
  assert.doesNotMatch(text, /\/home\/|\/Users\//);
});

test('unknown Catalog and RouteView versions fail only the version invariant', () => {
  for (const shape of ['Catalog', 'RouteView']) {
    const current = fixtures.valid.find(item => item.schema === 'route-catalog' && item.shape === shape);
    const unknown = fixtures.invalid.find(item => item.shape === shape && item.name === 'unknown schemaVersion');
    assert.ok(current && unknown, shape);
    assert.equal(current.value.schemaVersion, 2);
    assert.deepEqual(check('route-catalog', shape, current.value), []);
    assert.equal(unknown.value.schemaVersion, 999);
    assert.deepEqual({ ...unknown.value, schemaVersion: 2 }, current.value, 'only version may differ');
    assert.deepEqual(check('route-catalog', shape, unknown.value), ['$.schemaVersion: expected const 2']);
    assert.match(unknown.why, /constant 2/);
  }
});

test('direct observation fixtures cover detect-only, consent change and known binding authorities', () => {
  const values = shape => fixtures.valid.filter(item => item.schema === 'route-catalog' && item.shape === shape).map(item => item.value);
  const detectOnly = values('Candidate').find(value => value.setup.state === 'detect-only');
  assert.ok(detectOnly);
  assert.equal(detectOnly.candidateToken, null);
  assert.equal(detectOnly.eligible, false);
  assert.ok(Object.values(detectOnly.availability).some(value => value.state === 'detect-only'));
  const changed = values('WatchEvent').find(value => value.type === 'consent_changed');
  assert.ok(changed);
  assert.notEqual(changed.oldDigest, changed.newDigest);
  assert.deepEqual(check('route-catalog', 'Action', changed.nextAction), []);
  for (const authority of ['adapter', 'owner']) {
    const binding = values('Binding').find(value => value.authority === authority);
    assert.ok(binding, authority);
    assert.equal(binding.target.known, true);
    assert.ok(binding.target.value);
    assert.notEqual(binding.remedy, null);
    assert.deepEqual(check('route-catalog', 'Action', binding.remedy), []);
  }
  for (const state of ['available', 'detect-only', 'unsupported'])
    assert.ok(values('Availability').some(value => Object.values(value).some(entry => entry.state === state)), state);
  for (const known of [true, false]) {
    assert.ok(values('Prerequisite').some(value => value.observation.known === known));
    assert.ok(values('Fact').some(value => value.known === known));
  }
  for (const transport of ['https', 'tcp', 'tls', 'any'])
    assert.ok(values('Requirements').some(value => value.transport === transport), transport);
});

test('new direct observation shapes remain closed to unknown fields', () => {
  for (const shape of ['Binding', 'Availability', 'Prerequisite', 'Fact']) {
    const item = fixtures.valid.find(item => item.schema === 'route-catalog' && item.shape === shape);
    assert.ok(item, shape);
    assert.deepEqual(check('route-catalog', shape, item.value), []);
    assert.notDeepEqual(check('route-catalog', shape, { ...item.value, unexpectedFixtureField: true }), []);
  }
});

test('setup journal projection rejects unsafe removal and secret-bearing evidence', () => {
  const resource = {
    handle: 'entry-1', kind: 'dns', label: 'Exact DNS record',
    ownership: 'owned', removal: 'confirmed', presence: { known: true, value: false },
  };
  const operation = {
    schemaVersion: 1, operationId: 'fixture-operation', revision: 1,
    scope: { registryId: 'registry', scopeId: 'scope', providerId: 'provider', configurationRevision: 'revision', draftId: null },
    state: 'cancelled', evidence: { known: false, reason: 'response-lost' }, nextAction: null,
    resources: [resource],
  };
  assert.deepEqual(check('route-catalog', 'SetupOperation', operation), []);
  for (const replacement of [
    { ...resource, ownership: 'foreign' },
    { ...resource, ownership: 'adopted' },
    { ...resource, presence: { known: false, reason: 'read-denied' } },
  ]) {
    assert.notEqual(check('route-catalog', 'SetupOperation', { ...operation, resources: [replacement] }).length, 0);
  }
  assert.notEqual(check('route-catalog', 'SetupOperation', {
    ...operation, evidence: { ...operation.evidence, secretHandle: 'fixture-secret-handle' },
  }).length, 0);
});

const setupProjectionFixture = () => {
  const step = { actor: 'owner', permission: { id: 'authorize', label: 'Authorize' },
    verification: 'provider', purpose: 'authorize',
    browser: { expiresAt: '2030-01-01T00:00:00Z', pollAfterMs: 1000 } };
  const action = { id: 'authorize', kind: 'open-url', label: 'Authorize', digest: 'digest',
    disclosure: { revision: 'revision', text: 'Fixture', links: [] }, step };
  const scope = { kind: 'setup', registryId: 'registry', scopeId: 'scope', providerId: 'provider',
    configurationRevision: 'revision', draftId: null, actionId: action.id,
    disclosureRevision: 'revision', actionDigest: action.digest };
  const consent = { scope, consentFactsDigest: 'consent-v1:fixture', facts: [], disclosures: { action } };
  const operation = { schemaVersion: 1, operationId: 'operation', revision: 1,
    scope: { registryId: 'registry', scopeId: 'scope', providerId: 'provider', configurationRevision: 'revision', draftId: null },
    state: 'authorization-required', evidence: { known: false, reason: 'not-observed' },
    nextAction: { ...action, consent }, resources: [] };
  return { action, consent, operation };
};

test('setup projection closes nested consent, not just the operation action', () => {
  const { action, consent, operation } = setupProjectionFixture();
  const href = 'https://provider.invalid/transient-fixture';
  const review = { canonicalInput: { fixture: 'private-review' } };
  const valid = (shape, value) => assert.deepEqual(check('route-catalog', shape, value), [], shape);
  const invalid = (shape, value) => assert.notDeepEqual(check('route-catalog', shape, value), [], shape);
  for (const shape of ['SetupOperation', 'InteractiveSetupOperation']) {
    valid(shape, operation);
    invalid(shape, { ...operation, nextAction: { ...operation.nextAction, review } });
    for (const leak of [{ review }, { href }, { consent }]) {
      const nested = { ...consent, disclosures: { action: { ...action, ...leak } } };
      invalid(shape, { ...operation, nextAction: { ...operation.nextAction, consent: nested } });
      invalid('SetupConsentSnapshot', nested);
      invalid('ConsentSnapshot', nested);
      invalid('ConsentDisclosures', nested.disclosures);
      invalid('ConsentAction', nested.disclosures.action);
    }
  }
  const interactive = { ...operation, nextAction: { ...operation.nextAction, href } };
  invalid('SetupOperation', interactive);
  valid('InteractiveSetupOperation', interactive);
  // Interactive permission never propagates into consent.
  invalid('InteractiveSetupOperation', { ...interactive, nextAction: { ...interactive.nextAction,
    consent: { ...consent, disclosures: { action: { ...action, href } } } } });
  const { browser, ...documentationStep } = action.step;
  const documentation = { ...action, step: documentationStep, href: 'https://provider.invalid/docs' };
  valid('ConsentAction', documentation);
  valid('ConsentDisclosures', { action: documentation });
  valid('SetupConsentSnapshot', { ...consent, disclosures: { action: documentation } });
  valid('SetupOperation', { ...operation, nextAction: { ...documentation,
    consent: { ...consent, disclosures: { action: documentation } } } });
  // Legacy Action remains unrestricted; only public operation/consent projections close it.
  valid('Action', { ...action, href, review });
});

test('setup reservation forbids each input independently, positive commands remain admitted', () => {
  const reservation = { home: '/fixture', owner: 'owner', providerId: 'provider', operationId: 'operation',
    actionId: 'action', expectedConfigurationRevision: 'revision', expectedSetupRevision: 0 };
  assert.deepEqual(check('route-catalog', 'RunSetupOperationRequest', reservation), []);
  const approval = { kind: 'setup', digest: 'digest', disclosureRevision: 'revision', consentFactsDigest: 'consent-v1:fixture' };
  for (const input of [{ approval }, { value: 'fixture-value' }, { secretHandle: 'fixture-handle' }]) {
    assert.notDeepEqual(check('route-catalog', 'RunSetupOperationRequest', { ...reservation, ...input }), []);
    assert.deepEqual(check('route-catalog', 'RunSetupOperationRequest', { ...reservation, expectedSetupRevision: 1, ...input }), []);
  }
  for (const expectedSetupRevision of [-1, 0.5])
    assert.notDeepEqual(check('route-catalog', 'RunSetupOperationRequest', { ...reservation, expectedSetupRevision }), []);
});

// Reusable strict fixture for the host's REAL INSTALLED public package, not copied declarations.
// No compiler skip is acceptance. The host must invoke checkSetupProjectionTypes below with its
// installed TypeScript API and a consumer directory resolving @tnunamak/gozar.
export const setupProjectionTypes = String.raw`
import { runSetupAction, readSetupOperation, cancelSetupOperation, createGozar } from '@tnunamak/gozar';
import type { Action, SafeSetupAction, SetupStep, SetupOperation, InteractiveSetupOperation,
  SetupConsentSnapshot, SetupConsentDisclosures, RunSetupOperationRequest,
  RunSetupActionRequest, SetupActionResult } from '@tnunamak/gozar';
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type LegacyParameters = Expect<Equal<Parameters<typeof runSetupAction>, [request: RunSetupActionRequest]>>;
type LegacyReturn = Expect<Equal<ReturnType<typeof runSetupAction>, Promise<SetupActionResult>>>;
declare const legacy: RunSetupActionRequest;
const legacyResult: Promise<SetupActionResult> = runSetupAction(legacy);
const ref = { home: '/fixture', owner: 'owner', providerId: 'provider', operationId: 'operation' };
const command = { ...ref, actionId: 'action', expectedConfigurationRevision: 'revision' };
const approval = { kind: 'setup' as const, digest: 'digest', disclosureRevision: 'revision', consentFactsDigest: 'consent-v1:fixture' };
const reservation: RunSetupOperationRequest<0> = { ...command, expectedSetupRevision: 0 };
const positive: RunSetupOperationRequest<1> = { ...command, expectedSetupRevision: 1, approval, value: 'value', secretHandle: 'handle' };
runSetupAction(reservation);
runSetupAction(positive);
runSetupAction({ ...command, expectedSetupRevision: 0 });
runSetupAction({ ...command, expectedSetupRevision: 1, approval });
runSetupAction({ ...command, expectedSetupRevision: 2, value: 'value' });
runSetupAction({ ...command, expectedSetupRevision: 3, secretHandle: 'handle' });
// @ts-expect-error Literal zero cannot carry approval.
runSetupAction({ ...command, expectedSetupRevision: 0, approval });
// @ts-expect-error Literal zero cannot carry value.
runSetupAction({ ...command, expectedSetupRevision: 0, value: 'value' });
// @ts-expect-error Literal zero cannot carry secretHandle.
runSetupAction({ ...command, expectedSetupRevision: 0, secretHandle: 'handle' });
// @ts-expect-error Explicit request type has the same zero boundary.
const badReservation: RunSetupOperationRequest<0> = { ...command, expectedSetupRevision: 0, value: 'value' };
const zeroVariable = { ...command, expectedSetupRevision: 0 as const, value: 'value' };
// @ts-expect-error A non-fresh variable must not bypass the literal-zero check.
runSetupAction(zeroVariable);
declare const dynamicRevision: number;
runSetupAction({ ...command, expectedSetupRevision: dynamicRevision, value: 'value' }); // runtime validates
declare const flag: boolean;
const safe = readSetupOperation(ref);
const safeFalse = readSetupOperation({ ...ref, includeBrowserHandoff: false });
const interactive = readSetupOperation({ ...ref, includeBrowserHandoff: true });
const dynamic = readSetupOperation({ ...ref, includeBrowserHandoff: flag });
type Safe = Expect<Equal<Awaited<typeof safe>, SetupOperation>>;
type SafeFalse = Expect<Equal<Awaited<typeof safeFalse>, SetupOperation>>;
type Interactive = Expect<Equal<Awaited<typeof interactive>, InteractiveSetupOperation>>;
type Dynamic = Expect<Equal<Awaited<typeof dynamic>, SetupOperation | InteractiveSetupOperation>>;
const cancelled: Promise<SetupOperation> = cancelSetupOperation(ref);
const api = createGozar();
const factorySafe: Promise<SetupOperation> = api.readSetupOperation(ref);
const factoryInteractive: Promise<InteractiveSetupOperation> = api.readSetupOperation({ ...ref, includeBrowserHandoff: true });
// @ts-expect-error The factory must preserve zero-input exclusion too.
api.runSetupAction(zeroVariable);
declare const base: Omit<Action, 'step' | 'href' | 'review' | 'consent'>;
declare const step: Omit<SetupStep, 'browser'>;
const browserStep = { ...step, browser: { expiresAt: '2030-01-01', pollAfterMs: 1000 } };
const browser = { ...base, step: browserStep, href: 'https://provider.invalid/transient' };
const raw = { ...base, review: { canonicalInput: { private: 'fixture' } } };
const recursive = { ...base, consent: {} as SetupConsentSnapshot };
const legacyBrowser: Action = browser;
const legacyReview: Action = raw;
const docs: SafeSetupAction = { ...base, href: 'https://provider.invalid/docs' };
const safeBrowser: SafeSetupAction = { ...base, step: browserStep };
// @ts-expect-error Safe action cannot structurally carry raw review.
const rawSafe: SafeSetupAction = raw;
// @ts-expect-error Safe action cannot recursively hide unrestricted consent.
const recursiveSafe: SafeSetupAction = recursive;
// @ts-expect-error Browser handoff is not safe even through a variable.
const leakedSafe: SafeSetupAction = browser;
declare const consent: SetupConsentSnapshot;
declare const operation: SetupOperation;
const offer = { ...base, step: browserStep, consent };
const safeOperation: SetupOperation = { ...operation, nextAction: offer };
const interactiveOperation: InteractiveSetupOperation = { ...operation, nextAction: { ...offer, href: browser.href } };
// @ts-expect-error Root operation review must not leak structurally.
const leakedRoot: SetupOperation = { ...operation, nextAction: { ...offer, review: raw.review } };
// @ts-expect-error Interactive root also forbids raw review.
const leakedInteractiveRoot: InteractiveSetupOperation = { ...operation, nextAction: { ...offer, review: raw.review } };
// @ts-expect-error Ordinary operation cannot expose browser href.
const leakedOperation: SetupOperation = { ...operation, nextAction: { ...offer, href: browser.href } };
// @ts-expect-error Nested snapshot browser href never inherits interactive permission.
const leakedConsent: SetupConsentSnapshot = { ...consent, disclosures: { action: browser } };
// @ts-expect-error Nested raw review must fail through a non-fresh variable.
const rawConsent: SetupConsentDisclosures = { action: raw };
// @ts-expect-error Interactive consent has the same closed action.
const leakedInteractiveConsent: InteractiveSetupOperation = { ...operation, nextAction: { ...offer, consent: { ...consent, disclosures: { action: browser } } } };
`;

export function checkSetupProjectionTypes(ts, consumerDirectory) {
  assert.ok(ts?.createProgram, 'An installed TypeScript compiler is required; absence is NOT type acceptance');
  assert.ok(consumerDirectory, 'Supply the real installed-package consumer directory');
  const fileName = join(consumerDirectory, 'setup-projection.fixture.mts');
  const options = { strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host), source = host.getSourceFile.bind(host);
  host.fileExists = path => path === fileName || exists(path);
  host.readFile = path => path === fileName ? setupProjectionTypes : read(path);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fileName ? ts.createSourceFile(path, setupProjectionTypes, languageVersion, true)
      : source(path, languageVersion, onError, shouldCreateNewSourceFile);
  const resolved = ts.resolveModuleName('@tnunamak/gozar', fileName, options, host).resolvedModule;
  assert.ok(resolved?.isExternalLibraryImport && /node_modules[\\/]/.test(resolved.resolvedFileName),
    'The fixture must resolve the real installed package, not repository declaration copies');
  const program = ts.createProgram([fileName], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => consumerDirectory, getCanonicalFileName: name => name, getNewLine: () => '\n',
  }));
}
