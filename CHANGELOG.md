# Changelog

## 0.2.0

### Added

- **Routes by requirement.** An app states what it needs and never names a provider. New root exports: `catalogRoutes` (also `detect`), `inspectLegacyRoute`, `ensureRoute`, `adoptRoute`, `expose` (session or attached), `routeStatus`, `closeRoute`, `watchRoutes`, `getRoutePreferences`, `setRoutePreferences`, `runSetupAction` and `resolveClientAddress`. The types are in `packages/gozar-node/route-contract.d.ts`, exposed through the `types` entry in `package.json`. See the [README](README.md#route-by-requirement).
- **Consent tokens.** The catalog issues a single-use token for each ready candidate. It is bound to the query, the disclosure revision and the provider state Gozar observed. If the provider changed since, the call fails with `candidate_stale` and changes nothing.
- **Closed error codes.** Every public function and CLI command fails with one of a fixed set of codes and an optional `nextAction`; provider diagnostics stay inside Gozar.
- **Provider registry.** A provider is one directory plus one `providers` entry in `adapters/manifest.json`. Ten providers ship; see [docs/providers.md](docs/providers.md). A new provider needs no core edit. The compatibility arrays are generated and checked.
- **Attached routes** (a route that lives while the calling process runs), with the ngrok HTTPS edge as the first provider. The `@ngrok/ngrok` package is an optional dependency. Before an attached route reports an origin, Gozar runs the same timed-SSE check as other routes and withdraws the route if it fails.
- **CLI.** `gozar catalog`, `ensure`, `adopt`, `expose --query-file`, `setup`, `preference show|set` and `watch`. Each reads its request from files, prints one JSON envelope (`watch` prints one event per line) and uses the exit codes 0, 1, 2 and 3 described in the README. There is no `--yes` for these commands.
- **macOS.** Gozar 0.2.0 supports Linux and macOS. On any other platform, such as Windows, every route answers `unsupported`.
- **Durable routes** for Tailscale Funnel and Serve: a Gozar-owned listener that keeps one origin across app restarts and reboots until it is released. Use `ensureRoute` and `adoptRoute` with an approval from the catalog, `routeStatus` to read the route and `closeRoute` to remove it. `releaseRoute` (modes `remove`, `hand-back`, `dismiss`), `confirmHandBack` and `cancelHandBack` stay in `@tnunamak/gozar/service`. See [docs/service-routes.md](docs/service-routes.md#durable-routes-gozar-owned).
- Durable routes change the Tailscale serve config only through the tailscaled LocalAPI with ETag compare-and-set (`If-Match`, re-read on 412). There is no fallback to the `tailscale` CLI.
- **Tailscale on macOS: the App Store app, the standalone app and Homebrew tailscaled.** The two apps expose no unix socket. Gozar now finds their LocalAPI the way Tailscale's own CLI does: the `sameuserproof` file named in the `lsof` output of the app's `IPNExtension` process (App Store), then `/Library/Tailscale/ipnport` and `sameuserproof-<port>` (standalone), and then talks to `127.0.0.1:<port>` with the token as the Basic-auth password. A unix socket still comes first, and `GOZAR_TAILSCALED_SOCKET` overrides everything. The token is used for one request and kept nowhere. With nothing running, the answer is `provider_unavailable` with a next action that says to open the Tailscale app or start tailscaled. **Proven only by fixture tests, not against a live app:** `node packages/gozar-node/check-tailscale-app.mjs` and the catalog check in [docs/service-routes.md](docs/service-routes.md#durable-routes-gozar-owned) settle it on a Mac with an app.
- **The `tailscale` CLI on macOS.** When no `tailscale` is on `PATH`, recipes run the CLI the app bundles, `/Applications/Tailscale.app/Contents/MacOS/Tailscale`, if it exists. The recipes and their consent are unchanged.
- `gozar status --route ID` and `gozar stop --route ID`. A user stop is sticky: the app cannot re-create or adopt the route until the user runs the new `gozar allow --route ID`.
- Status shows each durable route as `owner-run`, with a live check of its local target.
- Adapter definitions gain `addressStability`, `durableLifetime` and `idleTimeoutMs`.
- A session started with `expose` now honours `wait`, like an attached route: `allocated` returns once an origin exists, `verified` only when the route is usable. A session that ends lost, released or uncertain, or times out, fails with `provider_unavailable` or `verification_failed`, and its daemon and provider state are stopped.
- `gozar status` shows a live target check for each session (`listening` or `nothing listening`), as it does for durable routes. A dead target does not change the session state.
- Tailscale sessions work on Tailscale 1.102.5: the node is identified by its node ID and tailnet DNS suffix, and the catalog says `ready` only when the session's own status checks pass. The Funnel disclosure names port 8443.
- A second session that needs the installation key held by another route fails with `route_conflict` and a `nextAction` that carries the stop command, instead of `internal_error`.

### Breaking

- The durable functions `statusRoutes` and `durableConsentText` are not exported. `ensureRoute` and `adoptRoute` take a route-contract query and an `approval` instead of an `adapterId` and an `approvals` list, and return a `RouteView`.
- The package needs Node.js 22.13 or newer.

### Known limits

- The ngrok HTTPS edge lists its setup steps (auth token, reserved domain), but Gozar does not yet keep the values those steps collect where the adapter reads them, so the provider stays `action-required`.
- A session route through a provider that has no older recipe record cannot start yet.
- An attached route sits behind Gozar's validation gate, so it reports no client address and lasts at most about 24 days per open.
- The tunnl.gg stability claim has no live check yet.

### Changed

- **Bare `gozar status --json` gains an `inventory` field** that lists sessions, service routes and durable routes in the home. The rest of the reply, and the exit code, are unchanged when `last.json` names a session. Human output adds an inventory section after the session. With no `last.json`, bare `gozar status` now prints the inventory and exits 0 instead of failing.
- `statusServices` also lists Gozar-owned durable routes. `removeService` refuses them with `gozar_owned`; release them with `releaseRoute`.
- Sessions and durable routes share one home-wide reservation, so a session cannot take a listener or provider port that a durable route holds.
