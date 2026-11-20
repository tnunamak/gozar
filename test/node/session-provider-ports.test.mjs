// The two Tailscale session providers against a fake `tailscale`, through the public factory and the generic session runtime.
// Funnel sessions take 8443 then 10000 (durable routes own 443/8443/10000 as their own mapping); private Serve sessions take 9444 then 9445.
// A session never adopts, rewrites or resets a rule it does not own: other apps' bytes in the serve config survive start and stop.
// Ported from the earlier-controller tests of the same names (funnel-session-ports.test.mjs); the matrix is in the delivery report.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dnsName, persistentRule } from './fake-tailscale.mjs';
import { providerWorld } from './session-provider-fixtures.mjs';

const origin = port => `https://${dnsName}:${port}`;
const merge = (...rules) => Object.fromEntries(['TCP', 'Web', 'AllowFunnel'].map(key => [key, Object.assign({}, ...rules.map(rule => rule[key] ?? {}))]));
// Version and status reads are not writes: only `funnel` and a `serve` that is not `serve status` change the provider.
const writes = async w => (await w.fake.read()).calls.filter(call => call[0] === 'funnel' || (call[0] === 'serve' && call[1] !== 'status'));
const OPEN = { funnel: ['tailscale-funnel', 8443, 10000], private: ['tailscale-private', 9444, 9445] };

for (const [name, [providerId, first, second]] of Object.entries(OPEN)) {
  test(`${name}: a session takes ${first} when it is free, and asks for no other port`, async t => {
    const w = await providerWorld(t, providerId);
    const route = await w.expose(await w.approvedRequest());
    assert.equal(route.published, origin(first));
    assert.deepEqual(await w.fake.funnelPorts(), name === 'funnel' ? [first] : []);
    assert.equal(w.ownedNow(), 1);
    assert.equal((await w.host.close(w.api, route.handle)).cleanup.state, 'confirmed');
  });

  test(`red: ${name}: a session starts on ${second} when a durable-style rule holds ${first}, and never asks for ${first}`, async t => {
    const w = await providerWorld(t, providerId, { tailscale: { config: persistentRule(first) } });
    const before = structuredClone((await w.fake.read()).config);
    const route = await w.expose(await w.approvedRequest());
    assert.equal(route.published, origin(second));
    const asked = (await w.fake.read()).calls.filter(call => call[0] === 'funnel' || (call[0] === 'serve' && call[1] !== 'status')).map(call => Number(call.find(arg => arg.startsWith('--https='))?.slice(8)));
    assert.deepEqual(asked, [second], 'only the free port was ever requested');
    assert.equal((await w.host.close(w.api, route.handle)).cleanup.state, 'confirmed');
    assert.deepEqual((await w.fake.read()).config, before, 'the other rule is byte-identical after the session ends');
  });

  test(`red: ${name}: a second session starts on ${second} while a first session in the same home still holds ${first}`, async t => {
    const w = await providerWorld(t, providerId);
    const one = await w.expose(await w.approvedRequest());
    assert.equal(one.published, origin(first));
    const other = await w.another();
    const two = await w.expose(await w.approvedRequest(other));
    assert.equal(two.published, origin(second));
    assert.equal(w.ownedNow(), 2);
    assert.equal((await w.host.close(w.api, two.handle)).cleanup.state, 'confirmed');
    assert.equal(w.ownedNow(), 1, 'closing the second removed only the second');
    assert.equal((await w.host.close(w.api, one.handle)).cleanup.state, 'confirmed');
    assert.equal(w.ownedNow(), 0);
  });

  test(`red: ${name}: when only other listeners hold every session port it is requirements_unsatisfied, with a next action, before anything changes`, async t => {
    const taken = merge(persistentRule(first), persistentRule(second));
    const w = await providerWorld(t, providerId, { tailscale: { config: taken } });
    const before = structuredClone((await w.fake.read()).config);
    const failure = await w.expose(await w.approvedRequest()).then(() => null, error => error);
    assert.equal(failure?.code, 'requirements_unsatisfied', failure?.message);
    assert.match(failure.message, new RegExp(`${first} and ${second}`));
    assert.match(JSON.stringify(failure.nextAction), new RegExp(`${first}`));
    assert.deepEqual(await writes(w), [], 'no listener was started, so no port was touched');
    assert.deepEqual((await w.fake.read()).config, before);
    assert.deepEqual(Object.keys((await w.fake.read()).foreground), []);
    assert.equal(w.ownedNow(), 0);
    assert.equal(failure.route?.cleanup?.state, 'confirmed', 'a start that changed nothing ends confirmed, not as debt');
  });

  test(`red: ${name}: when another session in this home holds the ports it is route_conflict and names that session and how to stop it`, async t => {
    const w = await providerWorld(t, providerId, { tailscale: { config: persistentRule(second) } });
    const one = await w.expose(await w.approvedRequest());
    assert.equal(one.published, origin(first));
    const other = await w.another();
    const failure = await w.expose(await w.approvedRequest(other)).then(() => null, error => error);
    assert.equal(failure?.code, 'route_conflict', failure?.message);
    assert.match(failure.message, new RegExp(`session on port ${w.target.split(':')[1]}`));
    assert.match(JSON.stringify(failure.nextAction), /stop/);
    assert.equal(w.ownedNow(), 1, 'the first session is untouched');
    assert.equal((await w.host.close(w.api, one.handle)).cleanup.state, 'confirmed');
  });
}

