# Proof and cleanup boundaries in 0.4

The structured route API publishes only a current verified subject:
`{origin,target,instanceId,handleGeneration,bootId}`. Its observation time and
expiry describe the actual proof. Neither configuration presence nor successful
transport allocation is verification. A status projection with an unknown
subject is unverified and has no published address.

| Public path | Proof and publication | Cleanup authority |
| --- | --- | --- |
| `expose` session usage | Admitted operational plan run by the generic session controller: the host acknowledges the exact announced origin, then the controller proves only that origin with a current nonce, endpoint/generation binding and optional stream checks, from the provider's declared vantage (see below). The controller adds its current incarnation/target subject | Attributable local process identities and the exact owned operational resource. A failed initial proof shuts down the owned runtime; uncertainty remains cleanup debt |
| `expose` attached HTTPS | HTTP nonce/stream gate, or adapter-declared `prepareProof`. Hook results must match the current attempt id and normalized endpoint, current deadline/cancellation and observation interval before publication | Exact returned receipt, retained on failed proof/start/close. SDK/process close is followed by independent presence observation. Acknowledgement alone cannot confirm absence |
| `ensureRoute` / `adoptRoute` durable | Conditional native configuration ownership plus service challenge. Proof is bound to the current target/incarnation/generation; adoption rechecks the unchanged native rule before claiming it | Exact owned rule/target, conditional comparison and absence read-back; foreign rules are preserved. Known partial writes remain retained uncertain intents |
| Owner-kept `ensureRoute` / structured status | Current service challenge and subject. Reviewing consent withdraws; successful redemption requires fresh proof | Removes Gozar's local tracking and publication only. The application and upstream ingress stay owner-owned |
| Unknown extension fixture | Declares its own non-HTTP proof hook; no provider-id dispatch or HTTP-only core branch. Wrong attempt/endpoint or failed custom proof cannot publish | Fixture adapter receipt and independent ledger. This proves the seam, not an actual external provider |
| Raw shipped TCP/TLS profiles | Detect-only in 0.4; no executable candidate token | Experimental module tests do not admit these profiles publicly |

A recipe session (localhost.run, tunnl.gg, LAN, Tailscale Funnel and Serve) is proven by the generic session controller, never by the allocation.
The bounded allocation turns the pure core's allocate and remove steps into driver effects and keeps the core's own probe effect, unrun. After the host
acknowledged the exact announced origin, the session controller asks the allocation to run that probe, and the effect driver applies the checks it
always applies: the probe's origin, vantage, generation and freshness, this attempt's nonce and verifier, TLS and the stream protocols the core asked
for. A remote vantage (public, tailnet, LAN) needs a trusted executor for that vantage. The session runtime accepts one (`runtime.probeExecutor`), but
0.5.2 has no public factory option that supplies it, so the only executor a host gets is the public relay verifier, a request pinned to a public DNS
answer and a public IP, which serves the public vantage only. So a Funnel proof cannot be answered over the tailnet, and a tailnet or LAN proof stays
unverified, and the route is withdrawn, as in 0.5.1. A loopback fetch from the session's own device is never substituted for an intended vantage. A proof that ran from the host's own network says
so in `verification.vantage` (`this-device`). Stopping needs no proof: a stop while the proof is still pending removes what the ledger records as owned,
and the core is never given a probe result that was not observed.

The small historical Rust recipe verifier accepted weaker receipts. It is
excluded from 0.4 public session publication: the session runtime admits only
operational plans, and control rejects its health/publication commands. An old attributable journal remains stoppable. This exclusion preserves
the richer operational verifier; it does not weaken its authorization checks.
The internal Rust state-machine fixtures are not an alternate public create API.

The compatibility `@tnunamak/gozar/service` helpers predate the structured route
contract. A host-command result from those helpers is host-supplied evidence and
does not acquire a structured verified subject. Use the factory route API for
G4/G5 consent and proof guarantees. The owner application still must check its
login, authorization and application journey.

## Refresh, cancellation and failure

An adapter's optional `refresh` must be safe for the published forwarding path.
Without it, status retains the original proof time/expiry. It does not rerun
initial verification or stamp an old proof fresh. Expiry withdraws publication.
Same-generation review/redeem obtains current facts and fresh safe proof; an
initial-only adapter returns `proof_refresh_unsupported`, remains unpublished
and offers stop. Stop/cancellation/deadline fences prevent late completion from
restoring publication.

Startup failure can precede a usable control socket. The durable local record,
partial `error.route` and operation reservation therefore remain recovery
evidence. A confirmed cleanup result survives a failed controller's phase
transition; otherwise status/close keep uncertainty explicit and retry the exact
resource. Missing map entries or a close RPC/exit code do not establish absence.

Only an explicit bound negative allocation response can establish no allocation;
the SDK adapter recognizes its invalid-agent-token response by an allow-listed
code, never by parsing arbitrary error prose. Unknown/network responses retain
uncertainty. Late SDK results remain owned until compensating close and exact
absence can be established. The host must preserve its credential/effect broker
for the controller lifetime; losing it withdraws authority and can leave cleanup
unconfirmed until recovery.

Stopping a connector/listener does not delete account domains, remote tunnel
registration, DNS, stored credentials or another connector's session. Local
credential rotation is not remote revocation. Those boundaries remain visible
in facts and the operator walk.

## Concrete negative evidence

`public-proof-boundary` and `legacy-publication-exclusion` check the public legacy
exclusion and retained exact stop path. Existing `operational`, `route-rotation`
and gate tests check richer nonce/endpoint/generation/expiry and cancellation
invariants. `provider-lifecycle` rejects a custom proof tagged for another attempt.
The protocol proof tests cover unrelated echo servers, bounded framing, local
witness, pinned synthetic certificate and byte-transparent forwarding; those
experimental checks are not raw-profile public admission.

`real-adapter-testing-effects` exercises buffered initial proof, safe credential
refusal, retained failed close and retry through the shipped modules/controller.
`sdk-lifecycle` covers late result compensation and false close acknowledgement.
`real-durable-testing-effects` covers conditional removal, foreign resource
preservation and partial remote write. `real-external-testing-effects` proves
withdraw/review/reproof and that close leaves the owner's app running.
`public-consent-drift` checks changed/added/removed/reclassified consent rows,
display-only changes, draft observations and same-generation review authority.
No test result here asserts live-provider acceptance.
