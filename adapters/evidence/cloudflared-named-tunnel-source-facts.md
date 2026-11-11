# Cloudflared adapter facts
Repository cloudflare/cloudflared, pinned 095f3caf1dd9084cfe063ca40a4e5b0709e53e5b. Read-only source research; only the six allow-listed files were retrieved. No CLI, tunnel, login, DNS or external network probe was run. Commands below are reference examples, not executed actions. No secrets are included.

Citation abbreviations: C = cmd/cloudflared/tunnel/cmd.go; L = cmd/cloudflared/tunnel/login.go; S = cmd/cloudflared/tunnel/subcommands.go; Q = cmd/cloudflared/tunnel/quick_tunnel.go; T = cmd/cloudflared/tunnel/configuration.go; F = config/configuration.go. All refer to the pinned revision.

## 1. Detection without side effects
| Fact | Evidence | Exact command/flag or adapter implication |
|---|---|---|
| Config lookup tries config.yml then config.yaml in ordered user directories ~/.cloudflared, ~/.cloudflare-warp, ~/cloudflare-warp, followed on non-Windows by /etc/cloudflared and /usr/local/etc/cloudflared. First existing match wins; absent -> empty path. | F:24-36,80-120 | Inspect metadata/config, never print credentials. The --config default is this discovered path (C:905-909). |
| Default directory for creating config is different from search order: Unix /usr/local/etc/cloudflared; Windows CFDPATH or existing ProgramFiles(x86)/cloudflared. | F:47-77 | Do not conflate config creation defaults with login certificate destination. |
| Login chooses the first config search directory (~/.cloudflared), expands it, creates it mode 0700 if absent, and appends credentials.DefaultCredentialFile. A nonempty existing file is treated as an existing certificate. | L:134-155; F:35,80-87 | Login is not a passive detector: it may create a directory. The exact certificate filename constant is outside scope, although S:739-740 calls it cert.pem. |
| Origin certificate selection is delegated to credentials.FindDefaultOriginCertPath; explicit certificate path supports TUNNEL_ORIGIN_CERT. | C:911-916 | --origincert spelling is referenced via flags.OriginCert, whose definition is outside scope; complete certificate search order is UNKNOWN. Do not assume config-file search equals cert-file search. |
| Tunnel credential basename is UUID.json. Writes refuse an existing file and use mode 0400. Default parent directory/lookup is NOT established here. | S:291-310; create delegates at S:287 | Prefer explicit cloudflared tunnel create --credentials-file /adapter-owned/UUID-or-name.json NAME when creation is authorized. Actual generated UUID should be recorded. |
| Tunnel credentials path flag/alias/env and inline precedence are explicit. | S:39-43,115-125 | --credentials-file /path, --cred-file /path, TUNNEL_CRED_FILE; credentials-contents overrides the file. Do not log inline contents. |
| Existing tunnel listing supports JSON and filters; it calls sc.list and does not itself invoke create/delete/route. It also starts an updater warning check. | S:313-374,407-408,701-710 | cloudflared tunnel list --output json; optional --id UUID or --name-prefix PREFIX. This is remote inventory, not an offline/no-network probe. |
| No DNS-route listing or zone enumeration command is defined in the allowed route command tree; DNS is create-only there. | S:905-945,1012-1053 | UNKNOWN: no verified command for DNS routes as JSON or proving a zone is usable. A cert/tunnel's presence alone is not proof of DNS authority. |

