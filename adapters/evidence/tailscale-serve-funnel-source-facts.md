# Tailscale Serve/Funnel adapter facts
Source: tailscale/tailscale @ 7b2c32b9138b0ab2321910c7eaa8e81b24919dce. Only the eight allowed source files were read, through GitHub. Commands below are instructions for a future adapter, NOT executed. No secrets, host probing, network tests, configuration changes or publication.

Abbreviations: CLI=cmd/tailscale/cli/serve_v2.go; F=cmd/tailscale/cli/funnel.go; S=cmd/tailscale/cli/status.go; C=cmd/tailscale/cli/cert.go; I=ipn/serve.go; L=ipn/ipnlocal/serve.go; IS=ipn/ipnstate/ipnstate.go; TC=tailcfg/tailcfg.go. Every line reference below is to the pinned revision.

## 1. Detection without configuration side effects
| Fact | Exact command/field | Evidence |
|---|---|---|
| Fetch daemon status, no web UI/browser mode | tailscale status --json --peers=false | S:76-102 queries StatusWithoutPeers and serializes it; --json format is explicitly subject to change at :51. |
| Successful status proves a responsive daemon/API, not a distinct 'installed' JSON bit | Version; BackendState | IS:33-43; failed daemon request is passed to fixTailscaledConnectError at S:84-86. CLI executable presence/daemon-down failure texts are outside these definitions. |
| Operational state must be checked independently of JSON command success | BackendState == "Running"; alternatives NoState, NeedsLogin, NeedsMachineAuth, Stopped, Starting | IS:40-43; S:88-101 returns JSON without requiring Running. HaveNodeKey only means a configured node key, not proof of usable login (:45-46). |
| Connected tailnet and current login URL | CurrentTailnet (nil when not connected), AuthURL | IS:48,66-68. Treat NeedsLogin/NeedsMachineAuth distinctly, not as 'not installed'. |
| Public/tailnet hostname | Self.DNSName, trim final "." | IS:244-246; CLI:442-447 performs that exact trim. CurrentTailnet.MagicDNSSuffix is the tailnet suffix; CurrentTailnet.MagicDNSEnabled separately indicates MagicDNS (IS:61-68,187-190). |
| Cert provisioning capability is not proof of an already-issued cert | CertDomains contains desired FQDN, without trailing dot; Self.CapMap contains nodecap.HTTPS | IS:70-75; I:658-659; C:91-99 distinguishes not Running, no configured HTTPS, valid domain names. |
| Funnel permission requires HTTPS AND Funnel capability AND allowed port | Self.CapMap (preferred); nodecap.HTTPS, nodecap.Funnel, nodecap.FunnelPorts | I:640-675. The literal "funnel" is documented at IS:300-313/I:644. TC:2508,2519,2524 alias the other constants to nodecap. Exact HTTPS/FunnelPorts string definitions are outside the allow-list, so UNKNOWN, not guessed. |
| Allowed ports are supplied by capability, not hardcoded here | FunnelPorts capability key URL has ?ports=comma-separated ports/ranges | I:677-745 parses key/query, validates its base, and accepts exact values/inclusive numeric ranges. Do not assume 443/8443/10000 are universally allowed: test each against this runtime value. This scope does not establish a fixed three-port list. |

Do not run serve/funnel as a detection probe: feature enablement can enter an interactive/control-plane flow (CLI:455-474; F:129-160). Do not run cert as a harmless probe: it fetches certificates and by default writes DOMAIN.crt and DOMAIN.key (C:113-125). Never use --key-file=- in detection.

## 2. Commands, isolation, reconciliation and selective removal
Let P be the loopback HTTP port, E an unused external HTTPS port, and /gozar-UNIQUE an exclusive mount. For public Funnel, E must pass the current FunnelPorts check. For a backend MCP endpoint at /mcp, set the target to http://127.0.0.1:P/mcp rather than relying on an unstripped mount.

