// The https-origin value format accepts every spelling of one https origin and stores its normal form.
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkValue } from '../../packages/gozar-node/route-setup.mjs';

test('red: an https origin with its default port, in capitals or with a trailing slash is accepted and stored normalized', () => {
  const accepted = { 'https://a.example.test': 'https://a.example.test', 'https://a.example.test/': 'https://a.example.test', 'https://a.example.test:443': 'https://a.example.test',
    'https://A.EXAMPLE.TEST': 'https://a.example.test', 'https://a.example.test:8443': 'https://a.example.test:8443', ' https://a.example.test ': 'https://a.example.test' };
  for (const [value, origin] of Object.entries(accepted)) assert.equal(checkValue('https-origin', value), origin, value);
  for (const value of ['http://a.example.test', 'https://u:p@a.example.test', 'https://a.example.test/path', 'https://a.example.test?q=1', 'https://a.example.test#x',
    '//a.example.test', 'javascript:alert(1)', 'a.example.test', '']) assert.equal(checkValue('https-origin', value), null, value);
});
