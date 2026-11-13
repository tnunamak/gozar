import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { plainCaveat } from '../../packages/gozar-node/plain-copy.mjs';
import { ways, trafficFacts } from '../../packages/gozar-node/expose-copy.mjs';
const root = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const banned = /intended-vantage|source-shaped|cleanup debt|immutable process identity|instance proof|capability-port|readback|fail safely|fails closed|precondition|admitted|unknown\.|\bready\b|Ctrl-C/i;
export async function presentationStrings() {
  const strings = new Set();
  for (const file of await readdir(new URL('adapters/', root))) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(await read(`adapters/${file}`));
    for (const a of Array.isArray(data) ? data : data.adapters ?? [data.definition ?? data]) {
      for (const text of a.unknowns ?? []) strings.add(text);
      for (const item of [a, a.copy ?? {}, ...a.actions ?? []]) for (const key of ['reason', 'fix']) if (typeof item[key] === 'string') strings.add(item[key]);
    }
  }
  for (const file of ['lib.rs', 'operational.rs']) {
    const text = await read(`crates/gozar-core/src/${file}`);
    for (const match of text.matchAll(/(?:Err\(\s*|ok_or_else\(\|\|\s*)format!\("([^"]+)"/g)) strings.add(match[1].replace(/\{[^}]+\}/g, 'value'));
    for (const pattern of [/(?:Err|ok_or)\(\s*"([^"\n]+)"/g, /(?:limit|withdraw)\(\s*(?:&mut )?out,\s*"([^"\n]+)"/g]) {
      for (const match of text.matchAll(pattern)) strings.add(match[1]);
    }
  }
  for (const file of ['driver', 'host', 'controller']) {
    const text = await read(`packages/gozar-node/${file}.mjs`);
    for (const match of text.matchAll(/new Error\(\s*`([^`]+)`/g)) {
      for (const stage of ['before', 'after']) strings.add(match[1].replaceAll('${stage}', stage).replace(/\$\{[^}]+\}/g, 'value'));
    }
    for (const match of text.matchAll(/new Error\(\s*['"]([^'"\n]+)['"]/g)) strings.add(match[1]);
  }
  // All dynamic message families have fixed prefixes; stage is before/after only.
  for (const text of ['Unbound recipe field: value', 'Unsupported before readback; detail', 'Unsupported after readback; detail', 'before readback failed; detail', 'after readback failed; detail',
    'Unresolved typed binding: value', 'Invalid typed binding value', 'Missing typed binding value', 'Unsupported core/host plan feature: value', 'Controller unavailable: detail',
    'Owned resources remain recorded; restart reconciliation is required.']) strings.add(text);
  return strings;
}
test('every catalog caveat, core limitation and host failure has reviewed plain copy', async () => {
  for (const text of await presentationStrings()) assert.ok(plainCaveat(text).plain, `Missing plain copy: ${text}`);
  const catalog = JSON.parse(await read('runtime/plain-copy.json'));
  const schema = JSON.parse(await read('runtime/plain-copy.schema.json'));
  for (const [key, copy] of [...Object.entries(catalog.caveats), ...catalog.patterns.map(c => [c.prefix, c])]) {
    assert.ok(copy.plain.length, key);
    assert.equal(typeof copy.decision, 'boolean', key);
    assert.ok(schema.$defs.Copy.properties.kind.enum.includes(copy.kind), key);
    assert.deepEqual(Object.keys(copy).sort(), (copy.prefix ? schema.$defs.Pattern.required : schema.$defs.Copy.required).toSorted(), key);
    assert.doesNotMatch(copy.plain, banned, key);
  }
  for (const way of Object.values(ways)) for (const text of Object.values(way)) assert.doesNotMatch(text, banned);
  for (const text of Object.values(trafficFacts)) if (text) assert.doesNotMatch(text, banned);
  assert.deepEqual(plainCaveat('an unexpected secret provider detail'), {});
  for (const text of ['Unresolved typed binding: port','Invalid typed binding name','Missing typed binding port','Unsupported core/host plan feature: new','Controller unavailable: socket error']) assert.ok(plainCaveat(text).plain);
});
