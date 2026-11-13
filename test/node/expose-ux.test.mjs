import { cliCommand } from '../../packages/gozar-node/cli-command.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { render } from '../../packages/gozar-node/render.mjs';
import { parseArgs } from '../../bin/gozar.mjs';
import { adapters, planned, ready, failed, cleaned } from './fixtures/expose-ux.mjs';
import { render as oldRender } from './fixtures/render-033.mjs';
const options = { port: 18765, clientReach: 'internet' };
const banned = /intended-vantage|source-shaped|cleanup debt|immutable process identity|instance proof|capability-port|readback|fail safely|fails closed|precondition|admitted|unknown\.|\bready\b|Ctrl-C/i;
const count = text => text.split('\n').filter(s => s.trim()).length;
test('first expose screen fits eleven lines including the prompt and keeps other providers quiet', () => {
  const text = render(planned, adapters, options);
  assert.ok(count(text) + 1 <= 11, text);
  for (const phrase of ['reachable from the internet', 'Tailscale Funnel', 'http://127.0.0.1:18765', 'Lasts', 'up to 15 minutes', 'Other ways:']) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, banned);
  assert.doesNotMatch(text, /warning page|isolated known_hosts|ngrok|Cloudflare/);
  assert.match(text, /Address\s+assigned after you approve \(https:\/\/<machine>\.<tailnet>\.ts\.net, port 8443 or 10000\)/);
  assert.doesNotMatch(text, /until you press Ctrl/);
});
test('alternatives are usable routes with detection status, one row each, followed by the same plan', () => {
  const text = render(planned, adapters, { ...options, alternatives: true });
  assert.match(text, /localhost.run trial \(localhost.run\)\s+available  checked after you approve/);
  assert.match(text, /Your own HTTPS address \(own-address\)\s+needs setup.*--origin https:\/\/your.domain.*http:\/\/127.0.0.1:18765/);
  assert.doesNotMatch(text, /ngrok|Cloudflare|--url|unknown\./);
  assert.doesNotMatch(text, /Other ways:/);
  assert.match(text, /^Ways to make this reachable from the internet:/);
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
test('publication leads with URL and limits checked claims to the final receipt', () => {
  const text = render(ready, adapters, options);
  assert.match(text, /^Public URL:.*\nChecked: HTTPS answers from the internet; the address reaches this instance; streaming works\. Your app's own sign-in and requests are not checked\.\nForwarding to/);
  assert.doesNotMatch(text, /MCP|\/mcp|mcpServers|demo-server/);
  assert.ok(count(text) <= 8);
  assert.match(text, /Forwarding to http:\/\/127.0.0.1:18765/);
  assert.doesNotMatch(text, banned);
  const unproven = render({ ...ready, validation: undefined }, adapters, options);
  assert.doesNotMatch(unproven, /streaming works|HTTPS answers|reaches this instance/);
});
test('failure distinguishes verified cleanup from an exposure that may remain', () => {
  const pending = render(failed, adapters, options);
  assert.match(pending, /The cause was not recorded\./);
  assert.doesNotMatch(pending, /Nothing was published|server is unchanged/);
  assert.match(pending, /Public access or a background process may remain\. Cleanup is not confirmed\./);
  assert.ok(pending.includes(cliCommand("stop", 18765)));
  const done = render(cleaned, adapters, options);
  assert.match(done, /Cleanup confirmed: nothing Gozar created is still published\. Your server's settings were not changed\./);
  const uncertain = render({ ...cleaned, localCleanupFailures: [{ detail: 'anything' }] }, adapters, options);
  assert.doesNotMatch(uncertain, /Nothing was published|Cleanup confirmed/);
});
test('phase line budgets and plain wording', () => {
  for (const [phase, budget] of Object.entries({ 'needs-setup': 6, validating: 6, 'candidate-ready': 6, failed: 6, blocked: 6, degraded: 6, stopping: 4, 'cleanup-pending': 4, stopped: 3, unknown: 3, 'published-ready': 8 })) {
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
  ]) assert.doesNotMatch(render(reply, adapters, options), /Nothing was published|Cleanup confirmed/);
});

test('a port failure retains its specific plain explanation', () => {
  const reply = { ...failed, snapshot: { ...failed.snapshot, phase: 'failed', limitations: ['All explicit listener candidates are occupied or protected'] } };
  assert.match(render(reply, adapters, options), /Port check failed: all allowed ports are already in use or reserved/);
});

test('background lifecycle, stop commands and scoped ownership stay visible before approval', () => {
  const text = render(planned, adapters, options);
  assert.match(text, /Lasts    up to 15 minutes in the background; the stop command below ends it sooner/);
  assert.ok(text.includes(`Stop: ${cliCommand('stop', options.port)}`));
  assert.match(text, /Anyone with the address can reach it; Gozar adds no sign-in\./);
  assert.equal(text.split('Gozar creates its own route and removes only what it created.').length, 2);
  assert.match(text, /Other ways: localhost.run trial, your own HTTPS address. See --alternatives\./);
  assert.match(text, /Note: some apps cannot connect to ports 8443 or 10000\./);
  assert.equal(text.split('8443 or 10000').length, 3);
  assert.match(render(planned, adapters, { ...options, lifetimeMs: 300000 }), /up to 5 minutes in the background/);
  assert.match(render(ready, adapters, options), /Lasts: up to 15 minutes in the background\. Stop sooner:/);
  const external = { ...planned, snapshot: { ...planned.snapshot, adapterId: 'own-address' } };
  assert.doesNotMatch(render(external, adapters, options), /Gozar creates its own route/);
});
test('alternatives heading follows the requested audience and detection never promises verification', () => {
  for (const [reach, words] of [['tailnet', 'your Tailscale network'], ['lan', 'your local network'], ['this-device', 'this computer']]) {
    assert.ok(render(planned, adapters, { ...options, alternatives: true, clientReach: reach }).startsWith(`Ways to make this reachable from ${words}:`));
  }
  for (const state of ['absent', 'unknown', 'signed-out', 'blocked']) {
    const reply = { ...planned, snapshot: { ...planned.snapshot, observations: { ...planned.snapshot.observations, 'tailscale-funnel': state } } };
    assert.match(render(reply, adapters, { ...options, alternatives: true }), /Tailscale Funnel.*needs setup.*Install Tailscale and sign in/);
  }
});
test('MCP instructions require verbose; arbitrary services never receive demo authentication advice', () => {
  const text = render(ready, adapters, { ...options, verbose: true });
  assert.ok(text.indexOf('Add to MCP client') > text.indexOf('Full detail:'));
  assert.match(text, /https:\/\/node.tailnet.test:8443\/mcp/);
  assert.match(text, /mcpServers/);
  assert.doesNotMatch(text, /For gozar demo-server only|select no authentication/);
});
test('receipt fields are independent; no public vantage or streaming claim is inferred', () => {
  const reply = { ...ready, validation: { probeReceipt: { tls: true, vantage: 'tailnet', sse: false, instanceMatched: false } } };
  const text = render(reply, adapters, options);
  assert.match(text, /Checked: HTTPS answers\. Your app's own sign-in and requests are not checked\./);
  assert.doesNotMatch(text, /from the internet|streaming works|reaches this instance/);
});
test('failure cause uses specific evidence or admits it is unrecorded; inspection precedes retry', () => {
  for (const [limitation, expected] of [
    ['Origin health receipt expired; a fresh intended-vantage check is required', /Connection check expired/],
    ['Fresh preflight prerequisite failed', /current provider settings do not allow this route/],
    ['Adapter returned an origin without required HTTPS', /provider returned HTTP when HTTPS was required/],
    ['Current origin health proof failed or expired; external owner action required', /The cause was not recorded/],
  ]) {
    const reply = { ...failed, snapshot: { ...failed.snapshot, limitations: [limitation] } };
    const text = render(reply, adapters, options);
    assert.match(text, expected);
    assert.ok(text.indexOf('Inspect first:') < text.indexOf('Then retry:'));
    assert.ok(text.includes(`Inspect first: ${cliCommand('health', options.port)}`));
    assert.doesNotMatch(text, /failed or expired/);
  }
  for (const reply of [failed, cleaned, { ...failed, snapshot: { ...failed.snapshot, phase: 'cleanup-pending' } }]) {
    assert.match(render(reply, adapters, options), /Inspect first:/);
  }
});

test('stop reports confirmed cleanup only with explicit host confirmation, even without a failure', () => {
  const reply = { ...cleaned, snapshot: { ...cleaned.snapshot, limitations: [] } };
  assert.match(render(reply, adapters, options), /^Cleanup confirmed:/);
  assert.match(render({ ...reply, localCleanupFailures: undefined }, adapters, options), /^Public access.*Cleanup is not confirmed\./);
});
test('owner-managed proxy setup names the actual gate when it is known', () => {
  const text = render({ ...planned, gateTarget: 'http://127.0.0.1:41817' }, adapters, { ...options, alternatives: true });
  assert.match(text, /own-address.*--origin https:\/\/your.domain.*Gozar's local proxy port.*http:\/\/127.0.0.1:41817/);
});