## 2. Commands and lifecycle
| Action | Exact command/flag | What code proves / caveat |
|---|---|---|
| Login | cloudflared tunnel login | Registered at L:50-62; base URL https://dash.cloudflare.com/argotunnel, callback store https://login.cloudflareaccess.org/ (L:22-41). Calls token.RunTransfer with cert/callback parameters (L:92-104). This is NOT proven noninteractive: browser opening, printed full transfer URL, wait/poll details and completion handshakes live outside scope. |
| Login success | Wait for successful transfer, decode/encode and file write, then success log, not merely exit zero. | L:105-131. Existing-certificate refusal returns nil at L:68-71, so zero exit alone does not mean new login completed. Success text: "You have successfully logged in.\nIf you wish to copy your credentials to a server, they have been saved to:\n%s\n". |
| Create named tunnel | cloudflared tunnel create --output json --credentials-file /adapter-owned/tunnel.json NAME | S:250-288 registers flags and creation; generates credentials per help. Exact JSON create output schema and create conflict handling are delegated to sc.create, outside scope. --output json is registered but its use inside creation is not inspected here. |
| Stable DNS hostname | cloudflared tunnel route dns UUID host.example.com | S:912-913,928-934,1012-1053 creates CNAME route and logs SuccessSummary. --overwrite-dns / -f explicitly overwrites existing DNS (S:175-179); omit it when preserving existing resources. |
| Run local origin without creating a config file | cloudflared tunnel run --credentials-file /adapter-owned/tunnel.json --url http://127.0.0.1:PORT UUID | Run includes proxy flags (S:714-745); --url exists with loopback-friendly URL string (C:960-969). This is single-origin CLI configuration, not a verified arbitrary ingress-rule serialization on argv. Ingress interpretation delegates to ingress.ParseIngressFromConfigAndCLI (T:146-150). Existing auto-discovered config can still influence it (C:905-909); do not claim this command isolates an existing user's config. |
| Run by token | cloudflared tunnel run --token-file /protected/token-file | S:127-135,769-786; token-file contents are trimmed and parsed, token overrides token-file, and either token path supersedes credential-based run. --token VALUE and TUNNEL_TOKEN also exist but must not be printed/logged; token-file is the safer reference here. Actual remote-config/origin precedence is UNKNOWN from allowed files. |
| Run without account certificate | Use UUID plus tunnel credentials | S:735-742 explicitly states cert.pem is not needed when identifying by UUID. Name lookup requirements are delegated. |
| Delete only owned tunnel | Stop only adapter-owned connector process, then cloudflared tunnel delete UUID for a recorded created UUID. | S:668-698 accepts UUID/name; help says active connections prevent deletion, -f forces it. Ownership ledger/stop recommendation follows from destructive semantics; never substitute name-prefix deletion. Local credential cleanup and DNS record cleanup are not established by this code. |
| Avoid force cleanup of others | Do not automatically use delete -f or broad cleanup. | S:137-142 force can delete connected tunnels/dependencies. S:169-173 allows cleanup --connector-id ID for one connector; deletion/DNS dependency details require sc.delete implementation. |
| Quick tunnel | cloudflared tunnel --url http://127.0.0.1:PORT | C:253-258 dispatches when url explicitly set and quick-service nonempty; Q:145 provisions POST /tunnel. This creates a tunnel and is not detection. Named --hostname is not the way to set its stable domain (C:265-267; S:763-766). |

## 3. Verified error/warning text and recovery
These are exact literals visible on the relevant paths. Wrapped OS/network/API errors are open-ended; an exhaustive upstream error list cannot be produced from the allow-list.