test('red: an entry that lingers briefly after the watcher exits does not turn close into cleanup debt or fail the next start', async t => {
  const w = await providerWorld(t, 'tailscale-funnel', { tailscale: { config: persistentRule(10000), lingerMs: 1500 } });
  const one = await w.expose(await w.approvedRequest());
  assert.equal(one.published, origin(8443));
  const closed = await w.host.close(w.api, one.handle);
  assert.equal(closed.cleanup.state, 'confirmed', JSON.stringify(closed.cleanup));
  const other = await w.another();
  const two = await w.expose(await w.approvedRequest(other));
  assert.equal(two.published, origin(8443));
  assert.equal((await w.host.close(w.api, two.handle)).cleanup.state, 'confirmed');
});

test('red: a provider readback that fails during close is not an empty answer: the session is not confirmed gone, the failure is cleanup debt, and the next close can confirm it', async t => {
  const w = await providerWorld(t, 'tailscale-funnel');
  const route = await w.expose(await w.approvedRequest());
  await w.fake.update(state => { state.failServeStatus = true; });
  const before = (await w.fake.read()).calls.length;
  const closed = await w.host.close(w.api, route.handle);
  const reads = (await w.fake.read()).calls.slice(before).filter(call => call[0] === 'serve' && call[1] === 'status').length;
  assert.ok(reads <= 2, `serve status was read ${reads} times: one failed readback is not retried in a loop`);
  assert.notEqual(closed.cleanup.state, 'confirmed', 'an unreadable provider is never confirmed absent');
  assert.ok(closed.cleanup.nextAction, 'the debt names what to do');
  assert.deepEqual(await writes(w), [['funnel', '--yes', '--https=8443', '--set-path=/', (await w.fake.read()).calls.find(call => call[0] === 'funnel')[4]]], 'close wrote nothing to the provider');
  await w.fake.update(state => { state.failServeStatus = false; });
  const again = await w.host.close(w.api, route.handle);
  assert.equal(again.cleanup.state, 'confirmed', JSON.stringify(again.cleanup));
  assert.equal(w.ownedNow(), 0);
});

test('other apps\' Funnel rules on 443 and 9443 and a tailnet-only rule on 8443 survive a session start and close byte-identical', async t => {
  const rule = (port, funnel) => ({ TCP: { [port]: { HTTPS: true } }, Web: { [`${dnsName}:${port}`]: { Handlers: { '/': { Proxy: `http://127.0.0.1:${9000 + port % 1000}` } } } },
    AllowFunnel: funnel ? { [`${dnsName}:${port}`]: true } : {} });
  const config = merge(rule(443, true), rule(9443, true), rule(8443, false));
  const w = await providerWorld(t, 'tailscale-funnel', { tailscale: { config } });
  const before = structuredClone((await w.fake.read()).config);
  const route = await w.expose(await w.approvedRequest());
  assert.equal(route.published, origin(10000));
  assert.equal((await w.host.close(w.api, route.handle)).cleanup.state, 'confirmed');
  const after = await w.fake.read();
  assert.deepEqual(after.config, before);
  assert.deepEqual((await writes(w)).map(call => call.slice(0, 4)), [['funnel', '--yes', '--https=10000', '--set-path=/']], 'one narrow funnel call; no reset, off or other port');
});
