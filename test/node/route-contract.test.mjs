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
        if (schema.additionalProperties !== false) throw new Error('Only additionalProperties:false is supported');
        if (kinds.object(value)) for (const name of Object.keys(value)) if (!(name in (schema.properties ?? {}))) errors.push(`${path}: unknown property ${name}`);
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

test('schemaVersion is const 1 wherever a shape carries it', () => {
  for (const shape of ['Query', 'Catalog', 'RouteView', 'GozarError', 'PreferenceRecord', 'SetupActionResult', 'WatchEvent', 'InspectLegacyRouteResult']) {
    assert.deepEqual(catalogSchema.$defs[shape].properties.schemaVersion, { const: 1 }, shape);
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
    for (const [shape, def] of Object.entries(schema.$defs)) if (def.type === 'object') assert.equal(def.additionalProperties, false, `${name}.${shape}`);
  }
});

test('every consumer shape has at least one valid fixture, and every valid fixture passes', () => {
  const covered = new Set(fixtures.valid.map(item => item.shape));
  for (const shape of [...consumerShapes, 'AdapterDefinition', 'ProviderEntry']) assert.ok(covered.has(shape), `no valid fixture for ${shape}`);
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
  for (const pattern of [/unknown schemaVersion/, /missing cost/, /missing needsAccount/, /missing traffic/, /extra unknown property/, /incomplete/, /Query provider-enum field adapterId/]) assert.ok(has(pattern), String(pattern));
});

test('every errorNormalization target is in the frozen union, which equals the schema enum', () => {
  assert.deepEqual([...fixtures.frozenErrorCodes].sort(), [...catalogSchema.$defs.ErrorCode.enum].sort());
  assert.equal(fixtures.frozenErrorCodes.length, 19);
  for (const [code, entry] of Object.entries(fixtures.errorNormalization)) assert.ok(fixtures.frozenErrorCodes.includes(entry.target), `${code} -> ${entry.target}`);
});

test('the frozen union is the same list the d.ts declares', async () => {
  const text = await readFile(join(root, 'packages/gozar-node/route-contract.d.ts'), 'utf8');
  const block = /export type GozarErrorCode =([^;]+);/.exec(text)[1];
  assert.deepEqual([...block.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort(), [...fixtures.frozenErrorCodes].sort());
});

// Error codes the source can produce today: literal first arguments of refuse()/typed() and `code: '...'`.
async function sourceCodes() {
  const files = (await readdir(join(root, 'packages/gozar-node'))).filter(name => name.endsWith('.mjs')).map(name => `packages/gozar-node/${name}`);
  files.push('bin/gozar.mjs');
  const found = new Set();
  let dynamic = false;
  for (const file of files) {
    const text = await readFile(join(root, file), 'utf8');
    for (const pattern of [/\brefuse\(\s*'([^']+)'/g, /\btyped\(\s*'([^']+)'/g, /\bcode:\s*'([^']+)'/g]) for (const match of text.matchAll(pattern)) found.add(match[1]);
    if (/\brefuse\(\s*(?:record|current)\.state\b/.test(text)) dynamic = true;
  }
  return { found, dynamic };
}

test('the error codes in the source equal the errorNormalization keys', async () => {
  const { found, dynamic } = await sourceCodes();
  const keys = new Set(Object.keys(fixtures.errorNormalization));
  const dynamicKeys = Object.entries(fixtures.errorNormalization).filter(([, entry]) => entry.dynamic).map(([code]) => code);
  for (const code of found) assert.ok(keys.has(code), `source code ${code} has no errorNormalization entry: map it to a frozen code`);
  for (const code of keys) if (!found.has(code)) assert.ok(dynamicKeys.includes(code), `errorNormalization.${code} no longer appears in the source`);
  if (dynamicKeys.length) assert.ok(dynamic, 'dynamic state codes are listed but the source no longer throws refuse(<record>.state)');
});

test('every provisional mapping carries its open question', () => {
  for (const [code, entry] of Object.entries(fixtures.errorNormalization)) if (entry.provisional) assert.ok(entry.question, code);
});

test('no fixture holds a real-looking secret or private name', async () => {
  const text = await readFile(join(root, 'test/fixtures/route-contract.json'), 'utf8');
  for (const token of text.matchAll(/"(tok_[A-Za-z0-9_]+)"/g)) assert.match(token[1], /^tok_synthetic_/);
  assert.doesNotMatch(text, /\/home\/|\/Users\//);
});