| Exact text/template | Evidence | Smallest recovery |
|---|---|---|
| "You have an existing certificate at %s which login would overwrite.\nIf this is intentional, please move or delete that file then run this command again.\n" | L:68-71 | Reuse existing authorized credential. Do not automatically delete it. If intentional replacement, caller handles backup/removal. |
| "Failed to write the certificate.\n\nYour browser will download the certificate instead. You will have to manually\ncopy it to the following path:\n\n%s\n" | L:105-107 | Follow the shown destination after authorized login; do not treat as success. |
| "failed to decode origin certificate"; "failed to encode origin certificate"; "error writing cert to %s" | L:110-127 | Repair certificate transfer or filesystem access; details are returned errors. |
| '"cloudflared tunnel create" requires exactly 1 argument, the name of tunnel to create.'; "failed to create tunnel"; "%s already exists"; "Unable to marshal tunnel credentials to JSON" | S:279-310 | Supply one unique owned name; preserve existing credential file; underlying create/name-conflict error is outside scope. |
| 'This command expects the format "cloudflared tunnel route dns <tunnel name/id> <hostname>"'; "Expected %d arguments, got %d"; "The third argument should be the hostname"; "%s is not a valid hostname" | S:947-961,1012-1016 | Supply ID/name and valid hostname. Does not prove that the zone belongs to the credential. |
| '"cloudflared tunnel run" accepts only one argument, the ID or name of the tunnel to run.'; '"cloudflared tunnel run" requires the ID or name of the tunnel to run as the last command line argument or in the configuration file.' | S:759-760,788-793 | Supply exactly one UUID (or configured tunnel ID). |
| "The property `hostname` in your configuration is ignored because you configured a Named Tunnel in the property `tunnel` to run. Make sure to provision the routing (e.g. via `cloudflared tunnel route dns/lb`) or else your origin will not be reachable. You should remove the `hostname` property to avoid this warning." | S:763-766 | Configure DNS route separately; do not assume hostname config creates it. |
| "Failed to read token file: %s"; "Provided Tunnel token is not valid." | S:772-786 | Use accessible correctly supplied token file; never reveal its contents to diagnose. |
| '"cloudflared tunnel delete" requires at least 1 argument, the ID or name of the tunnel to delete.' | S:686-687 | Supply only ledger-owned UUID. Active-connection exact API error is UNKNOWN; help says stop connections or force (S:674). |
| "Unknown output format '%s'" | S:701-710 | Use json or yaml. |
| "--allowed-mail is only supported for Quick Tunnels" | C:273-277 | Remove this quick-tunnel-specific flag for named tunnel commands; do not reinterpret it as named-tunnel access control. |
| "--unix-socket must be used exclusively."; "Specified origin urls using both --url and argument. Decide which one you want, I can only support one." | F:158-178 | Use a single origin specification. |
| "failed to build quick tunnel request"; "failed to request quick Tunnel"; "failed to read quick-tunnel response"; "quick tunnel provisioning response exceeds maximum size"; "failed to unmarshal quick Tunnel"; "failed to parse quick Tunnel ID" | Q:145-179,236-258 | Diagnose transport/service response, preserve failure; no unbounded retries inferred. |
| "quick tunnel provisioning failed"; "quick tunnel provisioning failed: %s"; "quick tunnel provisioning failed with status %d: %s"; "quick tunnel provisioning failed with status %d" | Q:168-175,247-254 | Surface status and sanitized service error; server error entries format "[%d] %s" joined by "; " (Q:273-278). Rate-limit recovery policy is UNKNOWN. |

No-zone, hostname-already-routed, missing-cert, and tunnel-name-taken exact messages are UNKNOWN: route/create/list/run delegate to sc methods (S:287,372,797,1047), and cert discovery delegates to credentials (C:915). Do not invent their strings, map all failures to missing login, or automatically overwrite DNS.

## 4. Quick tunnel limitations and warnings
| Fact | Evidence | Exact text/flag |
|---|---|---|
| No uptime guarantee, experimental rather than production recommendation | Q:26,118 | Exact warning below. |
| One edge connection, not HA fanout | Q:217-223 | Protocol defaults to "quic" if not explicitly set; ha-connections forcibly set to "1". This is NOT a one-request concurrency limit. |
| Provisioning HTTP client has 15-second timeout and 1 MiB response cap | Q:24,32,137-143,236-243 | These are provisioning limits, NOT proxied MCP response-size/time/concurrency limits. |
| Public startup output | Q:91-101,214-215 | "Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):" then returned HTTPS URL. Not a readiness proof. |
| Protected variant exists at this pin | Q:121-135,104-110 | --allowed-mail activates policy; output includes "Authentication: One-Time PIN (using Cloudflare Access)". This does not establish compatibility with an MCP client. |
| SSE prohibition, 200-concurrent-request claim, rate limit/quota policy | No such rule appears in these six files; Q:145-165 delegates provisioning to service | UNKNOWN. Do not promote remembered documentation into pinned-source evidence. Need service/edge policy and streaming implementation/tests. |

