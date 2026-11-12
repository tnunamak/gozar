function pointer(value, path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return undefined;
  for (const part of path.slice(1).split('/')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part.replace(/~1/g, '/').replace(/~0/g, '~'))) return undefined;
    value = value[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return value;
}

// Mirrors the core parser; core revalidates the original line before changing state.
export function routeAnnouncement(parser, input) {
  if (parser?.kind !== 'url' || parser.constraints?.exactOriginToken !== true) return null;
  const line = input.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  let candidates;
  if (parser.jsonEvent) {
    let event;
    try { event = JSON.parse(line); } catch { return null; }
    if (pointer(event, parser.jsonEvent.eventPointer) !== parser.jsonEvent.eventValue) return null;
    candidates = [pointer(event, parser.jsonEvent.originPointer)];
  } else candidates = line.split(/\s+/);
  const origins = new Set();
  let pattern;
  try { pattern = new RegExp(parser.constraints.hostnamePattern); } catch { return null; }
  for (const token of candidates) {
    if (typeof token !== 'string' || !token.startsWith(parser.prefix ?? 'https://')) continue;
    try {
      const url = new URL(token);
      if (url.origin === token && pattern.test(url.hostname)) origins.add(token);
    } catch {}
  }
  return origins.size === 1 ? [...origins][0] : null;
}
