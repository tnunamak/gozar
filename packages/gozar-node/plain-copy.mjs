import copy from '../../runtime/plain-copy.json' with { type: 'json' };

// Host errors may include arbitrary OS/provider text. Never print it in the short view.
export function plainCaveat(text) {
  const exact = Object.hasOwn(copy.caveats, text) ? copy.caveats[text] : undefined;
  return exact ?? copy.patterns.find(item => typeof text === 'string' && text.startsWith(item.prefix)) ?? {};
}

export const reachWords = copy.reaches;
