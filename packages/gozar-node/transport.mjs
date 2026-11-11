import { safeOrigin } from './catalog.mjs';
import { isDeepStrictEqual } from 'node:util';
import { expandPlan } from './bindings.mjs';
import { scopedReceipt } from './materialization.mjs';

const port = value => Number.isSafeInteger(value) && value > 0 && value <= 65535;
const hostname = value => typeof value === 'string' && value.length <= 253 && (value.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)));
export function transportEndpoint(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 4 && Object.keys(value).every(key => ['scheme', 'hostname', 'port', 'endpointName'].includes(key)) &&
    ['https', 'tls', 'tcp'].includes(value.scheme) && hostname(value.hostname) && port(value.port) &&
    typeof value.endpointName === 'string' && /^[A-Za-z0-9_.:/-]{1,512}$/.test(value.endpointName);
}

export function assertTransportMapping(rule, host, bindings, scope) {
  const expected = expandPlan(Object.fromEntries(Object.entries(rule).filter(([key]) => !['op', 'fact'].includes(key))), bindings);
  const upstream = expected.upstream;
  if (Object.keys(rule).some(key => !['op', 'fact', 'endpoint', 'upstream', 'policyRef', 'origin'].includes(key)) ||
      !transportEndpoint(expected.endpoint) || !upstream || Object.keys(upstream).length !== 3 ||
      Object.keys(upstream).some(key => !['scheme', 'hostname', 'port'].includes(key)) ||
      !['http', 'https', 'tls', 'tcp'].includes(upstream.scheme) || !hostname(upstream.hostname) || !port(upstream.port) ||
      typeof expected.policyRef !== 'string' || !/^[A-Za-z0-9_.:/-]{1,512}$/.test(expected.policyRef)) throw new Error('Invalid exact transport mapping declaration');
  if (Object.hasOwn(expected, 'origin')) {
    const name = expected.endpoint.hostname.includes(':') ? `[${expected.endpoint.hostname}]` : expected.endpoint.hostname;
    const origin = `https://${name}${expected.endpoint.port === 443 ? '' : `:${expected.endpoint.port}`}`;
    if (expected.endpoint.scheme !== 'https' || expected.origin !== origin || safeOrigin(origin) !== origin) throw new Error('Transport mapping cannot coerce a non-HTTPS endpoint into an HTTP origin');
  }
  const fact = host.facts?.[rule.fact];
  if (!scopedReceipt(fact, scope) || !isDeepStrictEqual(fact.value, expected)) throw new Error('Transport mapping requires a fresh exact scoped fact');
  return expected;
}