| Operation/fact | Exact command or config | Evidence |
|---|---|---|
| Read existing shared configuration before any change | tailscale serve status --json (or tailscale funnel status --json) | Both register runServeStatus with --json: CLI:257-265. Its serializer implementation is outside the allow-list. |
| Background tailnet HTTPS route, prerequisites already satisfied | tailscale serve --bg --yes --https=E --set-path=/gozar-UNIQUE http://127.0.0.1:P | Flags CLI:240-253; default HTTP proxy expansion :1291-1298/I:764-837; background avoids watcher-created foreground config :491-510. |
| Background public HTTPS route, prerequisites already satisfied | tailscale funnel --bg --yes --https=E --set-path=/gozar-UNIQUE http://127.0.0.1:P | Same flag/run path CLI:222-253,455-474,528; Funnel bit applied :1040-1044. |
| Plain tailnet HTTP alternative, not public Funnel | tailscale serve --bg --yes --http=E --set-path=/gozar-UNIQUE http://127.0.0.1:P | --http only registered for serve at CLI:244-245; HTTPS enable step is conditional on HTTPS :462. |
| Inspect expected result | TCP["E"].HTTPS; Web["hostname:E"].Handlers["/gozar-UNIQUE"].Proxy; AllowFunnel["hostname:E"] true only for public | I:54-83,446-453,516-531. Check all top-level and Foreground entries, not only Web; config is shared. |
| Remove only the exact mount created | tailscale serve --bg --yes --https=E --set-path=/gozar-UNIQUE off (funnel spelling also uses same removal path) | CLI:455,514-516,1389-1393,1543-1604. Explicit --set-path restricts mounts to one (:1583-1585); I:539-562 removes Funnel only when no handlers remain. |
| Never use broad cleanup for an adapter-owned mount | Do not use reset or omit --set-path on off | reset is full current-config reset (CLI:267-272); omitted path collects ALL handlers on port (:1574-1581), prompting for multiple (:1592-1595). |
| Read-modify-write race protection exists within command | GetServeConfig -> SetServeConfig, ETag/If-Match | CLI:433,536-539; I:79-83; L:342-348,376-381. On conflict reread and reconcile, not blind overwrite/set-raw. |

Important limits:
- Funnel is HOST:PORT-wide, not per mount (I:67-69,516-531). Adding a public path on a user's existing tailnet-only HTTPS port publishes that port's other handlers too. Conversely, serve applies Funnel=false and can disable a pre-existing public port (CLI:1040-1044,1369-1381). The conservative non-disturbing plan is a dedicated, unused permitted port. If none exists, stop/ask rather than changing someone else's visibility.
- A fresh path on a shared port still changes URL routing semantics; handlers resolve exact path then ancestors (L:860-889). A unique path is not an unconditional no-disturbance guarantee.
- SetWebHandler overwrites an existing same mount and removes the alternate slash spelling (/foo vs /foo/) (I:453-467). Check both spellings, relevant ancestor/descendant routes and the listener type before applying.
- --yes suppresses the deletion confirmation shown in this scope, but does NOT prove feature-enablement can never prompt/block: enableFeatureInteractive is called independently (CLI:462-474; F:140-141). Truly prompt-free setup is conditional on prerequisites already being met.
- Mount prefix is stripped before proxying (L:1303-1310); reverse proxy prepends the configured target path and handles exact mount specially (:989-1002). Choose target path deliberately for MCP.
- After creation/readback, record profile/node hostname, port, mount, normalized target, prior visibility, and exact expected fields privately. Before delete, compare the live entry and leave changed/user-owned state alone. This is an adapter strategy, not a native owner marker (see Q4).

## 3. Errors/prompts and corrective actions
This is the source-visible relevant inventory for the above node/HTTP commands. Arbitrary wrapped daemon/OS/control-plane errors and out-of-scope prompt implementation make a literal exhaustive list impossible; do not match only these strings.

