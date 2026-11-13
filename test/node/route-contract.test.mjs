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
        if (kinds.object(value)) for (const name of schema.required) if (!(name in value)) errors.push(`${path}: missing ${name}`);
        break;
      case 'properties':
        if (kinds.object(value)) for (const [name, sub] of Object.entries(schema.properties)) if (name in value) errors.push(...validate(sub, value[name], defs, `${path}.${name}`));
        break;
      case 'additionalProperties':
        if (kinds.object(value)) for (const name of Object.keys(value)) if (!(name in (schema.properties ?? {}))) {
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
  'GozarError', 'ErrorCode', 'PreferenceRecord', 'SetupActionResult', 'WatchEvent', 'InspectLegacyRouteResult', 'ResolveClientAddressResult'];

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

test('adapter.schema.json shares Properties, Reach and Disclosure with the catalog schema verbatim', () => {
  for (const shape of ['Properties', 'Reach', 'Disclosure']) assert.deepEqual(adapterSchema.$defs[shape], catalogSchema.$defs[shape], shape);
});

test('closed shapes reject unknown properties', () => {
  for (const [name, schema] of Object.entries(schemas)) {
    for (const [shape, def] of Object.entries(schema.$defs)) if (def.type === 'object' && !['Configuration'].includes(shape)) assert.equal(def.additionalProperties, false, `${name}.${shape}`);
  }
});

test('every consumer shape has at least one valid fixture, and every valid fixture passes', () => {
  const covered = new Set(fixtures.valid.map(item => item.shape));
  for (const shape of [...consumerShapes, 'AdapterDefinition', 'ProviderEntry', 'AdapterPlan', 'AdapterEffectError']) assert.ok(covered.has(shape), `no valid fixture for ${shape}`);
  for (const item of fixtures.valid) assert.deepEqual(check(item.schema, item.shape, item.value), [], `${item.shape}: ${item.name}`);
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
  assert.equal(fixtures.frozenErrorCodes.length, 21);
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
