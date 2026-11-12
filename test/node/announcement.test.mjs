import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeAnnouncement } from '../../packages/gozar-node/announcement.mjs';
const parser = { kind: 'url', prefix: 'https://', jsonEvent: { eventPointer: '/event', eventValue: 'tunnel', originPointer: '/url' }, constraints: { hostnamePattern: '^[a-z0-9-]+\\.tunnl\\.gg$', exactOriginToken: true } };
const A = 'https://wild-fox-10bf6aa2.tunnl.gg';
test('JSON tunnel event reads only its exact origin, ignoring promotional and request URLs', () => {
  assert.equal(routeAnnouncement(parser, JSON.stringify({ event: 'tunnel', url: A, upgrade: 'https://tunnl.gg/pricing' })), A);
  assert.equal(routeAnnouncement(parser, JSON.stringify({ event: 'request', url: A })), null);
  assert.equal(routeAnnouncement(parser, JSON.stringify({ event: 'tunnel', url: A + '/path' })), null);
  assert.equal(routeAnnouncement(parser, JSON.stringify({ event: 'tunnel', url: 'https://bad.example' })), null);
  assert.equal(routeAnnouncement(parser, A), null);
});
test('legacy output still requires one exact HTTPS origin', () => {
  const legacy = { kind: 'url', prefix: 'https://', constraints: { hostnamePattern: '^[a-z0-9-]+\\.lhr\\.life$', exactOriginToken: true } };
  assert.equal(routeAnnouncement(legacy, 'Connected https://first.lhr.life'), 'https://first.lhr.life');
  assert.equal(routeAnnouncement(legacy, 'https://first.lhr.life https://second.lhr.life'), null);
  assert.equal(routeAnnouncement(legacy, 'https://'), null);
});