| Exact text/template | Evidence | Corrective action |
|---|---|---|
| Funnel not available; HTTPS must be enabled. See https://tailscale.com/s/https. | I:658-659; F:145-153 fallback | Authorized tailnet administrator enables HTTPS; follow printed URL. |
| Funnel not available; "funnel" node attribute not set. See https://tailscale.com/s/no-funnel. | I:661-662 | Authorized admin grants node Funnel policy; follow printed URL. |
| port %d is not allowed for funnel / port %d is not allowed for funnel; allowed ports are: %v | I:670-675 | Select a permitted unused port from live capability, or authorized admin changes policy. |
| error enabling https feature: %w | CLI:472-473 | Follow actual underlying enablement response; exact prompt and dynamic URL UNKNOWN here. |
| Another client is changing the serve config; please try again. | CLI:536-539; L:380-381 "etag mismatch" | Reread shared config, re-evaluate ownership/collision, retry boundedly. |
| cannot serve web; already serving TCP | CLI:1303-1304 | Choose another external port; do not replace user's TCP listener. |
| listener already exists for port %d / foreground listener already exists for port %d | L:2003,2012 | Choose unused port or obtain owner-approved removal of conflict. |
| want to serve %q, but port %d is already serving %q | L:2026 | Preserve existing type; use unused port. Service variant adds "for %s" at :2047. |
| Unable to turn on Funnel while shields-up is enabled | L:357-358 | User/admin must deliberately change security posture, or keep tailnet-only route; do not silently disable shields-up. |
| can't reconfigure tailscaled when using a config file; config file is locked | L:360-361 | Configuration owner must update/unlock the managed config through its authorized process. |
| netMap is nil / netMap SelfNode is nil | L:364-369 | Restore authenticated/ready daemon state, then recheck status. |
| error getting serve config: %w / getting client status: %w | CLI:433-444; F:143-144 | Resolve actual daemon/connectivity/authorization error. Exact underlying text is not defined here. |
| %v followed by "Serving a path or Unix socket requires root. Run this command with sudo." | CLI:540-545 | Applies to filesystem Path/Unix handlers in the parent config, not merely URL --set-path. Root action needed; operator advice is explicitly insufficient for those handlers. |
| Generic Linux operator/access-denied advice | CLI:541-544 says RunWithContext adds it, but implementation not in scope | Exact text and exact operator configuration command UNKNOWN. Resolve through authorized operator/root setup; do not invent a quoted CLI message. |
| failed to remove web serve: %w; underlying cannot remove web handler; currently serving TCP / handler does not exist | CLI:1392,1569-1589 | Re-read state, do not delete another handler. Missing owned entry may mean already removed. |
| Are you sure you want to delete %d handlers under port %s? | CLI:1592-1595 | Avoid by always specifying exact path, not by using --yes to wipe shared handlers. |
| localListener failed to listen on %v, backing off: %v | L:241-247 | Daemon log, not necessarily CLI failure. Free/choose conflicting OS listen port; successful config write is not readiness evidence. |
| error: invalid argument format; Error: invalid number of arguments (%d); invalid mount point %q; port number %d is too high for %s flag; cannot serve multiple types for a single mount point | CLI:356-365,1659,1426,1440 | Fix argument construction; use one mode, valid clean path, bounded port. |
| failed apply web serve: %w with empty target / invalid URL %w / must be a URL starting with one of the supported schemes: %v / port required for localhost target %q / invalid port %q | CLI:1019; I:768-769,800-807,811-814,827-832 | Supply valid explicit http://127.0.0.1:P target. |
| encoding serve config: %w / writing ServeConfig to StateStore: %w | L:393-405 | Resolve daemon storage/config error, then reconcile actual state before retry. |

Other rejected flags are explicit: "PROXY protocol is only supported for TCP forwarding, not HTTP/HTTPS" (CLI:425-426); "invalid PROXY protocol version %d; must be 1 or 2" (:429-430); service/TUN errors (:405-411,484-489) do not apply to the proposed ordinary node proxy commands. The absolute-filesystem target macOS restriction is at :1272-1281 and is not a restriction on loopback HTTP proxying.

Dynamic feature help uses control-plane QueryFeatureResponse.Text, URL and ShouldWait (TC:2918-2948). Thus the exact enabling URL may be returned at runtime; the two static fallback URLs above are not a complete promise of all printed URLs. Feature flow implementation and top-level CLI flag/parser errors are UNKNOWN within scope.

## 4. Persistence and ownership
| Fact | Evidence | Adapter consequence |
|---|---|---|
| Config is stored per profile at _serve/<profileID> | I:29-33,52-54; L:402-405 | Background config survives daemon restart when that profile/state store remains available. Persist adapter ledger across restart too. |
| Reload requires logged-in/current profile state | L:1807-1828 | Different profile or logged-out daemon is not proof prior route was deleted. |
| Foreground config is tied to watcher session and inactive sessions are pruned | I:71-77; CLI:491-510; L:1842-1846 | --bg is necessary for detached/persistent adapter routes; a foreground process/session is intentionally ephemeral. |
| No per-handler creator/owner label in config | I:54-83,126-190 defines config/handlers; keys are port/host/mount/target | Native JSON cannot prove an entry is ours. Use external ledger and compare exact value before mutation. Matching values alone cannot distinguish another actor recreating the same mapping. |
| ETag protects the whole config snapshot, not ownership | I:79-83; L:342-348,376-381 | Reconcile after races; never restore a stale entire config to clean up one entry. |

