import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const { adapter: { disclosure } } = JSON.parse(
  await readFile(new URL('./definition.json', import.meta.url), 'utf8'),
);

test('trial consent names the requested lifetime when no duration is available', () => {
  assert.match(disclosure.text, /for the requested lifetime\./);
});

test('trial consent does not state a default number of minutes', () => {
  assert.doesNotMatch(disclosure.text, /15 minutes/i);
});
