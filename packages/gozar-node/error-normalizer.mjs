// The one place every error becomes what an app sees: a GozarThrownError { code, message, nextAction }.
// A frozen code passes through. A source code the fixture maps (runtime/error-normalization.json, generated
// from test/fixtures/route-contract.json errorNormalization) becomes its frozen target. Anything else is a
// real Gozar fault: internal_error, with the original error kept on `cause` and never on the message.
import { readFileSync } from 'node:fs';

const table = JSON.parse(readFileSync(new URL('../../runtime/error-normalization.json', import.meta.url), 'utf8'));
const frozen = new Set(table.frozenErrorCodes);
export const errorTargets = Object.freeze({ ...table.map });

/** What JS callers catch: `.code` and `.nextAction`, like the CLI envelope. */
export function gozarError(code, message, nextAction = null, cause = undefined) {
  const error = new Error(message);
  error.code = frozen.has(code) ? code : 'internal_error';
  error.nextAction = nextAction;
  if (cause !== undefined) error.cause = cause;
  return error;
}

const stateAction = () => ({ id: 'fix-state-permissions', kind: 'instructions', label: 'Fix the state directory permissions',
  digest: 'sha256:gozar-fix-state-permissions', instructions: 'Make the invoking user own the Gozar state directory, with no group or world write.',
  disclosure: { revision: 'gozar-local-1', text: 'Gozar changes nothing; you fix the directory yourself.', links: [] } });

export function normalizeError(error) {
  if (frozen.has(error?.code)) { error.nextAction ??= null; return error; }
  const target = Object.hasOwn(errorTargets, error?.code) ? errorTargets[error.code] : undefined;
  if (!target) return gozarError('internal_error', 'Unexpected Gozar fault', null, error);
  return gozarError(target, error.message, error.code === 'unsafe_state_path' ? stateAction() : error.nextAction ?? null, error);
}