## 5. TLS and streaming
| Fact | Evidence | Limit |
|---|---|---|
| HTTPS terminates in local tailscaled's HTTP/TLS server | L:671-685 | The loopback upstream can be HTTP; do not require application certificate export. |
| Certificate lookup/issuance can occur in TLS handshake | L:1532-1560 calls GetCertPEM under a one-minute context and parses pair | First request may wait. One minute is a local timeout, NOT a promised issuance duration or readiness SLA. GetCertPEM implementation/cache/CA behavior lies outside scope. |
| Control plane assists certificate provisioning for CertDomains; DNS-01/Let's Encrypt are mentioned as examples | IS:70-75; TC:1825-1831 | Exact issuer/account/renewal/storage behavior UNKNOWN; do not state every cert is issued by a particular CA based solely on examples. |
| ACME TLS-ALPN renewal support exists | L:1564-1589 | Only exact SNI with pending challenge advertises challenge protocol; full certificate machinery is outside scope. |
| HTTP reverse proxy forwards request/response using Go httputil.ReverseProxy; explicitly enables full duplex | L:983-1034 | No explicit FlushInterval set in this constructor. Go standard library SSE flushing details are outside allowed source; cannot claim an end-to-end SSE guarantee from this alone. |
| The HTTP server constructor sets no Read/Write/Idle timeout fields here | L:673-679 | Does not prove Funnel ingress has no idle/connection limits. |
| Funnel adds a context marker to the same proxy path and does not supply tailnet identity headers | L:1173-1179; Funnel arrives through tcpHandlerForServe at :512 and :648-665 | Public MCP must retain its own authentication; tailnet identity cannot be assumed for public callers. |

## UNKNOWNs and evidence needed
1. Exact nodecap.HTTPS/FunnelPorts literal strings and default 443/8443/10000 policy: need pinned nodecap definitions and control-plane policy defaults/live capability snapshot. No hardcoded guarantee in scoped validator.
2. Full feature enablement prompt/URL and --yes interaction, exact Linux operator/sudo advice, daemon-connect failure text: need enableFeatureInteractive, RunWithContext, local client/error helper definitions plus actual control response.
3. Exact serve-status JSON no-config behavior/format: need runServeStatus implementation (registered but not implemented in these eight files).
4. Certificate CA, cache, first issuance duration, certificate renewal/background refresh details: need GetCertPEM/cert-refresh implementation and an authorized runtime test.
5. End-to-end Funnel SSE buffering, long-lived connection timeouts, rate/size limits and restart recovery: need ingress implementation/service contract, pinned Go reverse-proxy behavior and authorized streaming test.
6. CLI binary installation/discovery across platform variants, daemon service installation state and actual active local port readiness: need host-specific inspection; not performed/authorized in this source-only assignment.

Source-bound conclusion: The safest adapter cannot guarantee zero prompts on an unconfigured tailnet or non-disturbing public exposure by merely choosing a new path. It must verify prerequisites, reserve an unused allowed listener, reconcile config/ownership, and stop when those conditions are not met.

## Pinned source files

Read date: 2026-11-11. Commands shown above are examples derived from this source revision; runtime behavior remains a separate observation.

- [cmd/tailscale/cli/serve_v2.go](https://github.com/tailscale/tailscale/blob/7b2c32b9138b0ab2321910c7eaa8e81b24919dce/cmd/tailscale/cli/serve_v2.go)
- [cmd/tailscale/cli/funnel.go](https://github.com/tailscale/tailscale/blob/7b2c32b9138b0ab2321910c7eaa8e81b24919dce/cmd/tailscale/cli/funnel.go)
- [cmd/tailscale/cli/status.go](https://github.com/tailscale/tailscale/blob/7b2c32b9138b0ab2321910c7eaa8e81b24919dce/cmd/tailscale/cli/status.go)
- [cmd/tailscale/cli/cert.go](https://github.com/tailscale/tailscale/blob/7b2c32b9138b0ab2321910c7eaa8e81b24919dce/cmd/tailscale/cli/cert.go)
- [ipn/ipnstate/ipnstate.go](https://github.com/tailscale/tailscale/blob/7b2c32b9138b0ab2321910c7eaa8e81b24919dce/ipn/ipnstate/ipnstate.go)
- [ipn/serve.go](https://github.com/tailscale/tailscale/blob/7b2c32b9138b0ab2321910c7eaa8e81b24919dce/ipn/serve.go)
- [ipn/ipnlocal/serve.go](https://github.com/tailscale/tailscale/blob/7b2c32b9138b0ab2321910c7eaa8e81b24919dce/ipn/ipnlocal/serve.go)
- [tailcfg/tailcfg.go](https://github.com/tailscale/tailscale/blob/7b2c32b9138b0ab2321910c7eaa8e81b24919dce/tailcfg/tailcfg.go)