Exact Q:26 warning:
> Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out. However, be aware that these account-less Tunnels have no uptime guarantee, are subject to the Cloudflare Online Services Terms of Use (https://www.cloudflare.com/website-terms/), and Cloudflare reserves the right to investigate your use of Tunnels for violations of such terms. If you intend to use Tunnels in production you should use a pre-created named tunnel by following: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps

## 5. Streaming/SSE and flags
| Fact | Evidence | Exact flag / conclusion |
|---|---|---|
| Edge transport selector exists; selected protocol is logged | S:144-151; T:125,152-156 | --protocol / -p, TUNNEL_TRANSPORT_PROTOCOL. Allowed values and fallback behavior come from connection package, outside scope. "quic" is explicitly selected for quick tunnels (Q:217-219); HTTP/2 edge support/buffering behavior is not proven here. |
| Origin HTTP/2 toggle is distinct from edge protocol | C:98-99,1075-1080; F:234-235 | --http2-origin; default false; originRequest.http2Origin. "Enables HTTP/2 origin servers." No SSE guarantee follows. |
| Chunked-encoding disable switch exists | C:98,1069-1073; F:221-223 | --no-chunked-encoding / TUNNEL_NO_CHUNKED_ENCODING; originRequest.disableChunkedEncoding. Exact purpose: "Disables chunked transfer encoding; useful if you are running a WSGI server." Not an anti-buffering option. |
| Legacy proxy flag scope | C:1100-1105 | Flags using legacyTunnelFlag apply only with --url and without ingress rules; ingress configuration uses originRequest. |
| Stream write timeout defaults disabled | C:794 | A nonzero write timeout can matter to a long-lived stream; this line alone does not prove end-to-end SSE flush behavior. |
| No-buffering/SSE support | T:146-150 only delegates ingress parsing, and allowed files do not implement HTTP body forwarding | UNKNOWN. Need origin proxy and connection transport implementation plus timed SSE tests for named and quick tunnels separately. |

## UNKNOWNs and evidence needed before adapter automation
1. Certificate exact search order/default constant, certificate-missing error: credentials package implementation referenced by C:915 and L:147.
2. Default UUID.json directory, create JSON schema/name conflict, delete side effects: cmd/cloudflared/tunnel/subcommand_context.go sc.create/findID/delete/run methods (delegations in S:287,693-698,797,1032-1047).
3. DNS inventory JSON, owned-zone selection/permissions, existing-record conflict and safe DNS removal: cfapi route/account/zone/DNS implementation and server API contract. The inspected CLI route tree supplies no DNS list/delete verb (S:905-945).
4. Login browser prompt/full transfer URL/polling and no-zone UI: token.RunTransfer and dashboard flow invoked at L:92-104. Base URL is verified, generated URL is not.
5. --url versus preexisting config and token remote configuration precedence: ingress.ParseIngressFromConfigAndCLI and sc.runWithCredentials, referenced at T:147 and S:784. No arbitrary ingress JSON argv flag was established in S:714-745/C:960-1097.
6. SSE flush, long-lived response limits, reconnect behavior, numeric quick-tunnel quotas: actual proxy/connection code and service policy; then a timed MCP/SSE fixture. None was tested here.

Recommended adapter policy (design recommendation, not claimed CLI behavior): keep an ownership ledger of created tunnel UUID, exact DNS record identity/content and credential path; do not delete a discovered/reused resource, use overwrite-dns, or force-delete a shared tunnel. Read-only inventory should precede any change, and UNKNOWN zone/DNS ownership must remain a prerequisite rather than be guessed. This recommendation follows the destructive/overwrite switches at S:137-142,175-179,668-698; it is not a permission to perform them.




## Pinned source files

Read date: 2026-11-11. Commands shown above are examples derived from this source revision; runtime behavior remains a separate observation.

- [cmd/cloudflared/tunnel/cmd.go](https://github.com/cloudflare/cloudflared/blob/095f3caf1dd9084cfe063ca40a4e5b0709e53e5b/cmd/cloudflared/tunnel/cmd.go)
- [cmd/cloudflared/tunnel/login.go](https://github.com/cloudflare/cloudflared/blob/095f3caf1dd9084cfe063ca40a4e5b0709e53e5b/cmd/cloudflared/tunnel/login.go)
- [cmd/cloudflared/tunnel/subcommands.go](https://github.com/cloudflare/cloudflared/blob/095f3caf1dd9084cfe063ca40a4e5b0709e53e5b/cmd/cloudflared/tunnel/subcommands.go)
- [cmd/cloudflared/tunnel/quick_tunnel.go](https://github.com/cloudflare/cloudflared/blob/095f3caf1dd9084cfe063ca40a4e5b0709e53e5b/cmd/cloudflared/tunnel/quick_tunnel.go)
- [cmd/cloudflared/tunnel/configuration.go](https://github.com/cloudflare/cloudflared/blob/095f3caf1dd9084cfe063ca40a4e5b0709e53e5b/cmd/cloudflared/tunnel/configuration.go)
- [config/configuration.go](https://github.com/cloudflare/cloudflared/blob/095f3caf1dd9084cfe063ca40a4e5b0709e53e5b/config/configuration.go)
