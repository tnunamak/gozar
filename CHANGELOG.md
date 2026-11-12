# Changelog

## 0.2.0

### Added

- **Durable routes** for Tailscale Funnel and Serve: a Gozar-owned listener that keeps one origin across app restarts and reboots until it is released. New exports from `@tnunamak/gozar/service` and the root API: `ensureRoute`, `adoptRoute`, `releaseRoute` (modes `remove`, `hand-back`, `dismiss`), `confirmHandBack`, `cancelHandBack`, `statusRoutes` and `durableConsentText`. See [docs/service-routes.md](docs/service-routes.md#durable-routes-gozar-owned).
- Durable routes change the Tailscale serve config only through the tailscaled LocalAPI with ETag compare-and-set (`If-Match`, re-read on 412). They need a LocalAPI socket that the user may write. Failures are typed: `tailscale_localapi_unavailable`, `tailscale_localapi_denied`, `tailscale_localapi_unsupported`, `tailscale_serve_config_conflict`. There is no fallback to the `tailscale` CLI.
- `gozar status --route ID` and `gozar stop --route ID`. A user stop is sticky: the app cannot re-create or adopt the route until the user runs the new `gozar allow --route ID`.
- Status shows each durable route as `owner-run`, with a live check of its local target.
- Adapter definitions gain `addressStability`, `durableLifetime` and `idleTimeoutMs`.

### Changed

- **Bare `gozar status --json` gains an `inventory` field** that lists sessions, service routes and durable routes in the home. The rest of the reply, and the exit code, are unchanged when `last.json` names a session. Human output adds an inventory section after the session. With no `last.json`, bare `gozar status` now prints the inventory and exits 0 instead of failing.
- `statusServices` also lists Gozar-owned durable routes. `removeService` refuses them with `gozar_owned`; release them with `releaseRoute`.
- Sessions and durable routes share one home-wide reservation, so a session cannot take a listener or provider port that a durable route holds.
