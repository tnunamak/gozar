// The one place that decides which host platforms Gozar 0.2 supports. Every candidate is unsupported
// elsewhere. A supported platform does not make every adapter usable: each adapter still decides through
// `ctx.platform` (and a provider's own commands) whether it can run there.
const SUPPORTED = new Set(['linux', 'darwin']);
export const supportedPlatform = platform => SUPPORTED.has(platform);
