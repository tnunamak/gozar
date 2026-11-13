import { cliCommand } from '../../packages/gozar-node/cli-command.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { render } from '../../packages/gozar-node/render.mjs';
import { parseArgs } from '../../bin/gozar.mjs';
import { adapters, planned, ready, failed, cleaned } from './fixtures/expose-ux.mjs';
import { render as oldRender } from './fixtures/render-033.mjs';
const options = { port: 18765, clientReach: 'internet' };
const banned = /intended-vantage|source-shaped|cleanup debt|immutable process identity|instance proof|capability-port|readback|fail safely|fails closed|precondition|admitted|unknown\./i;
const count = text => text.split('\n').filter(s => s.trim()).length;
test('first expose screen fits nine lines including the prompt and keeps other providers quiet', () => {
  const text = render(planned, adapters, options);
  assert.ok(count(text) + 1 <= 9, text);
  for (const phrase of ['reachable from the internet', 'Tailscale Funnel', 'http://127.0.0.1:18765', 'Lasts', 'up to 15 minutes', 'Other ways:']) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, banned);
  assert.doesNotMatch(text, /warning page|isolated known_hosts|ngrok|Cloudflare/);
  assert.match(text, /Address\s+https:\/\/<machine>\.<tailnet>\.ts\.net\n/);
  assert.doesNotMatch(text, /until you press Ctrl/);
});
test('alternatives are usable routes with detection status, one row each, followed by the same plan', () => {
  const text = render(planned, adapters, { ...options, alternatives: true });
  assert.match(text, /localhost.run trial \(localhost.run\)\s+ready/);
  assert.match(text, /Your own HTTPS address \(own-address\)\s+needs setup.*--origin URL/);
  assert.doesNotMatch(text, /ngrok|Cloudflare|--url|unknown\./);
  assert.ok(text.endsWith(render(planned, adapters, options)));
  assert.match(text, /Pick one with --via <name>\./);
});
test('verbose preserves every old limitation and selected full instruction without mutating JSON', async () => {
  const before = JSON.stringify(planned);
  const text = render(planned, adapters, { ...options, verbose: true });
  const old = oldRender(planned, adapters, { ...options, alternatives: true });
  for (const limitation of planned.snapshot.limitations) { assert.ok(old.includes(limitation)); assert.ok(text.includes(limitation), limitation); }
  assert.ok(text.includes(adapters[0].copy.consent));
  assert.equal(JSON.stringify(planned), before);
  assert.equal(before, (await readFile(new URL('./fixtures/expose-ux-033.json', import.meta.url), 'utf8')).trim());
});
test('publication puts URL before short MCP instructions and only reports checks proved by the receipt', () => {
  const text = render(ready, adapters, options);
  assert.match(text, /✓ Reachable from the internet over HTTPS/);
  assert.match(text, /✓ Streaming works/);
  assert.ok(text.indexOf('Public URL:') < text.indexOf('Add to MCP client'));
  assert.match(text, /Forwarding to http:\/\/127.0.0.1:18765/);
  assert.doesNotMatch(text, banned);
  const unproven = render({ ...ready, validation: undefined }, adapters, options);
  assert.doesNotMatch(unproven, /✓ Streaming works/);
});
test('failure distinguishes verified cleanup from an exposure that may remain', () => {
  const pending = render(failed, adapters, options);
  assert.match(pending, /check failed|check could not/i);
  assert.doesNotMatch(pending, /Nothing was published|server is unchanged/);
  assert.match(pending, /may still/);
  assert.ok(pending.includes(cliCommand("stop", 18765)));
  const done = render(cleaned, adapters, options);
  assert.match(done, /No address is published now, and your server is unchanged\./);
  const uncertain = render({ ...cleaned, localCleanupFailures: [{ detail: 'anything' }] }, adapters, options);
  assert.doesNotMatch(uncertain, /Nothing was published|No address is published now/);
});
test('phase line budgets and plain wording', () => {
  for (const [phase, budget] of Object.entries({ 'needs-setup': 6, validating: 6, 'candidate-ready': 6, failed: 6, blocked: 6, degraded: 6, stopping: 4, 'cleanup-pending': 4, stopped: 3, unknown: 3, 'published-ready': 16 })) {
    const text = render({ ...ready, snapshot: { ...ready.snapshot, phase } }, adapters, options);
    assert.ok(count(text) <= budget, `${phase}: ${text}`);
    assert.doesNotMatch(text, banned, phase);
  }
});
test('--via resolves short names and adapter IDs; invalid names list valid choices', () => {
  assert.equal(parseArgs(['expose', '--via', 'localhost.run']).adapterId, parseArgs(['expose', '--adapter', 'localhost-run']).adapterId);
  assert.equal(parseArgs(['expose', '--via', 'tailscale-funnel']).adapterId, 'tailscale-funnel');
  assert.throws(() => parseArgs(['expose', '--via', 'no-such-way']), /Valid names:.*localhost.run/);
});

test('cleanup claims require a completed host cleanup result and no remaining owned resource', () => {
  for (const reply of [
    { ...cleaned, localCleanupFailures: undefined },
    { ...cleaned, snapshot: { ...cleaned.snapshot, resources: [{ ownership: 'owned', cleanup: 'pending' }] } },
  ]) assert.doesNotMatch(render(reply, adapters, options), /Nothing was published|No address is published now/);
});

test('a port failure retains its specific plain explanation', () => {
  const reply = { ...failed, snapshot: { ...failed.snapshot, phase: 'failed', limitations: ['All explicit listener candidates are occupied or protected'] } };
  assert.match(render(reply, adapters, options), /Port check failed: all allowed ports are already in use or reserved/);
});
