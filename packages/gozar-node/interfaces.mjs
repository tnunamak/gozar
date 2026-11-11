import { isIP } from 'node:net';

// Accept unicast interface addresses only. IPv6 link-local needs an explicit zone.
export function selectedInterfaceAddress(value) {
  if (typeof value !== 'string') return false;
  const family = isIP(value);
  if (family === 4) {
    const [a, b, c, d] = value.split('.').map(Number);
    return a !== 0 && a !== 127 && a < 224 && !(a === 169 && b === 254 && (c === 0 || c === 255)) &&
      !(a === 255 && b === 255 && c === 255 && d === 255);
  }
  if (family !== 6) return false;
  const [address, zone] = value.split('%');
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  if (canonical === '::' || canonical === '::1' || canonical.startsWith('ff')) return false;
  // Embedded IPv4 addresses must satisfy the same rules as their native form.
  if (canonical.startsWith('::ffff:') || canonical.startsWith('::')) return false;
  if (/^fe[89ab]/.test(canonical)) return Boolean(zone && /^[A-Za-z0-9_.-]{1,64}$/.test(zone));
  return !zone;
}
