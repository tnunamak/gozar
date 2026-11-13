import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gozarError, normalizeError } from '../../packages/gozar-node/error-normalizer.mjs';
import { assertShape } from './route-schema-check.mjs';

const here = path => fileURLToPath(new URL(path, import.meta.url));
const fixture = JSON.parse(readFileSync(here('../fixtures/route-contract.json'), 'utf8'));
const coded = (code, message = 'x') => Object.assign(new Error(message), { code });

test('the shipped normalization table is exactly what the frozen fixture generates', () => {
  execFileSync(process.execPath, [here('../../scripts/generate-error-normalization.mjs'), '--check'], { stdio: 'pipe' });
  const shipped = JSON.parse(readFileSync(here('../../runtime/error-normalization.json'), 'utf8'));
  assert.deepEqual(shipped.frozenErrorCodes, fixture.frozenErrorCodes);
  assert.deepEqual(shipped.map, Object.fromEntries(Object.entries(fixture.errorNormalization).map(([code, entry]) => [code, entry.target])));
});

test('every source code in the fixture normalises to its frozen target', () => {
  for (const [source, rule] of Object.entries(fixture.errorNormalization)) {
    assert.ok(fixture.frozenErrorCodes.includes(rule.target), `${source} maps to an unfrozen code`);
    assert.equal(normalizeError(coded(source)).code, rule.target, source);
  }
});

test('a frozen code passes through and gains a null nextAction', () => {
  for (const code of fixture.frozenErrorCodes) {
    const error = normalizeError(coded(code));
    assert.equal(error.code, code);
    assert.equal(error.nextAction, null);
  }
});

test('red: an unmapped code is internal_error, and the original stays on cause, not in the message', () => {
  const original = coded('definitely_unmapped', '/home/someone/secret-path leaked');
  const error = normalizeError(original);
  assert.equal(error.code, 'internal_error');
  assert.doesNotMatch(error.message, /secret-path/);
  assert.equal(error.cause, original);
  assert.equal(normalizeError(new Error('plain')).code, 'internal_error');
  assert.equal(gozarError('not-a-frozen-code', 'x').code, 'internal_error');
});

test('unsafe_state_path becomes setup_required with an instructions action that validates against the contract', () => {
  const error = normalizeError(coded('unsafe_state_path', 'The state directory is group-writable'));
  assert.equal(error.code, 'setup_required');
  assert.equal(error.nextAction.kind, 'instructions');
  assert.equal(error.nextAction.id, 'fix-state-permissions');
  assertShape('Action', error.nextAction);
});

// Apps match on these codes and accept every 0.3.x release (README, "Which versions to accept"). Adding, removing or
// renaming one breaks them, so it starts a new 0.N line: change this list only together with the minor version.
test('the public error codes are the ones the 0.3 line promises', () => {
  const shipped = JSON.parse(readFileSync(here('../../runtime/error-normalization.json'), 'utf8'));
  assert.deepEqual(shipped.frozenErrorCodes, ['invalid_input', 'requirements_unsatisfied', 'setup_required', 'consent_required', 'consent_unknown',
    'consent_expired', 'consent_mismatch', 'candidate_stale', 'preference_conflict', 'route_not_found', 'route_conflict', 'address_changed',
    'stopped_by_user', 'handing_back', 'verification_failed', 'provider_unavailable', 'cleanup_debt', 'unsupported', 'ambiguous_route', 'busy',
    'internal_error']);
});
