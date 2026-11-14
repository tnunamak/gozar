# Missing read contracts for remaining consumer outcomes

These are authorized READ-ONLY dependency snapshots at exact parent51aa6c2 (runtime6ef11f3). New build rows may edit only their named source/test files, not transcript dependencies. Sources are copied without altering meaning or inventing hidden values. Original public consumer snippets remain in the earlier evidence document at the same base.

Owner approval contract: Candidate.candidateToken is an opaque nullable string read from actual current catalog. Route approval copies kind route, that runtime field, disclosureRevision from Candidate.disclosure.revision and consentFactsDigest. Runtime approval copies approvalToken and digest returned by public review. These field NAMES and runtime passthrough are authorized; no supplied authority values, decoding, fabricating or logging. Every request uses same home/owner/providerId/scope/revision. Undefined runtime field means fixture not ready: assert actual cause rather than invent it.

Unlanded partial test artifacts not present in the pinned repository are NOT accepted inputs and must not become a blocker. Author one complete test in the scoped new filename using these exact contracts, replacing any absent speculative partial. Do not ask Dalan to reconcile hidden old work before implementing. Never claim partial/unexecuted tests as closure.


## Read-only dependency adapters/providers/lan/definition.json

```json
{
  "wraps": "../../lan.definition.json",
  "adapter": {
    "schemaVersion": 1,
    "id": "lan",
    "label": "Local network",
    "needs": "Needs a network address on this computer that other devices on the same network can reach. Traffic is not encrypted.",
    "capabilities": {
      "reach": "lan",
      "transport": "http",
      "traffic": {
        "tlsTermination": "unknown",
        "providerCanReadPayload": false,
        "readers": [
          "the local network path (unencrypted HTTP)"
        ],
        "metadataVisibleTo": [],
        "evidenceRef": "adapters/lan.definition.json"
      },
      "address": {
        "stability": "unknown",
        "scope": "selected interface address with an OS-assigned port",
        "conditions": [
          "firewall and routing are the owner\u2019s prerequisites",
          "no TLS: HTTPS-required clients cannot use it"
        ],
        "ports": null
      },
      "cost": {
        "kind": "free",
        "summary": "Gozar charges nothing and there is no provider; the owned local forwarder uses your own network.",
        "currency": null,
        "amount": null,
        "period": null
      },
      "needsAccount": false,
      "lifetimes": [
        "session"
      ],
      "supervision": "controller",
      "protocols": {
        "sse": true,
        "streamableHttp": true,
        "oauthDcr": false
      },
      "proof": {
        "vantage": "lan",
        "checks": [
          "nonce",
          "sse"
        ]
      }
    },
    "supportedKinds": [
      "session"
    ],
    "disclosure": {
      "revision": "disc-c02f07dea26d",
      "text": "Expose this service on a selected local network interface over plain HTTP through an owned forwarder. Anyone on that network path can read the traffic.",
      "links": []
    },
    "ownership": "gozar-owned",
    "availability": {
      "session": {
        "state": "available",
        "reason": "admitted"
      },
      "attached": {
        "state": "unsupported",
        "reason": "usage-not-supported"
      },
      "durable": {
        "state": "unsupported",
        "reason": "usage-not-supported"
      }
    },
    "prerequisites": [
      {
        "id": "local-setup",
        "label": "Local prerequisites",
        "observation": "detected"
      }
    ],
    "facts": [
      {
        "id": "cost-detail",
        "label": "Cost details",
        "value": "Gozar charges nothing and there is no provider; the owned local forwarder uses your own network.",
        "known": true,
        "group": "cost",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "entitlement",
        "label": "Account entitlement",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "account",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "quota",
        "label": "Remaining quota",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "limits",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "mapping",
        "label": "Effective provider mapping",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "configuration",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "address-condition-0",
        "label": "Address condition",
        "value": "firewall and routing are the owner\u2019s prerequisites",
        "known": true,
        "group": "address",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "address-condition-1",
        "label": "Address condition",
        "value": "no TLS: HTTPS-required clients cannot use it",
        "known": true,
        "group": "address",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "public-names",
        "label": "Public names",
        "value": null,
        "known": false,
        "reason": "not-observed",
        "group": "privacy",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "certificate-logs",
        "label": "Certificate logs",
        "value": null,
        "known": false,
        "reason": "not-observed",
        "group": "privacy",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "browser-warning",
        "label": "Browser warning",
        "value": null,
        "known": false,
        "reason": "not-observed",
        "group": "access",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "payload-readers",
        "label": "Payload readers",
        "value": "Traffic is unencrypted; the local network path (unencrypted HTTP) can read it.",
        "known": true,
        "group": "privacy",
        "affectsConsent": true,
        "source": "adapters/lan.definition.json",
        "asOf": "2026-11-12"
      },
      {
        "id": "provider-clocks",
        "label": "Actual provider expiry and quota window",
        "value": "not-applicable",
        "known": true,
        "group": "limits",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "provider-retry",
        "label": "Current provider retry-after or refusal",
        "value": "not-applicable",
        "known": true,
        "group": "limits",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "diagnostics-access",
        "label": "Current account diagnostic access",
        "value": "not-applicable",
        "known": true,
        "group": "account",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "credential-validity",
        "label": "Current credential validity",
        "value": "not-applicable",
        "known": true,
        "group": "account",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "traffic-policy",
        "label": "Effective remote traffic policy",
        "value": "not-applicable",
        "known": true,
        "group": "access",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "certificate-renewal",
        "label": "Current CA issuance or renewal outcome",
        "value": "not-applicable",
        "known": true,
        "group": "privacy",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "dns-authority",
        "label": "Current DNS configuration and token grants",
        "value": "not-applicable",
        "known": true,
        "group": "configuration",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "authoritative-address",
        "label": "Current authoritative provider domain",
        "value": "not-applicable",
        "known": true,
        "group": "address",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "account-authorization",
        "label": "Current organization approval and ACL entitlement",
        "value": "not-applicable",
        "known": true,
        "group": "access",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "remote-residue",
        "label": "Remote DNS, certificate and token residue",
        "value": "not-applicable",
        "known": true,
        "group": "ownership",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "alternative-cost",
        "label": "Account-specific alternative cost and quota",
        "value": "not-applicable",
        "known": true,
        "group": "cost",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "proof-scope",
        "label": "Proof scope",
        "value": "Route transport and current Gozar boundary only; application login, authorization and downstream journeys are host-owned.",
        "known": true,
        "group": "proof",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "storage-policy",
        "label": "Credential storage",
        "value": "The configured host credential backend owns custody; the default uses private local files. Read-back returns presence and non-secret values only.",
        "known": true,
        "group": "setup",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "change-policy",
        "label": "Configuration changes",
        "value": "Saved inputs do not silently reconfigure a running route; stop and obtain fresh consent before replacing it.",
        "known": true,
        "group": "configuration",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "fallback-policy",
        "label": "Fallback policy",
        "value": "Never substitute a different provider without consent.",
        "known": true,
        "group": "access",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "remote-termination",
        "label": "Effective remote TLS termination",
        "value": "not-applicable",
        "known": true,
        "group": "privacy",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-logging",
        "label": "Account-selected logging and retention",
        "value": "not-applicable",
        "known": true,
        "group": "privacy",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-name-ownership",
        "label": "Current reserved name ownership",
        "value": "not-applicable",
        "known": true,
        "group": "address",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-setup-completion",
        "label": "Provider consent or remote setup completion",
        "value": "not-applicable",
        "known": true,
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "provider-status",
        "label": "Current provider dashboard status",
        "value": "not-applicable",
        "known": true,
        "group": "runtime",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "browser-warning-applicability",
        "label": "Account-specific browser warning applicability",
        "value": "not-applicable",
        "known": true,
        "group": "access",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-collision",
        "label": "Current remote endpoint collision",
        "value": "not-applicable",
        "known": true,
        "group": "address",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "revocation-state",
        "label": "Actual credential revocation and remaining connectors",
        "value": "not-applicable",
        "known": true,
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-control-authority",
        "label": "Current remote binding and controller authority",
        "value": "not-applicable",
        "known": true,
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "provider-depletion",
        "label": "Current provider depletion or license expiry",
        "value": "not-applicable",
        "known": true,
        "group": "limits",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-domain-options",
        "label": "Account reserved-domain choices",
        "value": "not-applicable",
        "known": true,
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "account-domain-suggestion",
        "label": "Current account-assigned suggested domain",
        "value": "not-applicable",
        "known": true,
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-issuance",
        "label": "Provider credential issuance or refresh outcome",
        "value": "not-applicable",
        "known": true,
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-job-completion",
        "label": "Provider provisioning job completion",
        "value": "not-applicable",
        "known": true,
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-identity",
        "label": "Authenticated remote account or tunnel identity",
        "value": "not-applicable",
        "known": true,
        "group": "account",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-rotation",
        "label": "Remote credential rotation outcome",
        "value": "not-applicable",
        "known": true,
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-deletion-proof",
        "label": "Remote revocation and deletion proof",
        "value": "not-applicable",
        "known": true,
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "retained-configuration",
        "label": "Retained configuration",
        "value": "Stopping a route keeps saved input values and credentials. Local rotation does not revoke a credential at the provider.",
        "known": true,
        "group": "ownership",
        "affectsConsent": false,
        "source": "adapter-configuration",
        "asOf": "2026-11-13"
      }
    ],
    "effectOperations": [
      {
        "kind": "recipe",
        "operation": "probe"
      },
      {
        "kind": "spawn",
        "operation": "run"
      },
      {
        "kind": "spawn",
        "operation": "read"
      },
      {
        "kind": "spawn",
        "operation": "close"
      },
      {
        "kind": "network",
        "operation": "fetch"
      }
    ]
  },
  "evidence": {
    "accessed": "2026-11-12",
    "sources": [],
    "protocols": {
      "sse/streamableHttp": "true. Backed by validation.sse (timed incremental event delivery when required) and validation.publish (exact-origin approval only after all required probes) in the wrapped recipe definition, with admission.requiredFeatures probe-assertions and client-vantage-probe.",
      "oauthDcr": "oauthDcr false: the origin is plain HTTP on a local address, not a stable HTTPS origin."
    }
  }
}
```

## Read-only dependency adapters/lan.definition.json

```json
{
  "schemaVersion": 1,
  "definition": {
    "id": "lan",
    "label": "Local network",
    "audience": "lan",
    "ownership": "owned",
    "reason": "An owned interface forwarder exposes only the selected loopback service to the local network.",
    "capabilities": {
      "https": false,
      "sse": null,
      "streamableHttp": null,
      "oauthDcr": null
    },
    "unknowns": [
      "Current capability requires a successful probe from the intended client network.",
      "Local network reach does not imply internet reach; firewall, routing and client DNS remain prerequisites.",
      "This plan supplies HTTP only. HTTPS-required clients are denied; separately established trusted TLS needs a separately admitted listener plan."
    ],
    "capabilityRecords": [
      {
        "when": "default owned HTTP forwarder",
        "capabilities": {
          "https": false
        },
        "reasons": [
          "HTTP is explicit; loopback binding is never advertised as LAN."
        ]
      },
      {
        "when": "LAN-vantage nonce / stream probes succeed",
        "capabilities": {
          "sse": true,
          "streamableHttp": true,
          "oauthDcr": true
        }
      }
    ],
    "actions": [
      {
        "id": "interface",
        "label": "Choose a local network interface",
        "reason": "A loopback listener cannot serve other devices."
      },
      {
        "id": "firewall",
        "label": "Allow this listener through your firewall",
        "reason": "Network exposure needs a deliberate scoped firewall decision; no automatic global rule."
      },
      {
        "id": "local-name",
        "label": "Choose a client-reachable name or IP",
        "reason": "Use local DNS/mDNS only when proven from the client; an explicit checked interface IP also works."
      },
      {
        "id": "lan-tls",
        "label": "Configure a trusted certificate if HTTPS is required",
        "reason": "Self-signed certificates are not automatically trusted."
      }
    ],
    "recipes": {
      "detect": {
        "kind": "interfaces",
        "timeoutMs": 5000,
        "maxOutputBytes": 16384,
        "parser": {
          "kind": "json-document",
          "predicate": {
            "op": "all",
            "rules": [
              {
                "op": "exists",
                "pointer": "/interfaces/*/*/address"
              },
              {
                "op": "equals",
                "pointer": "/interfaces/*/*/internal",
                "value": false
              }
            ]
          }
        }
      },
      "create": {
        "kind": "local-forwarder",
        "bindAddress": "{interfaceAddress}",
        "port": "{ownedPort}",
        "targetHost": "127.0.0.1",
        "targetPort": "{gatePort}",
        "timeoutMs": 5000,
        "maxOutputBytes": 16384,
        "parser": {
          "kind": "json",
          "pointer": "/origin"
        },
        "before": [],
        "requires": [
          {
            "op": "verified",
            "fact": "selected-interface-still-present",
            "value": {
              "address": "{interfaceAddress}"
            }
          },
          {
            "op": "verified",
            "fact": "firewall-user-approved",
            "value": {
              "bindAddress": "{interfaceAddress}",
              "port": 0,
              "targetHost": "127.0.0.1",
              "targetPort": "{gatePort}",
              "scheme": "http"
            }
          }
        ],
        "after": [],
        "ledger": {
          "bindAddress": "{interfaceAddress}",
          "targetHost": "127.0.0.1",
          "targetPort": "{gatePort}",
          "scheme": "http",
          "requestedPort": "{ownedPort}"
        }
      },
      "remove": {
        "kind": "local-forwarder",
        "timeoutMs": 5000,
        "maxOutputBytes": 16384,
        "parser": {
          "kind": "exit-code"
        },
        "before": [],
        "requires": [],
        "after": []
      }
    },
    "admission": {
      "state": "admitted",
      "requiredFeatures": [
        "recipe-sequence",
        "typed-bindings",
        "predicate-parser",
        "owned-resource-ledger",
        "probe-assertions",
        "client-vantage-probe",
        "interface-forwarder"
      ],
      "reason": "Normalized HTTP plan; fresh exact selected-interface and scoped firewall approval permit allocation. Client reachability is established only after creation by a genuine remote LAN probe."
    },
    "validation": {
      "tls": "client-trusted certificate and exact hostname when HTTPS",
      "instanceNonce": "must equal private instance challenge",
      "sse": "timed incremental event delivery when required",
      "vantage": "lan",
      "publish": "exact-origin approval only after all required probes"
    },
    "lifecycle": {
      "persistIntentBeforeMutation": true,
      "completionScope": [
        "effectId",
        "sessionId",
        "generation"
      ],
      "rawOutput": "transient bounded; never persist",
      "stop": "withdraw before cleanup; reconcile uncertain effects",
      "globalCleanup": false,
      "networkVantage": "LAN candidate remains validation-pending until genuine remote LAN peer receipt; name/mDNS or explicit reachable IP is a client choice, never inferred from host OS name."
    },
    "bindings": {
      "interfaceAddress": {
        "type": "selected-interface-address"
      },
      "gatePort": {
        "type": "loopback-port"
      },
      "ownedPort": {
        "type": "reserved-unused-port",
        "value": 0
      }
    },
    "planVersion": 1,
    "detection": {
      "exclude": [
        "loopback",
        "unspecified",
        "multicast",
        "link-local-without-scope"
      ],
      "authority": "Fresh exact interface binding and current-interface receipt; raw inventory alone does not prove client reach."
    },
    "drop": "1",
    "displayName": "Local network (HTTP)",
    "copy": {
      "consent": "Expose this loopback service on the selected interface through an owned HTTP forwarder. Approve the exact firewall scope and prove the address from the intended LAN client.",
      "human": {
        "name": "lan",
        "address": "assigned on the selected network interface when it starts",
        "summary": "HTTP on your local network",
        "setup": "Choose --bind-address IP and approve it with --firewall-ack IP"
      }
    },
    "addressStability": "unknown",
    "durableLifetime": null,
    "idleTimeoutMs": null
  }
}
```

## Read-only dependency adapters/providers/tunnl-gg/definition.json

```json
{
  "wraps": "../../tunnl-gg.definition.json",
  "adapter": {
    "schemaVersion": 1,
    "id": "tunnl-gg",
    "label": "tunnl.gg trial",
    "needs": "Needs the ssh command on this computer and outbound internet access. No account is needed.",
    "capabilities": {
      "reach": "internet",
      "transport": "https",
      "traffic": {
        "tlsTermination": "provider",
        "providerCanReadPayload": true,
        "readers": [
          "tunnl.gg relay"
        ],
        "metadataVisibleTo": [
          "tunnl.gg relay"
        ],
        "evidenceRef": "https://tunnl.gg (accessed 2026-11-12) ; https://tunnl.gg/terms.md (accessed 2026-11-12) ; https://tunnl.gg/privacy.md (accessed 2026-11-12)"
      },
      "address": {
        "stability": "stable",
        "scope": "address bound to an installation key",
        "conditions": [
          "an announced address change ends the route",
          "the relay can close quiet streams after about two minutes",
          "browsers can show a warning page"
        ],
        "ports": null
      },
      "cost": {
        "kind": "free",
        "summary": "The free tier costs nothing and needs no account; Pro is $6 a month or $60 a year and removes time limits and the warning page.",
        "currency": "USD",
        "amount": 0,
        "period": null
      },
      "needsAccount": false,
      "lifetimes": [
        "session"
      ],
      "supervision": "controller",
      "protocols": {
        "sse": true,
        "streamableHttp": true,
        "oauthDcr": true
      },
      "proof": {
        "vantage": "public",
        "checks": [
          "tls",
          "nonce",
          "sse"
        ]
      }
    },
    "supportedKinds": [
      "session"
    ],
    "disclosure": {
      "revision": "disc-6d909da5b275",
      "text": "Start a public HTTPS trial through the tunnl.gg relay. The relay terminates TLS and can read payloads. Quiet streams can close after two minutes.",
      "links": [
        {
          "rel": "terms",
          "label": "Terms",
          "href": "https://tunnl.gg/terms.md"
        },
        {
          "rel": "privacy",
          "label": "Privacy",
          "href": "https://tunnl.gg/privacy.md"
        }
      ]
    },
    "ownership": "gozar-owned",
    "availability": {
      "session": {
        "state": "detect-only",
        "reason": "execution-not-implemented"
      },
      "attached": {
        "state": "unsupported",
        "reason": "usage-not-supported"
      },
      "durable": {
        "state": "unsupported",
        "reason": "usage-not-supported"
      }
    },
    "prerequisites": [
      {
        "id": "local-setup",
        "label": "Local prerequisites",
        "observation": "detected"
      }
    ],
    "facts": [
      {
        "id": "cost-detail",
        "label": "Cost details",
        "value": "The free tier costs nothing and needs no account; Pro is $6 a month or $60 a year and removes time limits and the warning page.",
        "known": true,
        "group": "cost",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "entitlement",
        "label": "Account entitlement",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "account",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "quota",
        "label": "Remaining quota",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "limits",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "mapping",
        "label": "Effective provider mapping",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "configuration",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "terms-terms",
        "label": "Terms",
        "value": "https://tunnl.gg/terms.md",
        "known": true,
        "group": "terms",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "terms-privacy",
        "label": "Privacy",
        "value": "https://tunnl.gg/privacy.md",
        "known": true,
        "group": "terms",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "address-condition-0",
        "label": "Address condition",
        "value": "an announced address change ends the route",
        "known": true,
        "group": "address",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "address-condition-1",
        "label": "Address condition",
        "value": "the relay can close quiet streams after about two minutes",
        "known": true,
        "group": "address",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "address-condition-2",
        "label": "Address condition",
        "value": "browsers can show a warning page",
        "known": true,
        "group": "address",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "public-names",
        "label": "Public names",
        "value": null,
        "known": false,
        "reason": "not-observed",
        "group": "privacy",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "certificate-logs",
        "label": "Certificate logs",
        "value": null,
        "known": false,
        "reason": "not-observed",
        "group": "privacy",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "browser-warning",
        "label": "Browser warning",
        "value": null,
        "known": false,
        "reason": "not-observed",
        "group": "access",
        "affectsConsent": false,
        "source": "https://tunnl.gg, https://tunnl.gg/terms.md, https://tunnl.gg/privacy.md",
        "asOf": "2026-11-12"
      },
      {
        "id": "payload-readers",
        "label": "Payload readers",
        "value": "The tunnl.gg relay can read the traffic.",
        "known": true,
        "group": "privacy",
        "affectsConsent": true,
        "source": "https://tunnl.gg (accessed 2026-11-12) ; https://tunnl.gg/terms.md (accessed 2026-11-12) ; https://tunnl.gg/privacy.md (accessed 2026-11-12)",
        "asOf": "2026-11-12"
      },
      {
        "id": "provider-clocks",
        "label": "Actual provider expiry and quota window",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "limits",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "provider-retry",
        "label": "Current provider retry-after or refusal",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "limits",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "diagnostics-access",
        "label": "Current account diagnostic access",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "account",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "credential-validity",
        "label": "Current credential validity",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "account",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "traffic-policy",
        "label": "Effective remote traffic policy",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "access",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "certificate-renewal",
        "label": "Current CA issuance or renewal outcome",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "privacy",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "dns-authority",
        "label": "Current DNS configuration and token grants",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "configuration",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "authoritative-address",
        "label": "Current authoritative provider domain",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "address",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "account-authorization",
        "label": "Current organization approval and ACL entitlement",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "access",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "remote-residue",
        "label": "Remote DNS, certificate and token residue",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "ownership",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "alternative-cost",
        "label": "Account-specific alternative cost and quota",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "cost",
        "affectsConsent": false,
        "source": "https://tunnl.gg",
        "asOf": "2026-11-12"
      },
      {
        "id": "proof-scope",
        "label": "Proof scope",
        "value": "Route transport and current Gozar boundary only; application login, authorization and downstream journeys are host-owned.",
        "known": true,
        "group": "proof",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "storage-policy",
        "label": "Credential storage",
        "value": "The configured host credential backend owns custody; the default uses private local files. Read-back returns presence and non-secret values only.",
        "known": true,
        "group": "setup",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "change-policy",
        "label": "Configuration changes",
        "value": "Saved inputs do not silently reconfigure a running route; stop and obtain fresh consent before replacing it.",
        "known": true,
        "group": "configuration",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "fallback-policy",
        "label": "Fallback policy",
        "value": "Never substitute a different provider without consent.",
        "known": true,
        "group": "access",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "remote-termination",
        "label": "Effective remote TLS termination",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "privacy",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-logging",
        "label": "Account-selected logging and retention",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "privacy",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-name-ownership",
        "label": "Current reserved name ownership",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "address",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-setup-completion",
        "label": "Provider consent or remote setup completion",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "provider-status",
        "label": "Current provider dashboard status",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "runtime",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "browser-warning-applicability",
        "label": "Account-specific browser warning applicability",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "access",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-collision",
        "label": "Current remote endpoint collision",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "address",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "revocation-state",
        "label": "Actual credential revocation and remaining connectors",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-control-authority",
        "label": "Current remote binding and controller authority",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "provider-depletion",
        "label": "Current provider depletion or license expiry",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "limits",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-domain-options",
        "label": "Account reserved-domain choices",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "account-domain-suggestion",
        "label": "Current account-assigned suggested domain",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-issuance",
        "label": "Provider credential issuance or refresh outcome",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-job-completion",
        "label": "Provider provisioning job completion",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-identity",
        "label": "Authenticated remote account or tunnel identity",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "account",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-rotation",
        "label": "Remote credential rotation outcome",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-deletion-proof",
        "label": "Remote revocation and deletion proof",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "retained-configuration",
        "label": "Retained configuration",
        "value": "Stopping a route keeps saved input values and credentials. Local rotation does not revoke a credential at the provider.",
        "known": true,
        "group": "ownership",
        "affectsConsent": false,
        "source": "adapter-configuration",
        "asOf": "2026-11-13"
      }
    ],
    "effectOperations": [
      {
        "kind": "recipe",
        "operation": "probe"
      },
      {
        "kind": "spawn",
        "operation": "run"
      },
      {
        "kind": "spawn",
        "operation": "read"
      },
      {
        "kind": "spawn",
        "operation": "close"
      },
      {
        "kind": "network",
        "operation": "fetch"
      }
    ]
  },
  "evidence": {
    "accessed": "2026-11-12",
    "sources": [
      "https://tunnl.gg",
      "https://tunnl.gg/terms.md",
      "https://tunnl.gg/privacy.md"
    ],
    "protocols": {
      "sse/streamableHttp": "true. Backed by validation.sse (timed incremental event delivery when required) and validation.publish (exact-origin approval only after all required probes) in the wrapped recipe definition, with admission.requiredFeatures probe-assertions and client-vantage-probe.",
      "oauthDcr": "oauthDcr: the stable user gives 'a URL tied to your SSH key that stays the same across reconnects' (https://tunnl.gg); Gozar preserves the configured authority. The wrapped recipe's addressStability 'random' conflicts with this page and is reported as an open question."
    }
  }
}
```

## Read-only dependency adapters/tunnl-gg.definition.json

```json
{
  "schemaVersion": 1,
  "definition": {
    "endpointLifetime": "owned-process",
    "id": "tunnl-gg",
    "label": "tunnl.gg stable trial",
    "audience": "public",
    "ownership": "owned",
    "reason": "Key-bound public trial; the relay terminates TLS and can read payloads.",
    "capabilities": {
      "https": null,
      "sse": null,
      "streamableHttp": null,
      "oauthDcr": null
    },
    "unknowns": [
      "The relay can close quiet streams after about two minutes.",
      "Browser users can encounter a warning page.",
      "Trust-on-first-use applies only to isolated known_hosts; changed key fails closed.",
      "The address is bound to an installation key; an announced address change withdraws the route."
    ],
    "capabilityRecords": [
      {
        "when": "validated relay origin + TLS/nonce probe",
        "capabilities": {
          "https": true
        }
      },
      {
        "when": "timed stream/client probes pass",
        "capabilities": {
          "sse": true,
          "streamableHttp": true,
          "oauthDcr": true
        }
      }
    ],
    "actions": [
      {
        "id": "ssh-install",
        "label": "Install OpenSSH",
        "reason": "OpenSSH client is absent."
      },
      {
        "id": "trial-consent",
        "label": "Start a public trial",
        "reason": "The relay sees plaintext; a changed address ends the route."
      }
    ],
    "recipes": {
      "detect": {
        "kind": "spawn",
        "program": "ssh",
        "args": [
          "-V"
        ],
        "timeoutMs": 5000,
        "maxOutputBytes": 65536,
        "parser": {
          "kind": "contains",
          "stream": "combined",
          "value": "OpenSSH"
        }
      },
      "create": {
        "kind": "spawn",
        "program": "ssh",
        "args": [
          "-F",
          "/dev/null",
          "-T",
          "-o",
          "BatchMode=yes",
          "-o",
          "ExitOnForwardFailure=yes",
          "-o",
          "ConnectTimeout=10",
          "-o",
          "ServerAliveInterval=15",
          "-o",
          "ServerAliveCountMax=2",
          "-o",
          "StrictHostKeyChecking=accept-new",
          "-o",
          "UserKnownHostsFile={privateKnownHostsPath}",
          "-o",
          "GlobalKnownHostsFile=/dev/null",
          "-o",
          "IdentityAgent=none",
          "-o",
          "IdentityFile={installIdentityPath}",
          "-o",
          "ForwardAgent=no",
          "-o",
          "IdentitiesOnly=yes",
          "-o",
          "PasswordAuthentication=no",
          "-o",
          "KbdInteractiveAuthentication=no",
          "-o",
          "PermitLocalCommand=no",
          "-R",
          "80:127.0.0.1:{gatePort}",
          "stable@proxy.tunnl.gg",
          "output=json"
        ],
        "timeoutMs": 30000,
        "maxOutputBytes": 65536,
        "parser": {
          "kind": "url",
          "prefix": "https://",
          "constraints": {
            "hostnamePattern": "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.tunnl\\.gg$",
            "exactOriginToken": true,
            "stripAnsi": true,
            "rejectMultipleDistinct": true
          },
          "jsonEvent": {
            "eventPointer": "/event",
            "eventValue": "tunnel",
            "originPointer": "/url"
          }
        },
        "before": [],
        "requires": [
          {
            "op": "private-file",
            "binding": "privateKnownHostsPath",
            "mode": "0600",
            "parentMode": "0700"
          },
          {
            "op": "private-file",
            "binding": "installIdentityPath",
            "mode": "0600",
            "parentMode": "0700"
          }
        ],
        "process": {
          "mode": "owned-long-running",
          "stdin": "closed",
          "lifetimeMs": 900000
        },
        "after": [],
        "ledger": {
          "service": "trial",
          "durationMs": 900000
        }
      },
      "remove": {
        "kind": "owned-process",
        "signal": "SIGTERM",
        "graceMs": 2000,
        "thenSignal": "SIGKILL",
        "confirmExit": true,
        "timeoutMs": 5000,
        "maxOutputBytes": 16384,
        "parser": {
          "kind": "exit-code"
        },
        "before": [],
        "requires": [],
        "after": []
      }
    },
    "admission": {
      "state": "admitted",
      "requiredFeatures": [
        "recipe-sequence",
        "typed-bindings",
        "predicate-parser",
        "owned-resource-ledger",
        "probe-assertions",
        "client-vantage-probe",
        "owned-process",
        "private-file-reference",
        "install-ed25519",
        "json-event-origin",
        "immutable-origin"
      ],
      "reason": "Opt-in stable address, private installation identity and public relay probe required."
    },
    "validation": {
      "tls": "client-trusted certificate and exact hostname when HTTPS",
      "instanceNonce": "must equal private instance challenge",
      "sse": "timed incremental event delivery when required",
      "vantage": "public",
      "publish": "exact-origin approval only after all required probes"
    },
    "lifecycle": {
      "persistIntentBeforeMutation": true,
      "completionScope": [
        "effectId",
        "sessionId",
        "generation"
      ],
      "rawOutput": "transient bounded; never persist",
      "stop": "withdraw before cleanup; reconcile uncertain effects",
      "globalCleanup": false,
      "durationMs": 900000,
      "artifactCleanup": "Only after confirmed owned process exit; handle identity checked by driver."
    },
    "bindings": {
      "gatePort": {
        "type": "loopback-port"
      },
      "privateKnownHostsPath": {
        "type": "session-private-path"
      },
      "installIdentityPath": {
        "type": "session-private-path",
        "provision": "install-ed25519"
      }
    },
    "planVersion": 1,
    "clientProfile": {
      "id": "initial-streaming",
      "clientRequirements": {
        "httpsRequired": true,
        "sse": true
      }
    },
    "displayName": "tunnl.gg stable trial",
    "drop": "1a",
    "copy": {
      "consent": "Start a public HTTPS trial. The relay terminates TLS and can read payloads. Quiet streams can close after two minutes.",
      "human": {
        "name": "tunnl.gg",
        "address": "assigned when it starts",
        "summary": "key-based trial; relay can read traffic",
        "setup": "Install OpenSSH"
      }
    },
    "originPolicy": "immutable",
    "addressStability": "random",
    "durableLifetime": null,
    "idleTimeoutMs": 121000
  }
}
```

## Read-only dependency packages/gozar-node/service.mjs

```js
import { readdir, unlink, link, open } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import {AsyncLocalStorage} from 'node:async_hooks';
import { atomicWrite } from './journal.mjs';
import { statusRoutes, durableRouteAt } from './durable-route.mjs';
import { gozarError, normalizeError,instructionAction } from './error-normalizer.mjs';
import { noncePattern, trustedDirectory, canonicalHome, privateDirectory, readRecord, withExclusiveLock,
  canonicalAuthority, transcript, verification } from './service-state.mjs';
import {currentRouteReview} from './route-consent.mjs';
import {releaseRecordedConfigurationUse} from './runtime-configuration-use.mjs';
import {consentReview,consentSnapshot} from './consent-facts.mjs';
import {issueConsentToken,redeemConsentToken,consentBinding,canonicalDigest} from './consent-token.mjs';
const serviceContext=new AsyncLocalStorage();
export const withServiceContext=(context,action)=>serviceContext.run(context,action);

const refuse = (code, message) => Object.assign(new Error(message), { code });
function originValue(value) {
  if (typeof value !== 'string') throw refuse('invalid_input', 'Invalid service origin');
  let url;
  try { url = new URL(value); } catch { throw refuse('invalid_input', 'Invalid service origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !url.hostname || (value !== url.origin && value !== url.origin + '/'))
    throw refuse('invalid_input', 'Invalid service origin');
  return url.origin;
}
function targetValue(value) {
  if (typeof value !== 'string') throw refuse('invalid_input', 'Invalid service target');
  const match = /^(\[[^\]]+\]|[a-zA-Z0-9.-]+):([0-9]+)$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535 ||
      !Number.isInteger(Number(match[2]))) throw refuse('invalid_input', 'Invalid service target');
  const host = match[1];
  if (host.startsWith('[') && isIP(host.slice(1, -1)) !== 6) throw refuse('invalid_input', 'Invalid service target');
  if (!host.startsWith('[') && !isIP(host) && (host.length > 253 ||
      /^[0-9.]+$/.test(host) || !host.replace(/\.$/, '').split('.').every(label =>
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))) throw refuse('invalid_input', 'Invalid service target');
  return value;
}
// A service route belongs to its owner. The adapter that stands for an owner-kept route is the registered adapter
// whose definition says `ownership: 'external-owned'`; its id is read from the registry, never written in core.
let ownerAdapterId;
function externalOwnerId() {
  if (ownerAdapterId) return ownerAdapterId;
  const adapters = new URL('../../adapters/', import.meta.url);
  for (const entry of JSON.parse(readFileSync(new URL('manifest.json', adapters), 'utf8')).providers) {
    const { adapter } = JSON.parse(readFileSync(new URL(entry.definition, adapters), 'utf8'));
    if (adapter.ownership === 'external-owned') return (ownerAdapterId = adapter.id);
  }
  throw refuse('internal_error', 'The registry has no adapter for an owner-kept route');
}
function config({ origin, target, verifyCmd = null,embedding,generation }) {
  if(generation!==undefined&&generation!==0&&generation!==1)throw refuse('invalid_input','Invalid external tracking generation');
  if (verifyCmd !== null && (typeof verifyCmd !== 'string' || !verifyCmd.trim() || verifyCmd.includes('\0')))
    throw refuse('invalid_input', 'Invalid verification command');
  const route = { schemaVersion: 1, origin: originValue(origin), target: targetValue(target),
    adapterId: externalOwnerId(), ownership: 'external-owned', verifyCmd,...(embedding?{embedding}: {}),...(generation!==undefined?{generation}: {}) };
  if (Buffer.byteLength(JSON.stringify(route)) > 65536) throw refuse('invalid_input', 'Service record exceeds size limit');
  return route;
}
const hash = origin => createHash('sha256').update(origin).digest('hex');
const directory = home => join(home, 'services');
const filename = origin => hash(origin) + '.json';
async function stored(path, name) {
  const value = await readRecord(path);
  const checked = config(value);
  if (value.schemaVersion !== 1 || value.adapterId !== checked.adapterId ||
      value.ownership !== checked.ownership || value.origin !== checked.origin ||
      name !== filename(checked.origin) || Object.keys(value).sort().join() !== Object.keys(checked).sort().join())
    throw new Error('Invalid service record');
  return checked;
}
async function mutate(home, origin, action) {
  const dir = directory(await canonicalHome(home, true));
  await trustedDirectory(dir, true);
  await privateDirectory(dir);
  // Keep the lock inode: unlinking it could split concurrent mutations.
  const locks = join(dir, '.locks');
  await trustedDirectory(locks, true);
  await privateDirectory(locks);
  return withExclusiveLock(join(locks, hash(origin)), () => action(dir));
}
async function currentExternal(route){
 const runtime=serviceContext.getStore();if(!runtime?.embeddingServices||!route.embedding)return null;
 const adapter=runtime.adapters.find(item=>item.id===route.adapterId);if(!adapter)throw refuse('provider_unavailable','The recorded owner-route adapter is unavailable');
 return currentRouteReview(route.embedding.request,adapter,runtime);
}
async function present(route) {
 // Records without a generation predate the current handle contract: history only.
 if((route.generation??0)===0)return {...route,verification:{status:'unverified',checkedAt:null,observedAt:null,subject:null}};
 const runtime=serviceContext.getStore(),current=await currentExternal(route);
 let checked;
 if(current&&current.review.consentFactsDigest!==route.embedding.consentReview.consentFactsDigest){
  route.embedding.reviewRequired=true;
  await mutate(route.embedding.request.home,route.origin,async dir=>{const fresh=await stored(join(dir,filename(route.origin)),filename(route.origin));if(fresh.embedding?.consentReview.consentFactsDigest===route.embedding.consentReview.consentFactsDigest)await atomicWrite(join(dir,filename(route.origin)),{...fresh,embedding:{...fresh.embedding,reviewRequired:true}});});
 }
 if(current&&route.embedding.reviewRequired)checked={status:'unverified',checkedAt:null,observedAt:null,subject:null};
 else checked=await (runtime?.verify??verification)(route);
 if(current){const identity=await runtime.embeddingServices.resolveIdentity({home:route.embedding.request.home});checked={...checked,observedAt:checked.checkedAt??null,subject:{origin:route.origin,target:route.target,...identity,handleGeneration:route.generation},validUntil:checked.checkedAt?new Date(Date.parse(checked.checkedAt)+15000).toISOString():null};}
 return {...route,verification:checked,...(current&&checked.status!=='verified'?{consentChange:{oldDigest:route.embedding.consentReview.consentFactsDigest,newDigest:current.review.consentFactsDigest,reason:'consent-or-proof-changed',nextAction:instructionAction('review-route-consent','Review changed route consent','Call reviewRouteConsent for this handle and show its current snapshot before approval.')}}:{})};
}
async function addServiceUnguarded({ origin, target, verifyCmd = null, home = defaultHome(),embedding }) {
  const route = config({ origin, target, verifyCmd,embedding,generation:1 });
  await mutate(home, route.origin, async dir => {
    const name = filename(route.origin), path = join(dir, name);
    try {
      const existing = await stored(path, name);
      if (JSON.stringify(existing) !== JSON.stringify(route)) throw refuse('route_conflict', 'Service ownership conflict');
      return;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const staging = join(dir, hash(route.origin) + '.' + randomUUID() + '.pending');
    try {
      await atomicWrite(staging, route);
      // Atomic exclusive publication: never replace an existing origin record.
      await link(staging, path);
      const fd = await open(dir, 'r');
      try { await fd.sync(); } finally { await fd.close(); }
    } finally { await unlink(staging).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  });
  return { schemaVersion: 1, route: await present(route) };
}
async function statusServicesUnguarded({ origin, home = defaultHome() } = {}) {
  const normalized = origin === undefined ? null : originValue(origin);
  // Resolve the home once; a missing home has no routes of either kind.
  try { home = await canonicalHome(home); }
  catch (error) { if (error.code === 'ENOENT') return { schemaVersion: 1, routes: [] }; throw error; }
  let names = [];
  try {
    await trustedDirectory(directory(home));
    await privateDirectory(directory(home));
    names = await readdir(directory(home));
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const routes = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json') || (normalized && name !== filename(normalized))) continue;
    routes.push(await stored(join(directory(home), name), name));
  }
  // One place to ask which long-lived routes exist: owner-managed and Gozar-owned durable routes.
  const durable = (await statusRoutes({ home, canonical: true })).routes.filter(route => !normalized || route.origin === normalized);
  return { schemaVersion: 1, routes: [...await Promise.all(routes.map(present)), ...durable] };
}
async function removeServiceUnguarded({ origin, home = defaultHome(),expectedGeneration }) {
  origin = originValue(origin);
  const removed = await mutate(home, origin, async dir => {
    // A Gozar-owned record must never be deleted while its provider route stays live.
    const owned = await durableRouteAt(dirname(dir), origin);
    if (owned) throw Object.assign(new Error(`Route ${owned} is gozar-owned; remove it with releaseRoute({ routeId: '${owned}' }) or \`gozar stop --route ${owned}\``), { code: 'gozar_owned' });
    const name = filename(origin), path = join(dir, name);
    let record;try { record=await stored(path, name); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    if(expectedGeneration!==undefined&&expectedGeneration!==(record.generation??0))throw refuse('route_conflict','The external tracking generation does not match');
    await unlink(path);
    const runtime=serviceContext.getStore();if(record.embedding&&runtime?.embeddingServices)await releaseRecordedConfigurationUse({registryId:record.embedding.consentReview?.canonicalInput.scope.registryId,home,owner:record.embedding.request.owner,providerId:record.adapterId,handle:{kind:'external',id:origin,generation:record.generation??0}},runtime);
    const fd = await open(dir, 'r');
    try { await fd.sync(); } finally { await fd.close(); }
    return true;
  });
  return { schemaVersion: 1, origin, removed };
}
async function externalReview(route,handle){
 if(route.generation!==1||handle.generation!==route.generation)throw refuse('route_conflict','Legacy or mismatched external tracking cannot receive current consent');
 const current=await currentExternal(route);if(!current)throw refuse('unsupported','This owner route has no current consent authority');
 const runtime=serviceContext.getStore(),identity=await runtime.embeddingServices.resolveIdentity({home:route.embedding.request.home});
 const subject={origin:route.origin,target:route.target,...identity,handleGeneration:handle.generation};
 const review=consentReview({scope:{...current.review.canonicalInput.scope,reviewHandle:handle.id,handleGeneration:handle.generation},typedDisclosures:current.review.canonicalInput.typedDisclosures,facts:current.review.canonicalInput.facts});
 const binding={...consentBinding(route.embedding.request,route.embedding.request.home,`runtime-review:${review.consentFactsDigest}`,review.consentFactsDigest),handle,subject};
 return {current,review,subject,binding};
}
export async function reviewExternalConsent({home,handle}){
 return mutate(home,handle.id,async dir=>{
  const path=join(dir,filename(handle.id)),route=await stored(path,filename(handle.id));
  const {review,subject,binding}=await externalReview(route,handle);
  route.embedding.reviewRequired=true;await atomicWrite(path,route);
  const issued=await issueConsentToken({home,binding,grant:{adapterId:route.adapterId,planDigest:canonicalDigest(binding),observedResource:route.origin}});
  return {...consentSnapshot(review),subject,approvalToken:issued.token,expiresAt:issued.expiresAt};
 });
}
export async function approveExternalConsent({home,handle,approvalToken,consentFactsDigest}){
 return mutate(home,handle.id,async dir=>{
  const path=join(dir,filename(handle.id)),route=await stored(path,filename(handle.id));
  const {current,review,subject,binding}=await externalReview(route,handle);
  if(review.consentFactsDigest!==consentFactsDigest)throw refuse('consent_mismatch','The owner-route review changed');
  await redeemConsentToken({home,token:approvalToken,binding,providerId:route.adapterId});
  const runtime=serviceContext.getStore(),checked=await (runtime.verify??verification)(route);
  if(checked.status!=='verified'){route.embedding.reviewRequired=true;await atomicWrite(path,route);throw refuse('verification_failed','The owner route did not pass fresh proof');}
  const previousRegistry=route.embedding.consentReview.canonicalInput.scope.registryId,use={home,owner:route.embedding.request.owner,providerId:route.adapterId,handle};
  await runtime.embeddingServices.registerConfigurationUse({...use,revision:current.configuration.revision});
  route.embedding={...route.embedding,consentReview:current.review,reviewRequired:false};await atomicWrite(path,route);
  if(previousRegistry!==runtime.registryId)await releaseRecordedConfigurationUse({...use,registryId:previousRegistry},runtime);
  return {...route,verification:{...checked,subject,observedAt:checked.checkedAt,validUntil:new Date(Date.parse(checked.checkedAt)+15000).toISOString()}};
 });
}
export function createServiceVerifier() {
  const instanceId = randomUUID();
  const secret = randomBytes(32);
  return (req, res) => {
    if (req.method !== 'GET' || typeof req.url !== 'string') return false;
    const match = /^\/\.well-known\/gozar\/service\?nonce=([0-9a-f]{64})$/.exec(req.url);
    if (!match || !noncePattern.test(match[1])) return false;
    let authority;
    try {
      if (!Array.isArray(req.rawHeaders) || req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length !== 1) return false;
      authority = canonicalAuthority(req.headers.host);
    } catch { return false; }
    const localPort = req.socket?.localPort;
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) return false;
    const proof = createHmac('sha256', secret).update(transcript(match[1], instanceId, authority, localPort), 'utf8').digest('hex');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ schemaVersion: 2, nonce: match[1], instanceId, authority, localPort, proof }));
    return true;
  };
}

// The kept hand-back and release exports. They leave through the normaliser, like every public export.
import * as durable from './durable-route.mjs';
import { defaultHome } from './default-home.mjs';
const guarded = action => async (...args) => { try { return await action(...args); } catch (error) { throw normalizeError(error); } };
export const releaseRoute = guarded(durable.releaseRoute);
export const confirmHandBack = guarded(durable.confirmHandBack);
export const cancelHandBack = guarded(durable.cancelHandBack);
// Service state errors that carry no code are Gozar's own messages about the user's own paths and records (a dangling
// alias, a record over the size limit, a lock file with the wrong mode). They keep their message and get the closed
// code `internal_error`; the lock code that raises some of them belongs to another change and is not recoded here.
const guardedService = action => guarded(async (...args) => {
  try { return await action(...args); }
  catch (error) { throw error instanceof Error && error.code === undefined ? gozarError('internal_error', error.message, null, error) : error; }
});
export const addService = guardedService(addServiceUnguarded);
export const statusServices = guardedService(statusServicesUnguarded);
export const removeService = guardedService(removeServiceUnguarded);
```

## Read-only dependency packages/gozar-node/service-state.mjs

```js
// Private state and service-challenge helpers shared by service routes and durable routes.
// Internal module: not a package export.
import { mkdir, lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { acquireProcessLock } from './process-lock.mjs';
import { isIP } from 'node:net';

export const challengePath = '/.well-known/gozar/service';
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const noncePattern = /^[0-9a-f]{64}$/;
// Check from the filesystem root before creating or using anything below it.
// Home aliases are resolved first; directories below that home must stay real.
export async function trustedDirectory(path, create = false) {
  const parent = dirname(path);
  if (parent !== path) await trustedDirectory(parent, create);
  let stat;
  try { stat = await lstat(path); }
  catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    stat = await lstat(path);
  }
  const rootSticky = stat.uid === 0 && (stat.mode & 0o1000);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Object.assign(new Error(`Unsafe service state path ${path}: use a real directory, not a symlink`), { code: 'unsafe_state_path' });
  if ((stat.uid !== 0 && stat.uid !== process.getuid()) || ((stat.mode & 0o022) && !rootSticky))
    throw Object.assign(new Error(`Unsafe service state path ${path}: set owner to the invoking user or root and chmod go-w (only root-owned sticky directories may be writable)`), { code: 'unsafe_state_path' });
}
// Resolve once, including the nearest existing ancestor of a missing home.
// Never return to the requested alias after choosing its canonical location.
export async function canonicalHome(home, create = false) {
  const requested = resolve(home);
  const missing = [];
  let ancestor = requested, canonical;
  const aliasError = () => new Error(`Cannot resolve service home ${requested}: repair dangling or looping symlinks`);
  while (true) {
    try { canonical = await realpath(ancestor); break; }
    catch (error) {
      if (error.code === 'ELOOP') throw aliasError();
      if (error.code !== 'ENOENT') throw error;
      // ENOENT also describes dangling aliases. Do not treat those as new state.
      let stat;
      try { stat = await lstat(ancestor); }
      catch (error) {
        if (error.code === 'ELOOP') throw aliasError();
        if (error.code !== 'ENOENT') throw error;
      }
      if (stat?.isSymbolicLink()) throw aliasError();
      const parent = dirname(ancestor);
      if (parent === ancestor) throw aliasError();
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
  canonical = join(canonical, ...missing);
  // Root-down checks validate the existing ancestry before creating children,
  // then validate each new component before proceeding further.
  await trustedDirectory(canonical, create);
  return canonical;
}
export async function privateDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() ||
      (stat.mode & 0o077)) throw new Error(`Invalid service state directory ${path}: use an owner-owned directory with chmod 700`);
}
export async function checkedFile(path, flags, kind) {
  let file;
  try {
    file = await open(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600)
      throw new Error(`Invalid service ${kind} ${path}: use an owner-owned regular file with chmod 600`);
    return file;
  } catch (error) {
    if (file) await file.close();
    if (['ELOOP', 'EISDIR'].includes(error.code))
      throw new Error(`Invalid service ${kind} ${path}: use an owner-owned regular file with chmod 600`);
    throw error;
  }
}
// Bounded read through the same non-symlink descriptor whose ownership and mode were checked.
export async function readRecord(path) {
  const file = await checkedFile(path, constants.O_RDONLY, 'record');
  try {
    // One extra byte detects growth beyond the limit without an unbounded read.
    const bytes = Buffer.alloc(65537);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 65536) throw new Error('Invalid service record: exceeds size limit');
    return JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } finally { await file.close(); }
}
// Run action while holding an exclusive lock named by a private lock file.
// Without waitSeconds a held lock fails at once as busy; with it, acquisition blocks up to that bound.
// A holder that dies, even by SIGKILL, loses the lock; a live holder never does (see process-lock.mjs).
export async function withExclusiveLock(path, action, { waitSeconds = 0, identity } = {}) {
  // The lock file itself stays the private anchor that is checked for owner and mode.
  const anchor = await checkedFile(path, constants.O_RDWR | constants.O_CREAT, 'lock');
  await anchor.close();
  let release;
  try { release = await acquireProcessLock(path, { waitMs: waitSeconds * 1000, ...(identity ? { identity } : {}) }); }
  catch (error) {
    if (error.code === 'busy') throw Object.assign(new Error('Service mutation busy or lock unavailable'), { code: 'busy' });
    throw error;
  }
  try { return await action(); } finally { await release(); }
}
// HTTPS authority semantics on both the direct HTTP and public HTTPS witness.
export function canonicalAuthority(value) {
  if (typeof value !== 'string' || !value || /[\s\\/@?#%,]/.test(value)) throw Object.assign(new Error('Invalid service Host'), { code: 'invalid_input' });
  const match = /^(\[[^\]]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?$/.exec(value);
  if (!match) throw Object.assign(new Error('Invalid service Host'), { code: 'invalid_input' });
  const hostname = match[1];
  if (hostname.startsWith('[')) {
    if (isIP(hostname.slice(1, -1)) !== 6) throw Object.assign(new Error('Invalid service Host'), { code: 'invalid_input' });
  } else if (!isIP(hostname) && (hostname.length > 253 || /^[0-9.]+$/.test(hostname) ||
      !hostname.replace(/\.$/, '').split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))) {
    throw Object.assign(new Error('Invalid service Host'), { code: 'invalid_input' });
  }
  if (match[2] !== undefined && (!Number.isInteger(Number(match[2])) || Number(match[2]) < 1 || Number(match[2]) > 65535))
    throw Object.assign(new Error('Invalid service Host'), { code: 'invalid_input' });
  return new URL('https://' + value).host;
}
export const transcript = (nonce, instanceId, authority, localPort) =>
  JSON.stringify(['gozar-service-proof', 2, nonce, instanceId, authority, localPort]);

export function readChallenge(url, host, targetPort, nonce, signal,fetchImpl) {
  const parse=raw=>{
    const body=JSON.parse(raw);
    if(body.schemaVersion!==2||body.nonce!==nonce||!uuid.test(body.instanceId)||!noncePattern.test(body.proof)||body.authority!==host||canonicalAuthority(body.authority)!==body.authority||body.localPort!==targetPort)throw new Error('Verification failed');
    return `${body.instanceId}:${body.proof}`;
  };
  if(fetchImpl)return (async()=>{
    const reply=await fetchImpl(url,{headers:{Host:host,Accept:'application/json'},signal});if(reply.status!==200)throw new Error('Verification failed');
    let length=0;const chunks=[];for await(const chunk of reply.body){length+=chunk.length;if(length>4096)throw new Error('Verification failed');chunks.push(chunk);}return parse(Buffer.concat(chunks).toString('utf8'));
  })();
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(url,
      { headers: { Host: host, Accept: 'application/json' }, signal }, res => {
        if (res.statusCode !== 200) { res.destroy(); reject(new Error('Verification failed')); return; }
        let bytes = 0; const chunks = [];
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 4096) { res.destroy(new Error('Verification failed')); return; }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve(parse(Buffer.concat(chunks).toString('utf8')));
          } catch { reject(new Error('Verification failed')); }
        });
      });
    req.on('error', reject);
  });
}
export function commandCheck(route, nonce, signal) {
  // Explicitly trusted owner shell code. Status executes it. Never retain child output.
  // A detached POSIX group lets timeout cleanup kill shell descendants, not just the shell.
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(route.verifyCmd, { shell: true, stdio: 'ignore', detached: grouped,
      env: { ...process.env, GOZAR_SERVICE_ORIGIN: route.origin,
        GOZAR_SERVICE_TARGET: route.target, GOZAR_SERVICE_NONCE: nonce } });
    let done = false;
    const kill = () => {
      if (!child.pid) return;
      try { if (grouped) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const finish = error => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', abort);
      try { kill(); } catch { error = new Error('Verification cleanup failed'); }
      error ? reject(error) : resolve();
    };
    const abort = () => finish(new Error('Verification timed out'));
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish(new Error('Verification failed')));
    child.once('exit', code => finish(code === 0 ? null : new Error('Verification failed')));
    if (signal.aborted) abort();
  });
}
export async function verification(route,{fetch:fetchImpl}={}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const method = route.verifyCmd === null ? 'challenge' : 'host-command';
  let status = 'verified', error = null;
  try {
    const nonce = randomBytes(32).toString('hex');
    const authority = route.verifyCmd === null ? canonicalAuthority(new URL(route.origin).host) : null;
    const targetPort = Number(route.target.slice(route.target.lastIndexOf(':') + 1));
    const work = route.verifyCmd !== null ? commandCheck(route, nonce, controller.signal) : Promise.all([
      readChallenge(new URL('http://' + route.target + challengePath + '?nonce=' + nonce),
        authority, targetPort, nonce, controller.signal,fetchImpl),
      readChallenge(new URL(route.origin + challengePath + '?nonce=' + nonce),
        authority, targetPort, nonce, controller.signal,fetchImpl)
    ]).then(([local, publicId]) => { if (local !== publicId) throw new Error('Verification failed'); });
    await Promise.race([work, new Promise((_, reject) =>
      controller.signal.addEventListener('abort', () => reject(new Error('Verification timed out')), { once: true }))]);
  } catch { status = 'failed'; error = 'Service verification failed'; }
  finally { clearTimeout(timer); controller.abort(); }
  // checkedAt is the UTC ISO-8601 completion time of this fresh observation, not saved readiness.
  return { status, method, checkedAt: new Date().toISOString(), error,
    scope: method === 'challenge' ? 'controller-origin' : 'host-command' };
}
```

## Read-only dependency packages/gozar-node/catalog.mjs

```js
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Only the checkout's admitted catalog is loaded. No executable plugins or user path flags.
export async function loadCatalog(root, { operational = false } = {}) {
  const records = [];
  async function visit(directory) {
    let files;
    try { files = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(join(directory, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        const data = JSON.parse(await readFile(join(directory, entry.name), 'utf8'));
        for (const record of Array.isArray(data) ? data : data.adapters ?? [data]) {
          if (record.id && record.recipes) records.push(record);
        }
      }
    }
  }
  await visit(join(root, 'adapters'));
  if (operational) {
    const manifest = JSON.parse(await readFile(join(root, 'adapters', 'manifest.json'), 'utf8'));
    const references = manifest.operationalCatalog;
    if (!Array.isArray(references) || !references.length) throw new Error('No operational catalog is admitted in the adapter manifest');
    for (const reference of references) {
      if (typeof reference !== 'string' || !/^[A-Za-z0-9_.-]+\.definition\.json$/.test(reference)) throw new Error('Invalid operational catalog reference');
      const { definition } = JSON.parse(await readFile(join(root, 'adapters', reference), 'utf8'));
      if (definition?.planVersion !== 1 || definition.admission?.state !== 'admitted') throw new Error('Operational catalog contains an unadmitted plan');
      const index = records.findIndex(record => record.id === definition.id);
      if (index >= 0) records[index] = definition; else records.push(definition);
    }
  }
  if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('Duplicate adapter IDs');
  return records;
}

export function safeOrigin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Expected a credential-free HTTP(S) origin');
  }
  return url.origin;
}

// Explicit plan selection is distinct from the automatic detection catalog.
export async function loadDefinition(root, adapterId) {
  const directory = join(root, 'adapters');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const references = manifest.normalizedDefinitions ?? manifest.definitions ?? [];
  for (const reference of references) {
    if (typeof reference !== 'string' || !/^[A-Za-z0-9_.-]+\.definition\.json$/.test(reference)) throw new Error('Invalid catalog definition reference');
    const { definition } = JSON.parse(await readFile(join(directory, reference), 'utf8'));
    if (definition?.id === adapterId) return definition;
  }
  throw new Error('Selected route has no declared plan definition');
}

export async function loadActiveDrop(root) {
  const manifest = JSON.parse(await readFile(join(root, 'adapters', 'manifest.json'), 'utf8'));
  return manifest.activeDrop1a ?? [];
}

export async function loadDropRequirements(root) {
  const manifest = JSON.parse(await readFile(join(root, 'adapters', 'manifest.json'), 'utf8'));
  return manifest.drop1aRequirements ?? {};
}
```

## Read-only dependency packages/gozar-node/daemon.mjs

```js
import net from 'node:net';
import { cliCommand } from './cli-command.mjs';
import { chmod, readFile, unlink, open, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { retireInstallKeyLease } from './key-route-lease.mjs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { atomicWrite, Journal, processIdentity } from './journal.mjs';
import { recordController, controllerAlive, stopController, withCleanupOutcome } from './controller-start.mjs';
import { Controller } from './controller.mjs';
import { PublicRelayVerifier } from './public-relay.mjs';
import { ProbeDirectoryExecutor } from './probe-directory.mjs';
import { routeAnnouncement } from './announcement.mjs';
import { prepareHost, LOCAL_PLAN_FEATURES } from './host.mjs';
import { loadCatalog } from './catalog.mjs';
import { createGate, validateLifetimeMs } from './gate.mjs';
import { loadCore } from './core.mjs';
import { gozarError, instructionAction } from './error-normalizer.mjs';
import {connectSessionEmbedding} from './session-embedding.mjs';

/** What a failed controller leaves for its starter: the message, and the contract code and next action when it has them. */
export const failureRecord = error => ({ message: error.message, ...(typeof error.code === 'string' ? { code: error.code, nextAction: error.nextAction ?? null } : {}) });
export const socketPath = directory => join(directory, 'control.sock');
export async function control(directory, command, timeoutMs = 15_000) {
  let operational=false;
  if(!['stop','reconcile'].includes(command?.type)){
    let bootstrap;try{bootstrap=JSON.parse(await readFile(join(directory,'bootstrap.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    const adapter=bootstrap?.adapters?.find(item=>item.id===bootstrap.adapterId);
    if(adapter&&adapter.planVersion!==1)throw gozarError('unsupported','Legacy recipe publication is not supported in 0.4. Stop this session and expose it again with an admitted operational plan.');
    operational=adapter?.planVersion===1;
    if(!operational){if(command.type==='health')command={...command,type:'status'};if(!['status','process-output'].includes(command.type))throw gozarError('unsupported','This controller has no admitted operational bootstrap; only inspection and cleanup are available');}
  }
  const identity = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
  if (!identity.startIdentity || await processIdentity(identity.pid) !== identity.startIdentity) throw new Error('Controller is not running; readiness withdrawn');
  return new Promise((resolve, reject) => {
    let output = '', settled = false;
    const socket = net.createConnection(socketPath(directory));
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(deadline); socket.destroy(); error ? reject(error) : resolve(result); };
    const deadline = setTimeout(() => finish(new Error('Controller timed out; readiness unknown')), timeoutMs);
    socket.once('connect', () => socket.write(`${JSON.stringify({ nonce: identity.nonce, command })}\n`));
    socket.on('data', chunk => {
      output += chunk;
      if (output.length > 1_048_576) return finish(new Error('Controller response exceeds limit'));
      if (output.includes('\n')) {
        try { const reply = JSON.parse(output.split('\n')[0]);if(!operational&&!['stop','reconcile'].includes(command.type)&&(reply.snapshot?.published||reply.snapshot?.phase==='published-ready'))throw gozarError('unsupported','Legacy or unidentified controller publication is not supported in 0.4'); reply.error ? finish(Object.assign(new Error(reply.error), reply.code ? { code: reply.code, nextAction: reply.nextAction ?? null } : {})) : finish(null, reply); }
        catch (error) { finish(error); }
      }
    });
    socket.on('error', error => finish(error));
    socket.on('end', () => { if (!settled) finish(new Error('Controller closed without a result')); });
  });
}

// A controller keeps the implementation it loaded at startup. Retire a stopped,
// authenticated controller before reconciling its journal with the current code.
export async function stopSession(directory) {
  let identity;
  try { identity = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let reply;
  try { reply = await control(directory, { type: 'stop' }, 120_000); }
  catch { return recoverStop(directory); }
  if (reply.snapshot?.phase !== 'cleanup-pending') return reply;
  const journal = new Journal(directory); await journal.load();
  const current = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
  if (!identity?.startIdentity || current.pid !== identity.pid || current.startIdentity !== identity.startIdentity || current.nonce !== identity.nonce ||
      !journal.value.state?.stopRequested || journal.value.state.sessionId !== reply.snapshot.sessionId) throw gozarError('cleanup_debt', 'Controller changed during stop; inspect the recorded session and retry stop');
  if (await processIdentity(identity.pid) === identity.startIdentity) {
    try { process.kill(identity.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    const deadline = Date.now() + 10_000;
    while (await processIdentity(identity.pid) === identity.startIdentity) {
      if (Date.now() >= deadline) throw gozarError('cleanup_debt', 'Stopped controller has not exited; inspect the recorded controller identity and retry stop');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  return { ...await recoverStop(directory), controllerHandover: true };
}

// options is a test seam: { identity, kill, startupTimeoutMs, graceMs }.
export async function launch(directory, configuration, executable, options = {}) {
  const identity = options.identity ?? processIdentity;
  if (configuration.lifetimeMs !== undefined) validateLifetimeMs(configuration.lifetimeMs);
  try {
    await control(directory, { type:'status', initial:true }, 1_000);
    return await control(directory, { type:'status' }, 1_000);
  }
  catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code) && !error.message.includes('not running')) throw error; }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Launch lock belongs to the caller until the child acknowledges. No competing launch overwrites configuration.
  const lockPath = join(directory, 'launch.json');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(await readFile(lockPath, 'utf8'));
    if (await processIdentity(previous.pid) === previous.startIdentity) throw gozarError('busy', 'Session is starting; retry status shortly');
    await unlink(lockPath); lock = await open(lockPath, 'wx', 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, startIdentity: await processIdentity(process.pid) }));
  await lock.close();
  try {
    await atomicWrite(join(directory, 'bootstrap.json'), configuration);
    const child = spawn(process.execPath, [executable, '--daemon', directory], { detached: true, stdio: 'ignore', env: {
      PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' } });
    child.unref();
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    // From here the detached controller is ours to stop on every failure: nothing else knows it exists.
    let record;
    try {
      record = await recordController(child, { identity });
      const startupDeadline = Date.now() + (options.startupTimeoutMs ?? (configuration.probeWaitMs ?? 5000) + 120000);
      while (Date.now() < startupDeadline) {
        try { return await control(directory, { type: 'status', initial: true }, Math.min(10000, startupDeadline - Date.now())); }
        catch (error) {
          // Exit is proven by the identity function (or our child handle), never inferred from one failed read.
          if (!await controllerAlive(record, { identity })) {
            let failure;
            try { failure = JSON.parse(await readFile(join(directory, 'failure.json'), 'utf8')); } catch {}
            throw failure?.message ? Object.assign(new Error(failure.message), { code: failure.code, nextAction: failure.nextAction ?? null })
              : gozarError('provider_unavailable', 'Controller exited before startup completed');
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      {
        const status = cliCommand('status', configuration.targetPort, dirname(directory));
        throw gozarError('provider_unavailable', `Controller startup still pending; run ${status} before retrying expose`, instructionAction('check-session', 'Check the session', `Run: ${status}`));
      }
    } catch (error) {
      if (!record) record = { pid: child.pid, startIdentity: null, child };
      throw withCleanupOutcome(error, await stopController(record, { identity, kill: options.kill, graceMs: options.graceMs }));
    }
  } finally { await unlink(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function serve(directory, { step: suppliedStep, probeExecutor, hostAuthorities, processOutputObserver } = {}) {
  const config = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8'));
  if (config.lifetimeMs !== undefined) validateLifetimeMs(config.lifetimeMs);
  const publishingAdapter = config.adapters?.find(adapter => adapter.id === config.adapterId);
  if (config.consent === true && publishingAdapter && publishingAdapter.planVersion !== 1) {
    throw gozarError('unsupported', 'Legacy recipe publication is not supported in 0.4. Stop the old session, then expose again with an admitted operational plan.');
  }
  const journal = new Journal(directory);
  await journal.load();
  // A crashed prior controller never restores readiness from disk. Only remove attributable local children.
  const step = suppliedStep ?? await loadCore();
  // Establish exclusive ownership before inspecting or cleaning a previous session.
  try {
    const prior = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
    if (await processIdentity(prior.pid) === prior.startIdentity) throw gozarError('busy', 'Existing controller is still running');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const stopNext = () => instructionAction('stop-session', `Stop the session on port ${config.targetPort}`, `Run: ${cliCommand('stop', config.targetPort, dirname(directory))}`);
  await retireInstallKeyLease(dirname(directory), directory);
  await journal.load();
  if (journal.value.state && journal.value.snapshot?.phase !== 'stopped') {
    const recovered = await recoverStop(directory);
    if (recovered.snapshot.phase !== 'stopped' || recovered.localCleanupFailures?.length) {
      throw gozarError('cleanup_debt', 'Previous session has unresolved cleanup. Run stop; inspect the journal path.', stopNext());
    }
    await journal.load();
  }
  if (Object.keys(journal.value.owned).length) throw gozarError('cleanup_debt', 'Cleanup remains pending; stop the recorded session before restarting', stopNext());
  await journal.save({operationId:config.operationId??null,owner:config.owner??null});
  let controller;
  const embedding=await connectSessionEmbedding(config,{onLoss:()=>{controller?.driver.cancelProbes();}});
  let initializedDone = false;
  let initializationError;
  let initializedResolve;
  const initialized = new Promise(resolve => { initializedResolve = resolve; });
  if (!probeExecutor && config.probeDirectory) probeExecutor = new ProbeDirectoryExecutor(config.probeDirectory, { vantages: ['public', 'tailnet', 'lan'], executorRef: config.probeExecutorId, requestPath: config.probeRequest, receiptPath: config.probeReceipt });
  if (!probeExecutor) probeExecutor = new PublicRelayVerifier();
  const selectedAdapter = config.adapters.find(adapter => adapter.id === config.adapterId);
  let routeQueue = Promise.resolve();
  const queuedRouteOrigins = new Set();
  const operational = config.operational === true || selectedAdapter?.planVersion === 1;
  const gate = operational ? await createGate(config.targetPort, { lifetimeMs: config.lifetimeMs, onExpire: () => { setImmediate(() => initialized.then(() => finalize()).catch(() => {})); } }) : null;
  if(embedding?.fixtureVerifier)probeExecutor=embedding.fixtureVerifier(gate);
  // Until the control socket is published, a failed start must close the gate: its port listener keeps the process alive.
  const abandon = async error => { await gate?.close().catch(() => {}); throw error; };
  try {
    controller = new Controller({ ...config, targetPort: gate?.port ?? config.targetPort, servicePort: config.targetPort, step, journal, onAutomaticStop: () => initialized.then(() => finalize()) });
  } catch (error) { await abandon(error); }
  controller.driver.lifetimeMs = config.lifetimeMs;
  if(embedding?.spawnProcess)controller.driver.spawnProcess=embedding.spawnProcess;
  if(embedding)controller.beforeEffect=embedding.beforeEffect;
  if(embedding)controller.beforePublication=embedding.check;
  controller.driver.probeWaitMs = config.probeWaitMs;
  controller.driver.observeProcessOutput = config.observeProcessOutput === true;
  controller.driver.onProcessOutput = event => {
    try { processOutputObserver?.(event); } catch {}
    if (!event.completeLine || event.sessionId !== controller.sessionId || event.adapterId !== selectedAdapter?.id ||
        controller.driver.stopped || controller.state?.stopRequested) return;
    const resource = controller.driver.journal.value.owned[event.resourceId];
    if (!resource || resource.kind !== 'process' || resource.retired || resource.sessionId !== event.sessionId ||
        resource.adapterId !== event.adapterId || resource.generation !== event.generation || resource.continuityRef !== event.continuityRef) return;
    const adapter = controller.driver.adapters.find(item => item.id === event.adapterId);
    if (adapter?.ownership !== 'owned' || adapter.planVersion !== 1) return;
    const origin = routeAnnouncement(adapter.recipes?.create?.parser, event.completeLine);
    if (!origin) return;
    if (origin === controller.state?.published || origin === controller.state?.candidate || queuedRouteOrigins.has(origin)) return;
    queuedRouteOrigins.add(origin);
    routeQueue = routeQueue.then(async () => {
      if (origin === controller.state?.published || origin === controller.state?.candidate || controller.driver.stopped || controller.state?.stopRequested) return;
      const activeUntil = Date.now() + 2000;
      while (Date.now() < activeUntil && !controller.state?.resources?.some(item => item.id === event.resourceId && item.cleanup === 'active')) {
        if (controller.driver.stopped || controller.state?.stopRequested) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!controller.state?.resources?.some(item => item.id === event.resourceId && item.cleanup === 'active')) return;
      if (origin === controller.state?.published || origin === controller.state?.candidate) return;
      const identity = await processIdentity(resource.pid);
      if (identity !== resource.startIdentity || controller.driver.stopped || controller.state?.stopRequested) return;
      const current = controller.driver.journal.value.owned[event.resourceId];
      if (current !== resource || current.retired || current.continuityRef !== event.continuityRef) return;
      const receipt = await controller.driver.continuity(event.resourceId);
      if (!receipt?.continuous || receipt.handleRef !== event.resourceId || receipt.continuityRef !== event.continuityRef ||
          receipt.sessionId !== event.sessionId || receipt.expiresAtMs <= controller.driver.nowMs() ||
          controller.driver.stopped || controller.state?.stopRequested || controller.driver.journal.value.owned[event.resourceId] !== resource || resource.retired) return;
      if (origin === controller.state?.published || origin === controller.state?.candidate) return;
      const result = await controller.command({ type: 'owned-process-origin', sessionId: event.sessionId, adapterId: event.adapterId,
        resourceId: event.resourceId, allocationGeneration: event.generation, continuityRef: event.continuityRef, origin, line: event.completeLine });
      if (config.approveOrigin === true && result.snapshot?.phase === 'candidate-ready' && result.snapshot.candidate === origin &&
          !controller.driver.stopped && !controller.state?.stopRequested) {
        await controller.command({ type: 'approve-origin', origin, generation: result.snapshot.generation });
      }
    }).catch(() => {}).finally(() => queuedRouteOrigins.delete(origin));
  };
  if (operational) await prepareHost(controller.driver, selectedAdapter, { origin: config.origin, gate, probeExecutor, authorities: hostAuthorities }).catch(abandon);
  let setupPending = Boolean(gate && selectedAdapter?.setup?.requiresProxyTarget);
  const present = async output => {const result=({ ...output, ...(gate ? { lifetimeMs: gate.lifetimeMs, expiresAtMs: gate.expiresAtMs } : {}), ...(selectedAdapter?.clientProfile ? { connectionProfile: selectedAdapter.clientProfile } : {}),
    ...(setupPending && !controller.state?.stopRequested ? { action: { kind: 'external', instruction: `Point the existing origin ${config.origin} at ${gate.target}, then run ${cliCommand('health', config.targetPort, dirname(directory))}.`, target: gate.target, recheckCommand: 'health' } } : {}) });
    const projected=embedding?await embedding.project(result):result;
    if(embedding)await journal.save({embeddingView:publicReply(projected,directory)});
    return projected;
  };
  const nonce = randomUUID();
  const identity = { pid: process.pid, startIdentity: await processIdentity(process.pid).catch(abandon), nonce };
  // Only remove a stale socket after proving the prior daemon identity is gone.
  try {
    const prior = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
    if (await processIdentity(prior.pid) === prior.startIdentity) throw gozarError('busy', 'Existing controller is still running');
    await unlink(socketPath(directory)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  } catch (error) { if (error.code !== 'ENOENT') await abandon(error); }
  let closing = false;
  let armMonitor = () => {};
  const server = net.createServer(socket => {
    let input = '', dispatched = false;
    socket.setTimeout((config.probeWaitMs ?? 5000) + 120000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async chunk => {
      input += chunk;
      if (input.length > 65_536) return socket.destroy();
      if (dispatched || !input.includes('\n')) return;
      dispatched = true;
      try {
        const message = JSON.parse(input.split('\n')[0]);
        if (message.nonce !== nonce) throw new Error('Controller identity mismatch');
        const command = message.command;
        if(command?.type==='resolver-lost'){controller.driver.cancelProbes();socket.end(`${JSON.stringify(publicReply(await present(controller.present()),directory))}\n`);return;}
        if(command?.type==='review-consent'&&embedding){socket.end(`${JSON.stringify({review:await embedding.review()})}\n`);return;}
        if(command?.type==='approve-consent'&&embedding){const output=await embedding.approve(command,async()=>{let result=await controller.command({type:'health'});if(result.snapshot.phase==='candidate-ready')result=await controller.approve();return result;});socket.end(`${JSON.stringify(publicReply(await present(output),directory))}\n`);return;}
        if (command?.type === 'process-output') {
          if (!Number.isSafeInteger(command.after ?? 0) || (command.after ?? 0) < 0) throw new Error('Invalid output cursor');
          socket.end(`${JSON.stringify({ events:controller.driver.readProcessOutput(command.after ?? 0) })}\n`); return;
        }
        if (!['status', 'health', 'update-origin', 'stop', 'reconcile', 'approve-origin'].includes(command?.type)) throw new Error('Unsupported controller command');
        if (command.initial === true) {
          await initialized;
          if (initializationError) throw initializationError;
        }
        let output;
        if (command.type === 'stop') {
          output = await finalize();
        } else {
          if (setupPending && command.type === 'health') {
            setupPending = false;
            output = await controller.command({ type: 'start', adapterId: config.adapterId, consent: config.consent === true });
            if (config.approveOrigin && output.snapshot.phase === 'candidate-ready') output = await controller.approve();
            armMonitor();
            socket.end(`${JSON.stringify(publicReply(await present(output), directory))}\n`); return;
          }
          if (command.type === 'update-origin') {
            if (selectedAdapter?.ownership !== 'external-owned') throw new Error('Origin updates require an external-owned route');
            const origin = (await import('./catalog.mjs')).safeOrigin(command.origin);
            if (!origin.startsWith('https:')) throw new Error('External origin requires HTTPS');
            const nowMs = controller.driver.nowMs();
            controller.driver.host.bindings.externalOrigin = { type: 'credential-free-https-origin', value: origin, authorityRef: randomUUID(),
              sessionId: controller.sessionId, observedAtMs: nowMs, expiresAtMs: nowMs + 900000 };
            config.origin = origin;
            if (setupPending) { socket.end(`${JSON.stringify(publicReply(await present(controller.present()), directory))}\n`); return; }
          }
          const fresh = controller.driver.acceptedProbeReceipt?.expiresAtMs > controller.driver.nowMs() && controller.driver.proofGeneration === controller.state?.generation;
          const health = initializedDone && operational && ['status', 'health'].includes(command.type) && !command.initial && (command.type === 'health' || !fresh) && controller.state?.selected && !controller.state?.stopRequested;
          output = await controller.command(health ? { type: 'health' } : command);
          if (config.approveOrigin && output.snapshot.phase === 'candidate-ready') output = await controller.approve();
        }
        socket.end(`${JSON.stringify(publicReply(await present(output), directory))}\n`);
        if (closing) server.close();
      } catch (error) { socket.end(`${JSON.stringify({ error: error.message, ...(typeof error.code === 'string' ? { code: error.code, nextAction: error.nextAction ?? null } : {}) })}\n`); }
    });
  });
  // First listen, then publish identity. A status response always names this running controller.
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath(directory), resolve); });
    await chmod(socketPath(directory), 0o600);
    await atomicWrite(join(directory, 'control.json'), identity);
  } catch (error) {
    server.close();
    // A Unix socket path is limited to about 104 bytes (macOS) or 108 (Linux); a longer one fails as EINVAL.
    if (error.code === 'EINVAL' && Buffer.byteLength(socketPath(directory)) > 103) {
      await abandon(gozarError('invalid_input', `The session folder path is too long for its control socket (${Buffer.byteLength(socketPath(directory))} bytes, limit 103): ${directory}. Use a shorter Gozar home.`));
    }
    await abandon(error);
  }
  let monitor;
  server.on('close', async () => {
    clearInterval(monitor);
    await gate?.close();
    embedding?.close();
    controller.driver.outputEvents = []; controller.driver.outputBytes = 0;
    // Keep the last controller identity for crash/status auditing. The socket closes here;
    // every status call still proves the process birth identity and authenticates its live socket.
  });
  let finalizing;
  const finalize = () => {
    if (finalizing) return finalizing;
    finalizing = controller.shutdown().then(async output => {
      if (output.snapshot.phase === 'stopped' && !output.localCleanupFailures.length &&
          Object.keys(controller.journal.value.owned).length === 0) {
        closing = true;
        await embedding?.release();
        server.close();
      }
      return output;
    }).finally(() => { finalizing = null; });
    return finalizing;
  };
  const terminate = async () => {
    if (closing) return;
    try { await finalize(); } finally { closing = true; server.close(); }
  };
  process.once('SIGTERM', terminate); process.once('SIGINT', terminate);
  try {
    // An owner-managed proxy cannot point at the new gate until its target is visible.
    if (!setupPending) await controller.command({ type: 'detect' });
    const planned = await controller.command({ type: 'recommend' });
    const selected = config.adapterId ?? planned.snapshot.recommendations[0];
    if (selected && config.consent && !setupPending) {
      await embedding?.check();
      await controller.command({ type: 'start', adapterId: selected, consent: true });
      // CLI approval is explicit and exact; never turn an unvalidated candidate into a published URL.
      if (config.approveOrigin === true) await controller.approve();
    }
  } catch (error) {
    initializationError = error;
    await atomicWrite(join(directory, 'failure.json'), failureRecord(error));
    await terminate();
    throw error;
  } finally { initializedDone = true; initializedResolve(); }
  if (operational) {
    armMonitor = () => {
      if (closing || controller.state?.stopRequested || !controller.state?.selected) return;
      const expires = controller.driver.proofExpiries.get(controller.state.generation);
      const delay = expires ? Math.max(250, Math.min(30000, expires - controller.driver.nowMs() - 1000)) : 10000;
      monitor = setTimeout(async () => {
        if (closing || controller.state?.stopRequested) return;
        try {
          if (!controller.inFlight.size) {
            const result = await controller.command({ type: 'health' });
            if (config.approveOrigin && result.snapshot.phase === 'candidate-ready') await controller.approve();
          }
        } catch (error) { controller.hostLimitations.add(error.message); }
        armMonitor();
      }, delay);
      monitor.unref();
    };
    armMonitor();
  }
  return { server, controller, gate, terminate };
}

export function publicReply(output, directory) {
  return { ...Object.fromEntries(['target','owner','operationId','proofSubject','fixtureEffects','consentChange','consentFactsDigest'].filter(key=>output[key]!==undefined).map(key=>[key,output[key]])),...(output.lifetimeMs !== undefined ? { lifetimeMs: output.lifetimeMs, expiresAtMs: output.expiresAtMs } : {}), snapshot: { ...output.snapshot, adapterId: output.state?.selected ?? output.snapshot?.adapterId }, ...(output.action ? { action: output.action } : {}), ...(output.gateTarget ? { gateTarget: output.gateTarget } : {}), ...(output.validation ? { validation: output.validation } : {}), journalPath: join(directory, 'session.json'),
    sseChecked: output.state?.requirements?.sse === true,
    ...(output.connectionProfile ? { connectionProfile: output.connectionProfile } : {}),
    ...(output.localCleanupFailures ? { localCleanupFailures: output.localCleanupFailures } : {}) };
}

export function recoveryAdapters(saved, installed) {
  return saved.map(record => {
    const { endpointLifetime: ignored, ...adapter } = record;
    const current = installed.find(item => item.id === adapter.id);
    if (adapter.planVersion === 1 && adapter.ownership === 'owned' && current?.ownership === 'owned' && current.admission?.state === 'admitted' &&
        current.endpointLifetime === 'owned-process' && isDeepStrictEqual(adapter.recipes, current.recipes) &&
        isDeepStrictEqual(adapter.bindings, current.bindings) && isDeepStrictEqual(adapter.admission, current.admission)) return { ...adapter, endpointLifetime: current.endpointLifetime };
    return adapter;
  });
}

// Recover only local handles recorded by a dead controller. Never replay a create or remote deletion.
export async function recoverStop(directory) {
  try {
    const prior = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
    if (prior.startIdentity && await processIdentity(prior.pid) === prior.startIdentity) throw gozarError('busy', 'Controller is alive; use its private stop channel');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const journal = new Journal(directory); await journal.load();
  if (!journal.value.state) throw gozarError('route_not_found', 'No recorded session to stop');
  const step = await loadCore();
  const state = journal.value.state;
  const installed = await loadCatalog(fileURLToPath(new URL('../../', import.meta.url)), { operational: true });
  const adapters = recoveryAdapters(state.adapters, installed);
  const controller = new Controller({ step, journal, adapters, requirements: state.requirements,
    targetPort: journal.value.targetPort, sessionId: state.sessionId });
  controller.state = state;
  controller.driver.recoveryOnly = true;
  controller.driver.host.features = [...new Set([...LOCAL_PLAN_FEATURES, ...(state.host?.features ?? []).filter(feature => ['probe-assertions', 'client-vantage-probe'].includes(feature))])];
  controller.driver.authorize(state.selected);
  const result = await controller.shutdown();
  return publicReply(result, directory);
}
```

## Read-only dependency packages/gozar-node/controller.mjs

```js
import { randomUUID } from 'node:crypto';
import { EffectDriver } from './driver.mjs';
import { acquireInstallIdentityLease, prepareInstallIdentities } from './host.mjs';
import { safeOrigin } from './catalog.mjs';

// Only core transitions are serialized. Slow effects do not prevent a stop from fencing publication.
export class Controller {
  constructor({ step, journal, adapters, requirements, targetPort, servicePort, sessionId = randomUUID(), origin, bindAddresses = [], firewallApproved = false, driver, onAutomaticStop }) {
    Object.assign(this, { step, journal, adapters, requirements, targetPort, servicePort, sessionId, origin });
    this.state = undefined;
    this.last = undefined;
    this.queue = Promise.resolve();
    this.inFlight = new Set();
    this.background = new Set();
    this.hostLimitations = new Set();
    this.keyLease = null;
    this.driver = driver ?? new EffectDriver({ adapters, journal, sessionId, targetPort, origin, bindAddresses, firewallApproved,
      onExit: () => { if (!this.driver.stopped) {
        // Never await finalization from an effect completion that it must drain.
        setImmediate(() => (onAutomaticStop ? onAutomaticStop() : this.shutdown()).catch(() => {}));
      } } });
  }
  async advance(command) {
    const next = this.step({ ...(this.state ? { state: this.state } : {}), command: { sessionId: this.sessionId, ...command },
      adapters: this.adapters, requirements: this.requirements, host: { ...this.driver.host, nowMs: this.driver.nowMs?.() ?? 0 } });
    if(next.snapshot.phase==='published-ready'&&command.type!=='status')await this.beforePublication?.();
    this.last=next;
    this.state = this.last.state;
    for (const generation of this.driver.proofExpiries?.keys() ?? []) {
      if (generation !== this.state.generation) this.driver.proofExpiries.delete(generation);
    }
    for (const resource of this.last.snapshot.resources ?? []) {
      if (resource.cleanup === 'removed' && this.journal.value.owned?.[resource.id]?.retired) delete this.journal.value.owned[resource.id];
    }
    await this.journal.save({ state: this.state, snapshot: this.last.snapshot, targetPort: this.servicePort ?? this.targetPort, ...(this.driver.proofGeneration === this.state.generation ? { validation: { probeReceipt: this.driver.acceptedProbeReceipt, provenance: this.driver.proofProvenance } } : { validation: null }) });
    return this.last;
  }
  apply(command) {
    const work = this.queue.then(() => this.advance(command));
    this.queue = work.catch(() => {});
    return work;
  }
  present() {
    if (!this.last) return undefined;
    return { ...this.last, ...(this.driver.proofGeneration === this.state.generation && this.driver.acceptedProbeReceipt?.expiresAtMs > this.driver.nowMs() ? { validation: { probeReceipt: this.driver.acceptedProbeReceipt, provenance: this.driver.proofProvenance } } : {}), ...(this.driver.gate ? { gateTarget: this.driver.gate.target } : {}), snapshot: { ...this.last.snapshot,
      limitations: [...this.hostLimitations, ...(this.last.snapshot.limitations ?? [])] } };
  }
  async dispatch(effect) {
    await this.beforeEffect?.(effect);
    if (effect.kind === 'http-probe' && effect.operation === 'probe') {
      const candidate = this.last.snapshot.candidate;
      if (candidate) this.driver.origin = safeOrigin(candidate);
    }
    const completion = await this.driver.execute(effect);
    if (!completion.ok && completion.result?.code === 'needs-validation') this.hostLimitations.add(completion.result.detail);
    const output = await this.apply(completion);
    await Promise.all(output.effects.map(next => this.schedule(next)));
  }
  schedule(effect) {
    if (effect.kind !== 'timer') return this.track(effect);
    const work = this.dispatch(effect); this.background.add(work);
    work.then(() => this.background.delete(work), error => { this.background.delete(work); this.hostLimitations.add(error.message); });
    return Promise.resolve();
  }
  track(effect) {
    if (this.inFlight.size >= 256) throw new Error('Core effect budget exceeded');
    const work = this.dispatch(effect);
    this.inFlight.add(work);
    work.then(() => this.inFlight.delete(work), () => this.inFlight.delete(work));
    return work;
  }
  async command(command) {
    if (['health', 'update-origin', 'owned-process-origin'].includes(command.type) && this.driver.gate) {
      const refs = this.driver.gate.rotate();
      this.driver.host.probe = { ...refs, expiresAtMs: this.driver.nowMs() + 900000, ...(this.driver.publicRelay ? { allowPublicRelay:true } : {}) };
      this.driver.cancelTimers?.();
    }
    if (command.type === 'start' && command.consent === true) {
      if (this.driver.stopped) return this.present();
      const adapter = this.adapters.find(adapter => adapter.id === command.adapterId);
      if (Object.values(adapter?.bindings ?? {}).some(binding => binding.provision)) {
        // Ask the same pure core admission decision before creating any identity.
        // Do not commit this preview state or dispatch its effects.
        const admission = this.step({
          ...(this.state ? { state: this.state } : {}),
          command: { ...command, sessionId: this.sessionId, consent: false },
          adapters: this.adapters, requirements: this.requirements,
          host: { ...this.driver.host, nowMs: this.driver.nowMs?.() ?? 0 },
        });
        if (admission.action?.kind !== 'confirm' || admission.action.adapterId !== command.adapterId ||
            !Array.isArray(admission.effects) || admission.effects.length !== 0)
          throw new Error('Identity provisioning is not admitted by core');
      }
      if (!this.keyLease) {
        const lease = await acquireInstallIdentityLease(this.driver, adapter, this.servicePort ?? this.targetPort);
        if (this.driver.stopped) { await lease?.release(); return this.present(); }
        this.keyLease = lease;
      }
      await prepareInstallIdentities(this.driver, adapter);
      if (this.driver.stopped) return this.present();
      this.driver.authorize(command.adapterId);
    }
    if (command.type === 'stop') { this.driver.stopped = true; this.driver.cancelTimers?.(); this.driver.cancelProbes?.(); }
    const output = await this.apply(command);
    await Promise.all(output.effects.map(effect => this.schedule(effect)));
    return this.present();
  }
  async approve() {
    if (this.driver.stopped || this.last?.snapshot.phase !== 'candidate-ready') return this.present();
    const { candidate, generation } = this.last.snapshot;
    return this.command({ type: 'approve-origin', origin: candidate, generation });
  }
  shutdown() {
    if (this.shuttingDown) return this.shuttingDown;
    this.shuttingDown = this.finalize().finally(() => { this.shuttingDown = null; });
    return this.shuttingDown;
  }
  async finalize() {
    await this.command({ type: 'stop' });
    await Promise.allSettled([...this.background]);
    await Promise.allSettled([...this.inFlight]);
    // Completion of a cancelled create may have introduced cleanup debt.
    await this.command({ type: 'reconcile' });
    const failures = await this.driver.closeLocal();
    if (this.last.snapshot.phase !== 'stopped') {
      for (const resource of Object.values(this.journal.value.owned)) {
        if (resource.kind !== 'process' || resource.sessionId !== this.sessionId ||
            !this.state.resources.some(item => item.id === resource.id && item.ownership === 'owned' && item.cleanup !== 'removed')) continue;
        try {
          const receipt = await this.driver.proveProcessAbsent(resource);
          this.driver.host.cleanupAbsent = { [resource.id]: receipt };
          await this.apply({ type: 'reconcile-absent', resourceId: resource.id });
          if (this.state.resources.find(item => item.id === resource.id)?.cleanup !== 'removed') throw new Error('Core did not accept the fresh resource absence proof');
        } catch (error) {
          this.hostLimitations.add(error.message);
          failures.push({ resourceId: resource.id, detail: error.message });
        } finally { delete this.driver.host.cleanupAbsent; }
      }
    }
    if (this.keyLease && this.last?.snapshot.phase === 'stopped' && !failures.length &&
        Object.keys(this.journal.value.owned).length === 0) {
      try { await this.keyLease.release(); this.keyLease = null; }
      catch (error) { failures.push({ resourceId:'installation-key-lease', detail:error.message }); }
    }
    return { ...this.present(), localCleanupFailures: failures };
  }
}
```

## Read-only dependency packages/gozar-node/controller-start.mjs

```js
import { processIdentity } from './process-identity.mjs';

// A detached controller outlives the process that started it. If the start fails for any reason, the
// starter must stop that controller itself, and must prove it is gone. Two rules decide everything here:
//   - A null identity means "no such process" only when the identity function can read this process's
//     start time. It is never taken as proof that a live child has exited.
//   - A signal goes out only to a process that is proven to be the one we started: its recorded identity
//     still matches, or (when no identity could be recorded) our own ChildProcess handle has not seen it
//     exit, which means the kernel has not reaped it and its PID cannot belong to anyone else.

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const handleAlive = child => Boolean(child) && child.exitCode === null && child.signalCode === null;

/** Record the identity of a controller that was just spawned. Call this right after the 'spawn' event. */
export async function recordController(child, { identity = processIdentity } = {}) {
  return { pid: child.pid, startIdentity: await identity(child.pid), child };
}

/**
 * Whose process is `record.pid` now? 'ours' (running), 'gone' (exit proven) or 'foreign' (the PID was reused).
 * Throws when it cannot tell: no identity was recorded and there is no child handle, or the identity cannot be read.
 */
export async function observeController(record, { identity = processIdentity } = {}) {
  if (record.child && !handleAlive(record.child)) return 'gone';
  if (record.startIdentity) {
    let current;
    try { current = await identity(record.pid); }
    catch (error) {
      // Our own handle still has not seen the exit, so the kernel has not reaped it: the PID is still ours.
      if (handleAlive(record.child)) return 'ours';
      throw error;
    }
    if (current === null) return 'gone';
    return current === record.startIdentity ? 'ours' : 'foreign';
  }
  if (record.child) return 'ours';
  throw new Error('Cannot tell whether the controller is running: no identity was recorded for it');
}

/** True while the recorded controller is running. False only when its exit is proven. Throws when it cannot tell. */
export async function controllerAlive(record, options) {
  return await observeController(record, options) === 'ours';
}

/**
 * Stop a detached controller and its process group: SIGTERM, then SIGKILL after graceMs.
 * Resolves with the outcome, and never throws for an ordinary failure:
 *   'gone'        the controller was already gone, proven by the identity function or the child handle
 *   'stopped'     it exited after SIGTERM
 *   'killed'      it needed SIGKILL
 *   'foreign'     the PID now belongs to another process; nothing was signalled
 *   'unconfirmed' it could not be proven gone; the caller must say so
 */
export async function stopController(record, { identity = processIdentity, kill = process.kill.bind(process), graceMs = 5000, killWaitMs = 5000, pollMs = 25 } = {}) {
  const observe = () => observeController(record, { identity });
  const send = signal => {
    // The controller is detached, so it leads its own process group: -pid reaches its descendants too.
    // macOS answers EPERM, not ESRCH, when every member of the group is already exiting. Then signal the leader
    // itself; whether it is gone is decided by observing its identity, never by the signal's result.
    try { kill(-record.pid, signal); }
    catch (error) {
      if (error.code === 'ESRCH') return;
      if (error.code !== 'EPERM') throw error;
      try { kill(record.pid, signal); } catch (inner) { if (!['ESRCH', 'EPERM'].includes(inner.code)) throw inner; }
    }
  };
  const waitGone = async ms => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await observe() !== 'ours') return true;
      if (Date.now() >= deadline) return false;
      await sleep(pollMs);
    }
  };
  try {
    const first = await observe();
    if (first !== 'ours') return { state: first, pid: record.pid }; // 'gone' or 'foreign': nothing to signal
    send('SIGTERM');
    if (await waitGone(graceMs)) return { state: 'stopped', pid: record.pid };
    // Prove identity again immediately before the stronger signal; the PID may have been reused while we waited.
    if (await observe() !== 'ours') return { state: 'stopped', pid: record.pid };
    send('SIGKILL');
    if (await waitGone(killWaitMs)) return { state: 'killed', pid: record.pid };
    return { state: 'unconfirmed', pid: record.pid };
  } catch (error) {
    return { state: 'unconfirmed', pid: record.pid, error };
  }
}

/** Reports the original error after cleanup. An unproven cleanup is stated in the message; the cause stays the original. */
export function withCleanupOutcome(error, outcome) {
  if (outcome.state === 'unconfirmed') {
    const wrapped = new Error(`${error.message.replace(/[.\s]*$/, '.')} The controller (pid ${outcome.pid}) could not be confirmed stopped; inspect it and stop it by hand.`, { cause: error });
    for (const key of ['code', 'provider', 'nextAction']) if (error[key] !== undefined) wrapped[key] = error[key];
    wrapped.controllerCleanup = outcome;
    return wrapped;
  }
  try { error.controllerCleanup = outcome; } catch {}
  return error;
}
```

## Read-only dependency packages/gozar-node/registry-identity.mjs

```js
// Identity is content, never a package installation path. The child verifies it again.
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalConsentValue } from './consent-facts.mjs';
const defaultRoot = fileURLToPath(new URL('../../adapters/', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function registryIdentity({ manifest, root, adapters } = {}) {
  if (adapters) return `registry-v1:${digest(JSON.stringify(canonicalConsentValue(adapters.map(a => a.definition))))}`;
  const manifestPath = typeof manifest === 'string' ? resolve(manifest) : join(defaultRoot, 'manifest.json');
  const data = typeof manifest === 'object' ? manifest : JSON.parse(await readFile(manifestPath, 'utf8'));
  const base = resolve(root ?? dirname(manifestPath));
  const files = [];
  async function walk(directory, relative = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(directory, entry.name), name);
      else if (entry.isFile() && /\.mjs$/.test(name)) files.push([`providers/${name}`, digest(await readFile(join(directory, entry.name)))]);
      else if (entry.isSymbolicLink()) throw Object.assign(new Error('Registry identity requires regular provider files'), {code:'artifact_integrity_failed'});
    }
  }
  await walk(join(base, 'providers'));
  for (const entry of data.providers) {
    const definitionPath = resolve(base, entry.definition);
    const definition = JSON.parse(await readFile(definitionPath, 'utf8'));
    files.push([entry.definition,digest(await readFile(definitionPath))]);
    if (definition.wraps) files.push([`wrapped:${entry.id}`, digest(await readFile(resolve(dirname(definitionPath), definition.wraps)))]);
  }
  return `registry-v1:${digest(JSON.stringify(canonicalConsentValue({ manifest: data, files })))}`;
}
```

## Read-only dependency packages/gozar-node/attached-route.mjs

```js
// Attached routes: one provider runtime held by a Gozar controller process, for as long as the process that
// asked for it holds the lease.
//
//   owner (the calling process)  --heartbeat every 5 s, unref'd timer-->  controller (detached child)
//                                                                          holds adapter.create's runtime
// The controller removes the route 20 s after the last heartbeat, or at once on closeRoute. A crashed owner
// therefore costs at most the expiry. A foreground CLI owner can run the controller in its own process and
// hold the lease on stdin instead (runAttachedController with lease 'stdin'): EOF removes the route at once.
// openSessionRoute is the same redemption over the existing session machinery.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFile, chmod, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { atomicWrite, processIdentity } from './journal.mjs';
import { canonicalHome, trustedDirectory, privateDirectory, withExclusiveLock } from './service-state.mjs';
import { gozarError, instructionAction, normalizeError } from './error-normalizer.mjs';
import { cliCommand } from './cli-command.mjs';
import { createGate } from './gate.mjs';
import { projectAttached, projectSession, releasedView, recoveryHistory, checkRef } from './route-view.mjs';
import { validateQuery, adapterRequest, readContextFor, loadRuntime, consentDisclosureRevision,inspectAdapter } from './route-catalog.mjs';
import { supportedPlatform } from './platform.mjs';
import { bindConfiguration } from './adapter-configuration.mjs';
import { recordController, controllerAlive, stopController, withCleanupOutcome } from './controller-start.mjs';
import { routeConsentReview,consentSnapshot } from './consent-facts.mjs';
import { completeProperties, checksFor } from './route-view.mjs';
import { registryIdentity } from './registry-identity.mjs';
import { startEmbeddingBroker, connectEmbeddingBroker } from './embedding-broker.mjs';
import {testingFetch} from './testing-network.mjs';
import {catalogFactsFor} from './catalog-facts.mjs';
import {currentRouteReview} from './route-consent.mjs';
import {capabilityPrerequisites} from './embedding-prerequisites.mjs';
import {releaseRecordedConfigurationUse} from './runtime-configuration-use.mjs';

export const HEARTBEAT_MS = 5_000;
// Shared by initial verification and custom proof refresh; a previous or future
// observation cannot establish readiness for the current verification attempt.
export function proofObservedDuring(checked, started, ended) {
  const observed = Date.parse(checked?.checkedAt);
  return Number.isFinite(observed) && observed >= started && observed <= ended;
}
export const LEASE_EXPIRY_MS = 20_000;
const idPattern = /^att_[0-9a-f]{16}$/;
const here = fileURLToPath(import.meta.url);

// --- Redemption, shared by attached and session usage -------------------------------------------

function checkExpose(request, kind) {
  validateQuery({ ...request, usage: request?.usage });
  if (request.usage.kind !== kind) throw gozarError('invalid_input', `This call opens ${kind} usage only`);
  if (typeof request.approval?.candidateToken !== 'string' || !request.approval.candidateToken || typeof request.approval.disclosureRevision !== 'string' ||
      !request.approval.disclosureRevision) throw gozarError('consent_required', 'Approval is required: pass the candidate token and the disclosure revision the user saw');
  if (!['allocated', 'verified'].includes(request.wait)) throw gozarError('invalid_input', "wait must be 'allocated' or 'verified'");
}

// Static availability is an execution boundary, not an approval. Never redeem or
// inspect provider state to reject a named detect-only choice.
export async function preflightExpose(request, deps = {}) {
  validateQuery(request);
  if (!['attached', 'session'].includes(request.usage.kind) ||
      !['allocated', 'verified'].includes(request.wait))
    throw gozarError('invalid_input', 'expose needs attached/session usage and allocated/verified wait');
  if (request.providerId !== undefined) {
    const adapter = (await adaptersOf(deps)).find(item => item.id === request.providerId);
    const availability = adapter?.definition.availability?.[request.usage.kind]?.state;
    if (adapter && (!adapter.definition.supportedKinds.includes(request.usage.kind) ||
        availability === 'detect-only' || availability === 'unsupported'))
      throw gozarError('unsupported', 'This usage is not admitted for execution in this release');
  }
  checkExpose(request, request.usage.kind);
}

async function adaptersOf(deps) {
  if (deps.adapters) return deps.adapters;
  const runtime = await loadRuntime();
  if (!runtime) throw gozarError('internal_error', 'The adapter registry is not available in this build');
  return runtime.loadAdapters();
}

/**
 * Spends the approval's token (single use, whatever the outcome) and re-observes. A token whose plan digest or
 * observed resource moved fails with candidate_stale and changes nothing.
 */
export async function redeemApproval(request, deps) {
  const home = await canonicalHome(request.home, true);
  const tokens = deps.redeem && deps.consentBinding ? null : await import('./consent-token.mjs');
  const { approval, wait, ...query } = request;
  const binding = (deps.consentBinding ?? tokens.consentBinding)(query, home, approval.disclosureRevision,approval.consentFactsDigest);
  const grant = await (deps.redeem ?? tokens.redeemConsentToken)({ home, token: approval.candidateToken, binding, providerId: query.providerId });
  const adapter = (await adaptersOf(deps)).find(item => item.id === grant.adapterId);
  if (!adapter) throw gozarError('candidate_stale', 'The approved route is no longer available; ask the catalog again');
  if (approval.disclosureRevision !== consentDisclosureRevision(adapter.definition, query.intent)) throw gozarError('candidate_stale', 'Consent-relevant facts changed after approval; ask the catalog again');
  if (!adapter.definition.supportedKinds.includes(request.usage.kind)) throw gozarError('unsupported', 'This route does not support that usage');
  if(adapter.definition.availability?.[request.usage.kind]?.state==='detect-only'||adapter.definition.availability?.[request.usage.kind]?.state==='unsupported')throw gozarError('unsupported','This usage is not admitted for execution in this release');
  const denied=capabilityPrerequisites(adapter.definition,deps.hostCapabilities??{}).find(p=>p.state!=='present');
  if(denied)throw gozarError(denied.state==='denied'?'host_policy_denied':'unsupported','The host has not authorized a required capability');
  const context = bindConfiguration({...await readContextFor(deps, home, deps.platform ?? process.platform,query.owner),origin:query.origin??null}, adapter.id);
  let consentReview;
  if(deps.embeddingServices){
    const configuration=await deps.embeddingServices.readConfiguration({home,owner:query.owner,providerId:adapter.id});
    const detected=await adapter.detect(context);
    const declared=completeProperties(adapter.properties(detected.facts),adapter.definition,query.usage.kind);
    const properties={...declared,proof:{...declared.proof,checks:checksFor(declared.proof.checks,{sse:query.requirements.protocols.includes('sse')})}};
    consentReview=routeConsentReview({registryId:deps.registryId,providerId:adapter.id,usage:query.usage,configuration,target:query.target,origin:query.origin,properties,
      disclosure:{...adapter.definition.disclosure,revision:approval.disclosureRevision},facts:catalogFactsFor({adapter,facts:detected.facts})});
    if(approval.kind!=='route'||approval.consentFactsDigest!==consentReview.consentFactsDigest||grant.consentFactsDigest!==consentReview.consentFactsDigest)throw gozarError('consent_mismatch','Route consent changed; review the current candidate again');
  }
  const adapterAsk = adapterRequest(query);
  const plan = await adapter.plan(context, adapterAsk);
  const observed = await adapter.observe(context, adapterAsk);
  if (plan.digest !== grant.planDigest || observed.resourceKey !== grant.observedResource)
    throw gozarError('candidate_stale', 'The provider changed after the user approved; nothing was changed, ask the catalog again');
  return { home, adapter, grant, plan, request: adapterAsk, context, consentReview };
}

// --- The control channel (owner <-> controller): one JSON line each way, authenticated by a private nonce ---

export function controlAttached(directory, command, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let output = '', settled = false, socket;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(deadline); socket?.destroy(); error ? reject(error) : resolve(value); };
    const deadline = setTimeout(() => finish(gozarError('provider_unavailable', 'The route controller did not answer in time')), timeoutMs);
    readFile(join(directory, 'control.json'), 'utf8').then(async text => {
      const identity = JSON.parse(text);
      if (!identity.startIdentity || await processIdentity(identity.pid) !== identity.startIdentity) throw Object.assign(new Error('The route controller is not running'), { gone: true });
      socket = net.createConnection(join(directory, 'control.sock'));
      socket.once('connect', () => socket.write(`${JSON.stringify({ nonce: identity.nonce, command })}\n`));
      socket.on('data', chunk => {
        output += chunk;
        if (output.length > 1_048_576) return finish(gozarError('internal_error', 'The controller reply is too large'));
        if (!output.includes('\n')) return;
        try {
          const reply = JSON.parse(output.split('\n')[0]);
          reply.error ? finish(gozarError(reply.error.code, reply.error.message)) : finish(null, reply);
        } catch (error) { finish(error); }
      });
      socket.on('error', error => finish(Object.assign(error, { gone: true })));
      socket.on('end', () => finish(Object.assign(new Error('The controller closed without a reply'), { gone: true })));
    }).catch(error => finish(Object.assign(error, { gone: error.gone ?? error.code === 'ENOENT' })));
  });
}

// --- The owner's side ---------------------------------------------------------------------------

const leases = new Map();
const brokers = new Map();
function holdLease(directory, id, heartbeatMs) {
  const beat = () => controlAttached(directory, { type: 'heartbeat' }, 5_000).catch(() => {});
  // Unref'd: the lease never keeps the owner alive. When the owner exits the beats stop and the expiry ends the route.
  const timer = setInterval(beat, heartbeatMs); timer.unref();
  leases.set(id, timer); beat();
}
function dropLease(id) { clearInterval(leases.get(id)); leases.delete(id); }
async function dropBroker(id){const broker=brokers.get(id);brokers.delete(id);await broker?.close();}

async function attachedRoot(home, create = true) {
  const directory = join(home, 'attached');
  await trustedDirectory(directory, create);
  await privateDirectory(directory);
  return directory;
}
// A status or close never creates state: a missing home or directory is simply no such route.
const routeDirectory = async (home, handle) => {
  if(typeof handle==='string')handle={kind:handle.startsWith('port-')?'session':'attached',id:handle,generation:1};
  const id=handle.id;
  if (handle.kind==='session') {
    const record=await genericSessionRecord({home,handle});
    if (!record) throw gozarError('route_conflict','This session is not owned by the generic controller');
    return record.directory;
  }
  if (!idPattern.test(id)) throw gozarError('route_not_found', 'Not an attached route id');
  try { return join(await attachedRoot(await canonicalHome(home), false), id); }
  catch (error) { throw error.code === 'ENOENT' ? gozarError('route_not_found', 'No such attached route') : error; }
};
const readJson = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

async function startFailure(directory,deps,request) {
  const failure = await readJson(join(directory, 'failure.json'));
  if(failure?.nextAction?.kind==='provide-secret'&&deps?.decorateSetupAction&&deps.embeddingServices){
    const bootstrap=await readJson(join(directory,'bootstrap.json')),adapter=(await adaptersOf(deps)).find(a=>a.id===bootstrap.adapterId);
    const configuration=await deps.embeddingServices.readConfiguration({home:request.home,owner:request.owner,providerId:adapter.id});
    const inspection=await inspectAdapter(adapter,await readContextFor(deps,request.home,deps.platform??process.platform,request.owner),deps.platform??process.platform);
    const action=inspection.actions.find(a=>a.id===failure.nextAction.id&&a.digest===failure.nextAction.digest);
    if(action)failure.nextAction=deps.decorateSetupAction({action,adapter,configuration,inspection});
  }
  return failure ? gozarError(failure.code, failure.message,failure.nextAction??null) : null;
}

/** Opens one attached route and returns its RouteView. The calling process holds the lease from here on. */
export async function openAttachedRoute(request, deps = {}) {
  await preflightExpose(request, deps);
  try {
    const session = deps.sessionExecution;
    checkExpose(request, session ? 'session' : 'attached');
    if (!supportedPlatform(deps.platform ?? process.platform)) throw gozarError('unsupported', 'Gozar 0.2 does not support routes on this platform');
    const adapters = await adaptersOf(deps);
    const root = await attachedRoot(await canonicalHome(request.home, true));
    const id = session?.handle.id ?? deps.reservedHandle?.id??`att_${randomBytes(8).toString('hex')}`;
    const directory = session?.directory ?? join(root, id);
    const handle = session?.handle ?? {kind:'attached',id,generation:1};
    // Redeem, re-observe and start the controller under one reservation, so two opens cannot both win one resource.
    const controller = await withExclusiveLock(join(root, '.open.lock'), async () => {
      const redeemed = session?.redeemed ?? await redeemApproval(request, { ...deps, adapters });
      await trustedDirectory(directory, true);
      await privateDirectory(directory);
      if (session) {
        const prior=await readJson(join(directory,'bootstrap.json'));
        if(prior) {
          const state=await readJson(join(directory,'state.json')),control=await readJson(join(directory,'control.json'));
          const live=control?.startIdentity&&await processIdentity(control.pid)===control.startIdentity;
          if(prior.execution!=='generic-session-v1'||state?.handle?.id!==prior.handle?.id||state?.handle?.generation!==prior.handle?.generation||state?.lastView?.cleanup?.state!=='confirmed'||live)throw gozarError('route_conflict','A retained session already owns this directory');
          for(const name of ['state.json','failure.json','control.json'])await unlink(join(directory,name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
        }
      }
      let broker,identity;
      if(deps.embeddingServices){
        const hostIdentity=await deps.embeddingServices.resolveIdentity({home:redeemed.home});
        broker=await startEmbeddingBroker({services:deps.embeddingServices,home:redeemed.home,identity:hostIdentity,
          dispatchEffect:deps.dispatchEffect,onLoss:()=>{if(brokers.has(id))void controlAttached(directory,{type:'resolver-lost'}).catch(()=>{});}});
        const descriptor=await broker.registerController({identity:hostIdentity});
        identity={instanceId:descriptor.instanceId,bootId:descriptor.bootId};
        brokers.set(id,broker);
        try{await deps.embeddingServices.registerConfigurationUse({home:redeemed.home,owner:request.owner,providerId:redeemed.adapter.id,revision:redeemed.grant.configurationRevision,handle});}
        catch(error){await dropBroker(id);throw error;}
      }
      await atomicWrite(join(directory, 'bootstrap.json'), { schemaVersion: 1, id, home: redeemed.home, platform: deps.platform ?? process.platform, adapterId: redeemed.adapter.id, request: redeemed.request, plan: redeemed.plan,
        operationId:request.operationId??null,
        ...(session ? {execution:'generic-session-v1',handle,expiresAtMs:session.expiresAtMs} : {}),
        ...(broker?{resolver:broker.descriptor,identity,registryId:deps.registryId,owner:request.owner,consentReview:redeemed.consentReview,fixtureEffects:!!deps.dispatchEffect}:{}),
        ...(deps.registry ? { registry: deps.registry } : {}), leaseExpiryMs: deps.leaseExpiryMs ?? LEASE_EXPIRY_MS, ...(deps.controllerModule ? { controllerModule: deps.controllerModule } : {}) });
      const child = spawn(process.execPath, [here, '--controller', directory], { detached: true, stdio: 'ignore',
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' } });
      child.unref();
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      return await recordController(child);
    }, { waitSeconds: 30 });
    if (!session) holdLease(directory, id, deps.heartbeatMs ?? HEARTBEAT_MS);
    const deadline = Date.now() + (deps.startTimeoutMs ?? 120_000);
    try {
      for (;;) {
        let reply;
        try { reply = await controlAttached(directory, { type: 'status', fresh: request.wait === 'verified', generation:handle.generation, handleId:handle.id }, 30_000); }
        catch (error) {
          if (!error.gone && error.code !== 'provider_unavailable') throw error;
          const failure = await startFailure(directory,deps,request);
          if (failure) throw failure;
          if (!await controllerAlive(controller)) throw gozarError('provider_unavailable', 'The route controller exited before it started the route');
        }
        const view = reply?.view;
        if (view && reply.startupComplete!==false && ['lost', 'released', 'uncertain'].includes(view.state)) throw (await startFailure(directory,deps,request)) ?? gozarError('provider_unavailable', 'The route could not be started');
        if (view?.routeState === 'expired') throw gozarError('verification_failed', 'The route proof expired before publication');
        if (view && reply.startupComplete!==false && (request.wait === 'verified' ? view.state === 'usable' && view.verification.status === 'verified' && view.published !== null : view.state !== 'creating')) return view;
        if (Date.now() >= deadline) throw gozarError(view?.state === 'unverified' ? 'verification_failed' : 'provider_unavailable',
          view?.state === 'unverified' ? 'The route did not pass verification in time' : 'The route did not start in time');
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    } catch (error) {
      dropLease(id);
      const cleanup=await controlAttached(directory, { type: 'close', generation:handle.generation, handleId:handle.id }, 60_000).catch(() => null);
      if (cleanup?.view) error.route=cleanup.view;
      if(cleanup?.view?.cleanup.state==='unconfirmed'){
        error.route=cleanup.view;
        throw error;
      }
      const recorded=await readJson(join(directory,'state.json'));
      if (!cleanup && recorded?.handle?.id===handle.id && recorded.handle.generation===handle.generation) error.route=recorded.lastView;
      if(!cleanup&&recorded?.lastView?.cleanup.state==='unconfirmed'){
        error.route=recorded.lastView;
        throw error;
      }
      const stopped=await stopController(controller);await dropBroker(id);
      throw withCleanupOutcome(error, stopped);
    }
  } catch (error) { throw normalizeError(error); }
}

async function viewFromRecord(directory, handle) {
  const state = await readJson(join(directory, 'state.json'));
  if (!state) throw gozarError('route_not_found', `No attached route ${handle.id}`);
  if (state.handle.id !== handle.id || state.handle.kind !== handle.kind || state.handle.generation !== handle.generation) throw gozarError('route_conflict', 'The route was replaced; this handle is stale');
  return state;
}

/** Fresh proof from the controller. Without a controller the last record is all there is, and it says so. */
export async function attachedStatus(request, deps = {}) {
  const handle = checkRef(request);
  const directory = await routeDirectory(request.home, handle);
  try { return (await controlAttached(directory, { type: 'status', fresh: true, generation: handle.generation, handleId:handle.id }, 60_000)).view; }
  catch (error) {
    if (!error.gone) throw error;
    const state = await viewFromRecord(directory, handle);
    if (state.phase === 'released'||state.lastView?.cleanup.state==='confirmed') return releasedView(state.lastView, handle);
    return recoveryHistory(state.lastView, 'The route controller stopped before it removed the route');
  }
}

/** Ends the lease now: the controller removes the route and answers with the released view. */
export async function closeAttachedRoute(request, deps = {}) {
  const handle = checkRef(request);
  const directory = await routeDirectory(request.home, handle);
  dropLease(handle.id);
  try { const result=(await controlAttached(directory, { type: 'close', generation: handle.generation, handleId:handle.id }, 120_000)).view;if(result.cleanup.state==='confirmed')await dropBroker(handle.id);return result; }
  catch (error) {
    if (!error.gone) throw error;
    const state = await viewFromRecord(directory, handle);
    if (state.phase === 'released'||state.lastView?.cleanup.state==='confirmed') return releasedView(state.lastView, handle);
    // Without an owned receipt or recovery effects, retain debt without loading transient runtime.
    if (!state.receipt || !deps.effectContext) return recoveryHistory(state.lastView, 'The route controller stopped before it removed the route');
    // The controller died with the route up: remove it from the saved receipt, in this process.
    const adapters = await adaptersOf(deps);
    const adapter = adapters.find(item => item.id === state.adapterId);
    if (!adapter || !state.receipt || !deps.effectContext) return recoveryHistory(state.lastView, 'The route controller stopped before it removed the route');
    const read = bindConfiguration(await readContextFor(deps, await canonicalHome(request.home), deps.platform ?? process.platform), adapter.id);
    const observed = await adapter.observe(read, state.request);
    const removal = await adapter.remove(bindConfiguration({ ...read, generation: state.handle.generation, ...deps.effectContext({ adapter, readContext: read, request: state.request, plan: state.plan, generation: state.handle.generation }) }, adapter.id), state.receipt, observed);
    return removal.removed && !removal.debt ? releasedView(state.lastView, handle)
      : { ...releasedView(state.lastView, handle), state: 'uncertain', cleanup: { state: 'unconfirmed', message: removal.debt?.message ?? 'The route could not be removed' } };
  }
}

export async function reviewAttachedConsent(request){const handle=checkRef(request);return (await controlAttached(await routeDirectory(request.home,handle.id),{type:'review-consent',generation:handle.generation})).review;}
export async function approveAttachedConsent(request){const handle=checkRef(request);return (await controlAttached(await routeDirectory(request.home,handle.id),{type:'approve-consent',generation:handle.generation,approvalToken:request.approvalToken,consentFactsDigest:request.consentFactsDigest},60000)).view;}
export async function releaseAttachedConfiguration(request,{embeddingServices,registryId}){
  const handle=checkRef(request),directory=await routeDirectory(request.home,handle);
  const bootstrap=await readJson(join(directory,'bootstrap.json'));
  await releaseRecordedConfigurationUse({registryId:bootstrap?.registryId,home:request.home,owner:bootstrap.owner,providerId:bootstrap.adapterId,handle:{...handle,generation:1}},{embeddingServices,registryId});
}
export async function releaseSessionConfiguration(request,runtime){
  const generic=await genericSessionRecord(request);
  if(generic){await releaseRecordedConfigurationUse({registryId:generic.bootstrap.registryId,home:request.home,owner:generic.bootstrap.owner,providerId:generic.bootstrap.adapterId,handle:request.handle},runtime);await dropBroker(request.handle.id);return;}
  const handle=checkRef(request),directory=join(request.home,handle.id.split(':')[0]);
  const bootstrap=await readJson(join(directory,'bootstrap.json'));
  if(bootstrap?.embedding?.handle.id!==handle.id)return;
  await releaseRecordedConfigurationUse({registryId:bootstrap.embedding.registryId,home:request.home,owner:bootstrap.owner,providerId:bootstrap.adapterId,handle},runtime);
  await dropBroker(handle.id);
}
export async function sessionConsent(request,{approve=false,adapters}={}){
 const handle=checkRef(request);if(handle.kind!=='session')throw gozarError('unsupported','This handle is not a session');
 const generic=await genericSessionRecord(request);
 if(generic)return approve?approveAttachedConsent(request):reviewAttachedConsent(request);
 const directory=join(request.home,handle.id.split(':')[0]),bootstrap=await readJson(join(directory,'bootstrap.json'));
 if(bootstrap?.embedding?.handle.id!==handle.id)throw gozarError('route_conflict','This session handle is stale or has no current consent authority');
 const {control}=await import('./daemon.mjs');
 const result=await control(directory,{type:approve?'approve-consent':'review-consent',approvalToken:request.approvalToken,consentFactsDigest:request.consentFactsDigest},60000);
 if(!approve)return result.review;
 const adapter=adapters.find(a=>a.id===bootstrap.adapterId);return projectSession(result,{handle,properties:adapter.definition.capabilities,facts:adapter.definition.facts});
}

/** Persisted dispatch, never provider-name inference or lookup-failure fallback. */
export async function genericSessionRecord(request) {
  const handle=checkRef(request);
  if(handle.kind!=='session')return null;
  if(!/^port-[0-9]+:[A-Za-z0-9_-]+$/.test(handle.id))throw gozarError('invalid_input','Invalid session handle');
  const directory=join(await canonicalHome(request.home),handle.id.split(':')[0]);
  const bootstrap=await readJson(join(directory,'bootstrap.json'));
  if(bootstrap?.execution!=='generic-session-v1')return null;
  if(bootstrap.handle?.kind!=='session'||bootstrap.handle.id!==handle.id||bootstrap.handle.generation!==handle.generation)throw gozarError('route_conflict','This session handle is stale');
  return {directory,bootstrap};
}

// --- The controller -----------------------------------------------------------------------------

const credentialFreeOrigin = (value, properties, schemes) => {
  try { const url = new URL(value); const allowed = schemes ?? (properties?.transport === 'http' && ['lan', 'this-device'].includes(properties?.reach) ? ['http:'] : ['https:']);
    return allowed.includes(url.protocol) && !url.username && !url.password && ['', '/'].includes(url.pathname) && !url.search && !url.hash && url.hostname
      ? (url.origin === 'null' ? `${url.protocol}//${url.host}` : url.origin) : null; }
  catch { return null; }
};
// The origin the provider allocated at create is Receipt.origin (amendment 2); nothing else names a published address.
const portOf = target => Number(target.slice(target.lastIndexOf(':') + 1));
const retarget = (plan, from, to) => ({ ...plan, effects: plan.effects.map(effect => effect?.target === from ? { ...effect, target: to } : effect) });
const GATE_LIFETIME_MS = 2_147_483_647;

/**
 * Runs one attached route to its end and resolves with the last RouteView. `runtime` supplies adapters and the
 * admitted effect context; `lease` is 'heartbeat' (a detached controller) or { kind: 'stdin', stream } (a foreground CLI owner).
 */
export async function runAttachedController(directory, runtime = {}) {
  const bootstrap = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8'));
  if(bootstrap.registryId&&await registryIdentity(bootstrap.registry)!==bootstrap.registryId)throw gozarError('artifact_integrity_failed','The controller registry content changed');
  let resolverLost=false,onResolverLoss=()=>{};
  const resolver=bootstrap.resolver?await connectEmbeddingBroker({descriptor:bootstrap.resolver,identity:bootstrap.identity,onLoss:()=>{resolverLost=true;onResolverLoss();}}):null;
  if(resolver)runtime={...runtime,embeddingServices:resolver,owner:bootstrap.owner,...(bootstrap.fixtureEffects?{dispatchEffect:resolver.dispatchEffect.bind(resolver)}:{})};
  if(bootstrap.fixtureEffects)runtime.fetch=testingFetch(runtime.dispatchEffect);
  const adapters = runtime.adapters ?? await (await loadRuntime())?.loadAdapters?.(bootstrap.registry);
  const adapter = adapters?.find(item => item.id === bootstrap.adapterId);
  if (!adapter) throw gozarError('candidate_stale', 'The approved route is no longer available');
  const read = bindConfiguration(await readContextFor(runtime, bootstrap.home, bootstrap.platform), adapter.id);
  const now = runtime.now ?? Date.now;
  const expiryMs = bootstrap.leaseExpiryMs ?? LEASE_EXPIRY_MS;
  const session = bootstrap.execution==='generic-session-v1';
  const handle = session ? bootstrap.handle : { kind: 'attached', id: bootstrap.id, generation: 1 };
  if(session && (handle?.kind!=='session'||handle.id!==bootstrap.id||handle.generation!==1||!Number.isFinite(bootstrap.expiresAtMs)))throw gozarError('artifact_integrity_failed','Invalid persisted session identity or expiry');
  if(session && await readJson(join(directory,'state.json')))throw gozarError('route_conflict','This session has already attempted creation');
  const expired=()=>session&&now()>=bootstrap.expiresAtMs;
  const lease = { ...(session?{expiresAtMs:bootstrap.expiresAtMs}:{}), target: bootstrap.request.target, state: 'creating', origin: null, properties: adapter.definition.capabilities, ingress: null, identity:bootstrap.identity??null,
    limits: { recommendedPollIntervalMs: 5_000, idleTimeoutMs: null }, cleanup: { state: 'none' }, checkedAtMs: null };
  let receipt = null, lastBeat = now(), releasing = null, failure = null, gate = null, proofSession = null,initialSettled=false;
  const nonce = randomBytes(32).toString('hex');
  const lastView = () => ({...projectAttached(expired()&&lease.state==='usable'?{...lease,state:'unverified'}:lease, { handle, now: now() }),operationId:bootstrap.operationId??null,...(lease.consentChange?{consentChange:lease.consentChange}:{}),consentFactsDigest:lease.approvedReview?.consentFactsDigest??bootstrap.consentReview?.consentFactsDigest??null});
  const save = () => atomicWrite(join(directory, 'state.json'), { schemaVersion: 1, adapterId: adapter.id, request: bootstrap.request, plan: bootstrap.plan,
    receipt, handle, phase: lease.state, lastView: lastView() });

  const admitted = (runtime.effectContext ?? (await loadRuntime())?.createAttachedEffectContext)?.({ adapter, readContext: read, request: bootstrap.request, plan: bootstrap.plan, generation: 1 });
  // The effect is admitted for generation 1: a new route. Receipts carry the generation create returns.
  const context = bindConfiguration({ ...read, generation: 1, ...(admitted ?? {}) }, adapter.id);

  // Publication validation. The provider forwards to a gate this controller runs in front of the app (the same
  // gate recipe routes use). Through the public origin the gate proves the origin reaches this instance and,
  // when the route claims SSE, that a timed stream arrives unbuffered. `verifyChallenge` is that proof, so
  // adapter.verify is the one verification path. `validation: 'none'` exists only for controller test modules.
  const claimsSse = adapter.definition.capabilities?.protocols?.sse === true;
  const gateChecked = sse => async origin => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), sse ? 15_000 : 5_000);
    try { await gate.verify(origin, { sse, signal: controller.signal, fetch: runtime.fetch }); return { status: 'verified', checkedAt: new Date(now()).toISOString() }; }
    catch { return { status: 'unverified', checkedAt: new Date(now()).toISOString() }; }
    finally { clearTimeout(timer); }
  };
  const gated = runtime.validation !== 'none';
  const proofAbort = new AbortController();
  let attempt = { id: bootstrap.id, nonce: randomBytes(32).toString('hex'), deadlineMs: session?Math.min(bootstrap.expiresAtMs,now()+120000):now()+120000, signal: proofAbort.signal };
  onResolverLoss=()=>{if(lease.cleanup.state!=='confirmed'){lease.state='unverified';proofAbort.abort();void save().catch(()=>{});}};
  Object.assign(context,{signal:attempt.signal,deadlineMs:attempt.deadlineMs,attemptId:attempt.id,operationId:bootstrap.operationId??null});
  lease.approvedReview=bootstrap.consentReview??null;
  const reviewTokens=new Map();
  const safeRefresh=()=>!proofSession||typeof proofSession.refresh==='function';
  async function currentConsent(){
    if(!lease.approvedReview)return null;
    const original=lease.approvedReview.canonicalInput;
    const current=await currentRouteReview({...bootstrap.request,home:bootstrap.home,owner:bootstrap.owner,origin:original.scope.query.expectedOrigin},adapter,
      {...runtime,embeddingServices:resolver,registryId:bootstrap.registryId,platform:bootstrap.platform},
      {runtimeFacts:{properties:lease.properties,facts:[...(lease.runtimeFacts??[]),...(lease.proof?.facts??[])]}});
    lease.facts=current.facts;return current.review;
  }
  async function enforceConsent(){
    if(resolverLost){lease.state='unverified';return false;}
    const current=await currentConsent();
    if(current&&current.consentFactsDigest!==lease.approvedReview.consentFactsDigest){
      lease.state='unverified';lease.consentChange={oldDigest:lease.approvedReview.consentFactsDigest,newDigest:current.consentFactsDigest,
        nextAction:safeRefresh()?instructionAction('review-route-consent','Review changed route consent','Call reviewRouteConsent with this route handle, show the returned review and approveRouteConsent after approval.'):null,
        reason:safeRefresh()?'consent-changed':'proof-refresh-unsupported'};
      await save();return false;
    }
    if(lease.consentChange){lease.state='unverified';return false;}
    return true;
  }

  async function checkProof(sse) {
    const endpoint = lease.origin ?? receipt.origin;
    const started=now(),activeAttempt=attempt;
    const checked = proofSession ? await proofSession.verify({ origin: endpoint, receipt, attempt })
      : await adapter.verify(gated ? { ...read, verifyChallenge: gateChecked(sse) } : read, receipt);
    if (proofSession) {
      if (checked.attemptId !== attempt.id || checked.endpoint !== endpoint || attempt.signal.aborted || now() >= attempt.deadlineMs || releasing) {
        return { ...checked, status: 'unverified' };
      }
      lease.proof = checked;
      lease.facts = [...new Map([...(adapter.definition.facts ?? []), ...(lease.runtimeFacts ?? []), ...(checked.facts ?? [])].map(fact => [fact.id, fact])).values()];
    }
    const observed=Date.parse(checked.checkedAt);
    if(resolverLost||activeAttempt!==attempt||attempt.signal.aborted||releasing||now()>=attempt.deadlineMs||!proofObservedDuring(checked,started,now()))return {...checked,status:'unverified'};
    if(!proofSession)lease.proof={...checked,vantage:'this-device',checks:checked.status==='verified'?[...(endpoint.startsWith('https:')?['tls']:[]),'nonce',...(sse?['sse']:[])]:[],validUntil:new Date(observed+15000).toISOString()};
    lease.proofSubject=bootstrap.identity?{origin:endpoint,target:bootstrap.request.target,...bootstrap.identity,handleGeneration:handle.generation}:null;
    return checked;
  }

  let verification;
  function verify(){if(verification)return verification;verification=refreshProof().finally(()=>{verification=null;});return verification;}
  async function refreshProof() {
    if (expired()) { await release(); return; }
    if (!receipt || releasing || !initialSettled || failure || lease.cleanup.state==='confirmed') return;
    const facts=await adapter.runtimeFacts(read,receipt);
    Object.assign(lease,{properties:facts.properties,binding:facts.binding,runtimeFacts:facts.facts??[],facts:[...new Map([...(adapter.definition.facts??[]),...(facts.facts??[]),...(lease.proof?.facts??[])].map(f=>[f.id,f])).values()]});
    if(!await enforceConsent())return;
    if (proofSession && !proofSession.refresh) return;
    try {
      attempt={id:randomUUID(),nonce:randomBytes(32).toString('hex'),deadlineMs:session?Math.min(bootstrap.expiresAtMs,now()+120000):now()+120000,signal:proofAbort.signal};
      if(!proofSession)gate?.rotate();
      const started = now();
      const verification = proofSession
        ? await proofSession.refresh({ origin: lease.origin, receipt, attempt })
        : await checkProof(false);
      if (proofSession) {
        if (verification.attemptId !== attempt.id || verification.endpoint !== lease.origin || attempt.signal.aborted || now() >= attempt.deadlineMs || releasing) return;
        if (!proofObservedDuring(verification, started, now())) {
          // Retain the original evidence, but withdraw readiness on invalid time.
          lease.state = 'unverified';
          await save();
          return;
        }
        lease.proof = verification;
        lease.facts = [...(adapter.definition.facts ?? []), ...(verification.facts ?? [])];
      }
      if (!releasing&&await enforceConsent()) { lease.state = verification.status === 'verified' ? 'usable' : 'unverified'; lease.checkedAtMs = Date.parse(verification.checkedAt); lease.sseChecked = false; await save(); }
    } catch { if (!releasing) { lease.state = 'unverified'; await save(); } }
  }
  async function removeRoute() {
    let observed;
    try{observed=await adapter.observe(read,bootstrap.request);}catch{observed={known:false,reason:'provider-observation-unavailable'};}
    return adapter.remove(context, receipt, observed);
  }
  const debtOf = removal => ({ state: 'unconfirmed', message: removal.debt?.message ?? 'The route could not be removed' });
  const creation = (async () => {
    try {
      if(session)await save();
      if(expired())throw gozarError('verification_failed','The session lifetime has expired');
      if (!admitted) throw gozarError('unsupported', 'No admitted effect context is wired for this route');
      if(!await enforceConsent())throw gozarError('consent_mismatch','Consent changed before route creation');
      let plan = bootstrap.plan;
      if (gated && adapter.prepareProof) {
        proofSession = await adapter.prepareProof(read, bootstrap.request, attempt);
        lease.bindTarget = proofSession.target;
        plan = retarget(plan, bootstrap.request.target, proofSession.target);
      } else if (gated) {
        gate = await createGate(portOf(bootstrap.request.target), { lifetimeMs: GATE_LIFETIME_MS, onExpire: () => release().then(finish) });
        lease.bindTarget = `127.0.0.1:${gate.port}`;
        plan = retarget(plan, bootstrap.request.target, lease.bindTarget);
      }
      if(expired())throw gozarError('verification_failed','The session lifetime has expired');
      receipt = await adapter.create(context, plan);
      if(receipt?.adapterId!==adapter.id||receipt.resourceKey!==plan.resourceKey||receipt.generation!==context.generation||
        receipt.operationId!==undefined&&receipt.operationId!==(bootstrap.operationId??null))throw gozarError('provider_unavailable','The adapter returned a receipt for another allocation');
      if(expired())throw gozarError('verification_failed','The session lifetime has expired');
      const facts = await adapter.runtimeFacts(read, receipt);
      const origin = credentialFreeOrigin(receipt.origin, facts.properties, adapter.definition.originSchemes);
      if (!origin) throw gozarError('provider_unavailable', 'The provider returned no usable origin');
      Object.assign(lease, { properties: facts.properties,binding:facts.binding, ingress: facts.ingress ?? null, limits: facts.limits,runtimeFacts:facts.facts??[], facts: [...new Map([...(adapter.definition.facts ?? []), ...(facts.facts ?? [])].map(f=>[f.id,f])).values()], origin, state: 'unverified' });
      await save();
      if(!await enforceConsent())return;
      // Nothing is reported published until the validation passes; a failed check withdraws the route.
      const checked = await checkProof(claimsSse);
      if (checked.status !== 'verified') throw gozarError('verification_failed', 'The route did not pass publication validation and was withdrawn');
      if(!await enforceConsent())return;
      lease.state = 'usable'; lease.checkedAtMs = Date.parse(checked.checkedAt); lease.sseChecked = gated && claimsSse;
      await save();
    } catch (cause) {
      if(!receipt&&cause.cleanupReceipt){receipt=cause.cleanupReceipt;handle.generation=receipt.generation;}
      const error = normalizeError(cause);
      failure = { code: error.code, message: error.message,nextAction:error.nextAction??null };
      lease.state = 'lost';
      if (receipt) {
        try { const removal = await removeRoute(); if (!removal.removed || removal.debt) Object.assign(lease, { state: 'uncertain', cleanup: debtOf(removal) }); else {lease.cleanup = {state:'confirmed'};await releaseUse();} }
        catch { Object.assign(lease, { state: 'uncertain', cleanup: { state: 'unconfirmed', message: 'The route could not be withdrawn; close it again' } }); }
      } else { lease.state = 'uncertain'; lease.cleanup = {state:'unconfirmed',message:'Startup failed before an owned runtime receipt was returned'}; }
      await atomicWrite(join(directory, 'failure.json'), failure);
      await save().catch(() => {});
    }
  })().finally(()=>{initialSettled=true;});

  async function releaseUse(){if(resolver&&bootstrap.owner&&!resolverLost)await resolver.releaseConfigurationUse({owner:bootstrap.owner,providerId:adapter.id,handle});}

  function release() {
    proofAbort.abort();
    releasing ??= (async () => {
      await creation;
      if (lease.cleanup.state === 'confirmed') {lease.state='released';await save();return;}
      lease.state = 'releasing'; await save().catch(() => {});
      try {
        if(!receipt)throw gozarError('cleanup_debt','Startup outcome remains unknown; retain this recovery handle');
        const removal = await removeRoute();
        if (removal.removed && !removal.debt) { lease.state = 'released'; lease.cleanup = { state: 'confirmed' };await releaseUse(); }
        else { lease.state = 'uncertain'; lease.cleanup = debtOf(removal); }
      } catch (cause) { lease.state = 'uncertain'; lease.cleanup = { state: 'unconfirmed', message: `Removal failed (${normalizeError(cause).code})` }; }
      await save();
    })().finally(()=>{if(lease.cleanup.state==='unconfirmed')releasing=null;});
    return releasing;
  }

  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    let input = '', dispatched = false;
    socket.setTimeout(150_000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async chunk => {
      input += chunk;
      if (input.length > 65_536) return socket.destroy();
      if (dispatched || !input.includes('\n')) return;
      dispatched = true;
      const reply = value => socket.end(`${JSON.stringify(value)}\n`);
      try {
        const message = JSON.parse(input.split('\n')[0]);
        if (message.nonce !== nonce) throw gozarError('internal_error', 'Controller identity mismatch');
        const command = message.command ?? {};
        if(session&&command.handleId!==undefined&&command.handleId!==handle.id)throw gozarError('route_conflict','The session was replaced');
        if(expired()&&command.type!=='close'){await release();if(command.type==='status')return reply({view:lastView(),startupComplete:initialSettled});throw gozarError('verification_failed','The session lifetime has expired');}
        if (command.type === 'heartbeat') { if(!session)lastBeat = now(); return reply({ ok: true }); }
        if(command.type==='resolver-lost'){resolverLost=true;lease.state='unverified';proofAbort.abort();await save();return reply({ok:true});}
        if (command.generation !== undefined && command.generation !== handle.generation) throw gozarError('route_conflict', 'The route was replaced; this handle is stale');
        if (command.type === 'status') { if (command.fresh) await verify(); return reply({ view: lastView(),startupComplete:initialSettled }); }
        if(command.type==='review-consent'){
          lease.state='unverified';lease.consentChange={reason:safeRefresh()?'review-requested':'proof-refresh-unsupported',nextAction:safeRefresh()?instructionAction('review-route-consent','Review route consent','Approve the current review before publication can resume.'):null};await save();
          if(!safeRefresh())throw gozarError('proof_refresh_unsupported','This initial-only proof cannot safely refresh; stop the withdrawn route');
          const current=await currentConsent();if(!current)throw gozarError('unsupported','This route has no current consent snapshot');
          const scope={...current.canonicalInput.scope,reviewHandle:handle.id,handleGeneration:handle.generation};
          const {consentReview}=await import('./consent-facts.mjs');
          const review=consentReview({...current.canonicalInput,scope,typedDisclosures:current.canonicalInput.typedDisclosures,facts:current.canonicalInput.facts});
          const token=randomBytes(32).toString('base64url'),expiresAt=new Date(now()+600000).toISOString();
          const snapshot={...consentSnapshot(review),subject:lease.proofSubject??null,approvalToken:token,expiresAt};
          reviewTokens.set(token,{snapshot,current});return reply({review:snapshot});
        }
        if(command.type==='approve-consent'){
          lease.state='unverified';await save();
          if(!safeRefresh())throw gozarError('proof_refresh_unsupported','This initial-only proof cannot safely refresh; stop the withdrawn route');
          const stored=reviewTokens.get(command.approvalToken);reviewTokens.delete(command.approvalToken);
          const current=await currentConsent();
          if(!stored||Date.parse(stored.snapshot.expiresAt)<=now()||stored.snapshot.consentFactsDigest!==command.consentFactsDigest||stored.current.consentFactsDigest!==current?.consentFactsDigest||JSON.stringify(stored.snapshot.subject)!==JSON.stringify(lease.proofSubject??null))throw gozarError('consent_mismatch','The runtime review changed; request a new review');
          lease.approvedReview=current;delete lease.consentChange;await verify();return reply({view:lastView()});
        }
        if (command.type === 'close') { await release(); reply({ view: lastView() }); if(lease.cleanup.state==='confirmed')finish();return; }
        throw gozarError('invalid_input', 'Unsupported controller command');
      } catch (error) { const normalized = normalizeError(error); reply({ error: { code: normalized.code, message: normalized.message } }); }
    });
  });
  const socketPath = join(directory, 'control.sock');
  await unlink(socketPath).catch(() => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  await atomicWrite(join(directory, 'control.json'), { pid: process.pid, startIdentity: await processIdentity(process.pid), nonce });

  let monitor;
  const stdin = !session && runtime.lease?.kind === 'stdin' ? runtime.lease.stream : null;
  if (stdin) {
    const gone = () => release().then(()=>{if(lease.cleanup.state==='confirmed')finish();});
    stdin.once('end', gone); stdin.once('close', gone); stdin.resume();
  } else {
    monitor = setInterval(() => { if (!releasing && (session?expired():now() - lastBeat > expiryMs)) {lastBeat=now();release().then(()=>{if(lease.cleanup.state==='confirmed')finish();});} }, Math.max(20, Math.min(1_000, Math.floor(expiryMs / 4))));
  }
  creation.then(() => { if (failure&&lease.cleanup.state==='confirmed') finish(); });
  await finished;
  clearInterval(monitor);
  // Let the reply to the last command leave before the socket goes away.
  await new Promise(resolve => setTimeout(resolve, 50));
  await gate?.close().catch(() => {});
  await proofSession?.close().catch(() => {});
  resolver?.close();
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  return lastView();
}

// --- Session usage ------------------------------------------------------------------------------

async function legacyStartSession({ home, directory, adapterId, port, lifetimeMs, origin, requirements,owner,operationId,sessionId,embedding }) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { loadCatalog, loadDefinition } = await import('./catalog.mjs');
  const { launch } = await import('./daemon.mjs');
  const catalog = await loadCatalog(root, { operational: true });
  const definition = await loadDefinition(root, adapterId);
  return launch(directory, { adapters: [...catalog.filter(item => item.id !== definition.id), definition],
    requirements: { clientReach: requirements.reach, httpsRequired: requirements.transport === 'https', sse: requirements.protocols.includes('sse'),
      streamableHttp: requirements.protocols.includes('streamable-http'), oauthDcr: requirements.protocols.includes('oauth-dcr') },
    targetPort: port, adapterId, lifetimeMs,owner,operationId:operationId??null,...(sessionId?{sessionId}:{}),...(embedding?{embedding}:{}),origin: origin ?? undefined, operational: definition.planVersion === 1, consent: true, approveOrigin: true },
  join(root, 'bin', 'gozar.mjs'));
}

/**
 * Session usage over the existing session machinery. The adapter comes from the redeemed grant, never from the
 * request; the legacy controller (startSession) enforces the lifetime.
 */
export async function openSessionRoute(request, deps = {}) {
  await preflightExpose(request, deps);
  try {
    checkExpose(request, 'session');
    if (!supportedPlatform(deps.platform ?? process.platform)) throw gozarError('unsupported', 'Gozar 0.2 does not support routes on this platform');
    const adapters = await adaptersOf(deps);
    const home = await canonicalHome(request.home, true);
    const port = Number(request.target.slice(request.target.lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw gozarError('invalid_input', 'target must end in :PORT');
    const redeemed = await withExclusiveLock(join(await attachedRoot(home), '.open.lock'), () => redeemApproval(request, { ...deps, adapters }), { waitSeconds: 30 });
    const directory = join(home, `port-${port}`);
    const stableHandle=deps.reservedHandle??{kind:'session',id:`port-${port}:${randomUUID()}`,generation:1};
    if (!deps.startSession && redeemed.adapter.sessionExecution !== 'recipe') {
      if (stableHandle.kind!=='session'||stableHandle.generation!==1||!new RegExp(`^port-${port}:[A-Za-z0-9_-]+$`).test(stableHandle.id)) throw gozarError('invalid_input','Invalid reserved session handle');
      const expiresAtMs=Date.now()+request.usage.lifetimeMs;
      if (!Number.isFinite(expiresAtMs)||request.usage.lifetimeMs<=0) throw gozarError('invalid_input','A session needs a finite positive lifetime');
      return await openAttachedRoute(request,{...deps,sessionExecution:{redeemed,handle:stableHandle,directory,expiresAtMs}});
    }
    let embedding;
    if(deps.embeddingServices){
      const broker=await startEmbeddingBroker({services:deps.embeddingServices,home,identity:await deps.embeddingServices.resolveIdentity({home}),dispatchEffect:deps.dispatchEffect,
        onLoss:()=>{void import('./daemon.mjs').then(module=>module.control(directory,{type:'resolver-lost'})).catch(()=>{});}});
      const descriptor=await broker.registerController();brokers.set(stableHandle.id,broker);
      try{await deps.embeddingServices.registerConfigurationUse({home,owner:request.owner,providerId:redeemed.adapter.id,revision:redeemed.grant.configurationRevision,handle:stableHandle});}
      catch(error){await dropBroker(stableHandle.id);throw error;}
      embedding={resolver:descriptor,identity:{instanceId:descriptor.instanceId,bootId:descriptor.bootId},...(deps.registry?{registry:deps.registry}:{}),registryId:deps.registryId,request:{...redeemed.request,home,owner:request.owner,...(request.intent?{intent:request.intent}:{})},consentReview:redeemed.consentReview,handle:stableHandle,fixtureEffects:!!deps.dispatchEffect};
    }
    let reply = await (deps.startSession ?? legacyStartSession)({ home, directory, adapterId: redeemed.adapter.id, port, lifetimeMs: request.usage.lifetimeMs,
      owner:request.owner,operationId:request.operationId,sessionId:stableHandle.id.split(':').slice(1).join(':'),embedding,
      origin: request.origin ?? redeemed.plan.origin ?? null, requirements: request.requirements, wait: request.wait });
    const sessionId = reply.snapshot?.sessionId;
    const handle = { kind: 'session', id: sessionId ? `port-${port}:${sessionId}` : `port-${port}`, generation: 1 };
    const project = value => projectSession(value, { handle, properties: redeemed.adapter.definition.capabilities, now: (deps.now ?? Date.now)() });
    // Like an attached route, a session returns when `wait` is met and fails, cleaned up, when it cannot be.
    try {
      const deadline = Date.now() + (deps.startTimeoutMs ?? 120_000);
      for (;;) {
        const view = project(reply);
        if (['lost', 'released', 'uncertain'].includes(view.state)) throw await sessionStartFailure(reply, { home, adapterId: redeemed.adapter.id, deps });
        if (request.wait === 'verified' ? view.state === 'usable' : view.origin !== null) return view;
        if (Date.now() >= deadline) throw gozarError(view.state === 'unverified' ? 'verification_failed' : 'provider_unavailable',
          view.state === 'unverified' ? 'The route did not pass verification in time' : 'The route did not start in time');
        await new Promise(resolve => setTimeout(resolve, deps.pollMs ?? 250));
        try { reply = await (deps.sessionStatus ?? (async () => (await import('./daemon.mjs')).control(directory, { type: 'status' }, 30_000)))(); }
        catch (cause) { throw gozarError('provider_unavailable', 'The session controller stopped before the route was ready', null, cause); }
      }
    } catch (error) { throw await failedSessionStart(directory, error, deps); }
  } catch (error) { throw normalizeError(error); }
}

/**
 * What the core says, in `snapshot.limitations`, when it stops a session before it changes anything because every port the
 * route may use is taken. The core owns the sentence; the session-ports test reads it from the real core.
 */
export const LISTENERS_TAKEN = 'All explicit listener candidates are occupied or protected';

const portList = ports => ports.length === 2 ? `${ports[0]} and ${ports[1]}` : ports.join(', ');

/**
 * The error for a session that ended before it was published. When the core stopped it because every candidate port is
 * taken, the app gets the closest frozen code and a next step that names the ports and, when Gozar knows it, the holder:
 *   route_conflict            another Gozar route or session in this home holds a candidate port: name it, say how to stop it
 *   requirements_unsatisfied  only other listeners hold the ports: nothing Gozar owns can be stopped, and a retry changes nothing
 * Anything else is a plain `provider_unavailable`: provider diagnostics stay inside Gozar.
 */
async function sessionStartFailure(reply, { home, adapterId, deps }) {
  const generic = () => gozarError('provider_unavailable', 'The route could not be started');
  if (!(reply.snapshot?.limitations ?? []).includes(LISTENERS_TAKEN)) return generic();
  let ports = [], holders = [];
  try {
    const definition = await (deps.loadDefinition ?? (async id => (await import('./catalog.mjs')).loadDefinition(fileURLToPath(new URL('../../', import.meta.url)), id)))(adapterId);
    ports = definition.bindings?.port?.candidates ?? [];
    if (ports.length) holders = await (deps.portHolders ?? (await import('./durable-route.mjs')).portHolders)({ home, providerResource: definition.providerResource ?? null, ports });
  } catch { /* the ports are an explanation, not a precondition: without them the generic error stands */ }
  if (!ports.length) return generic();
  const named = holders.map(({ port, routeId, sessionPort }) => routeId !== undefined ? `port ${port} is held by route ${routeId}` : `port ${port} is held by the session on port ${sessionPort}`);
  if (named.length) {
    const first = holders[0];
    const step = first.routeId !== undefined ? `Release route ${first.routeId} (or stop the app that owns it)` : `Stop the session on port ${first.sessionPort}`;
    const how = first.routeId !== undefined ? step : `${step} with: ${cliCommand('stop', first.sessionPort, home)}`;
    return gozarError('route_conflict', `No port is free for this route (${portList(ports)}): ${named.join('; ')}. Existing listeners were left untouched.`,
      instructionAction('free-route-port', `Free port ${first.port}`, `${how}, then start this route again.`));
  }
  return gozarError('requirements_unsatisfied', `No port is free for this route: ${portList(ports)} are all in use by other listeners. They were left untouched.`,
    instructionAction('free-route-port', `Free one of ports ${portList(ports)}`, `Stop whatever listens on port ${ports[0]} or ${ports[1] ?? ports[0]}, then start this route again.`));
}

/**
 * A session that did not reach `wait` must not keep running: stop it through the session's own path (which removes the
 * provider state), then prove the controller process is gone. The reported error stays the original one unless cleanup is unconfirmed.
 */
async function failedSessionStart(directory, error, deps) {
  let identity = null;
  try { identity = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8')); } catch {}
  let stopped = null, stopFailure = null;
  try { stopped = await (deps.stopSession ?? (async () => (await import('./daemon.mjs')).stopSession(directory)))(); } catch (cause) { stopFailure = cause; }
  const outcome = identity?.startIdentity ? await stopController({ pid: identity.pid, startIdentity: identity.startIdentity }) : { state: 'gone' };
  const unconfirmed = stopFailure || stopped?.snapshot?.phase === 'cleanup-pending' || stopped?.localCleanupFailures?.length;
  const stop = `Run: ${cliCommand('stop', Number(directory.slice(directory.lastIndexOf('-') + 1)), dirname(directory))}`;
  return withCleanupOutcome(unconfirmed ? gozarError('cleanup_debt', 'The route failed to start and its cleanup is not confirmed; stop the session again',
    instructionAction('stop-session', 'Stop the failed session', stop), error) : error, outcome);
}

// --- Detached controller entry ------------------------------------------------------------------

if (process.argv[2] === '--controller' && process.argv[1] === here) {
  const directory = process.argv[3];
  try {
    const { controllerModule } = JSON.parse(await readFile(join(directory, 'bootstrap.json'), 'utf8'));
    const runtime = controllerModule ? await (await import(pathToFileURL(controllerModule).href)).default() : {};
    await runAttachedController(directory, runtime);
    process.exit(0);
  } catch (cause) {
    const error = normalizeError(cause);
    await atomicWrite(join(directory, 'failure.json'), { code: error.code, message: error.message }).catch(() => {});
    process.exit(1);
  }
}
```

## Read-only dependency packages/gozar-node/route-operations.mjs

```js
// Durable host intent identity precedes allocation. A retained reservation is never a retry command.
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalHome,trustedDirectory,privateDirectory,readRecord,withExclusiveLock} from './service-state.mjs';
import {atomicWrite,processIdentity} from './journal.mjs';
import {canonicalDigest,peekConsentGrant} from './consent-token.mjs';
import {unknownProperties,projectSession,projectDurable,projectExternal,recoveryHistory} from './route-view.mjs';
import {enrichRoute} from './embedding-state.mjs';
import {gozarError} from './error-normalizer.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const optionalRead=async path=>{try{return await readRecord(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
async function directory(home,create){const path=join(await canonicalHome(home,create),'operations');await trustedDirectory(path,create);await privateDirectory(path);return path;}
const checkRecord=record=>{
 if(record?.schemaVersion!==1||typeof record.owner!=='string'||typeof record.operationId!=='string'||typeof record.intentDigest!=='string'||!record.view?.handle)throw gozarError('provider_unavailable','The operation recovery record is unreadable');
 return record;
};
export function startingRoute(handle,target,operationId){
 return {...enrichRoute({handle,origin:null,published:null,state:'creating',ownership:'gozar-owned',properties:unknownProperties(),ingress:null,
  verification:{status:'unverified',checkedAt:null,vantage:'none',checks:[]},limits:{recommendedPollIntervalMs:1000,idleTimeoutMs:null},cleanup:{state:'none'}},{target}),operationId};
}
function newHandle(request){
 if(request.usage.kind==='attached')return {kind:'attached',id:`att_${randomBytes(8).toString('hex')}`,generation:1};
 if(request.usage.kind==='session'){const port=request.target.split(':').at(-1);return {kind:'session',id:`port-${port}:${randomUUID()}`,generation:1};}
 return {kind:'durable',id:request.usage.routeId,generation:1};
}
export async function withRouteOperation(request,{registryId,embeddingServices,adapters,run,status}){
 if(request.operationId===undefined)return run(null);
 if(typeof request.operationId!=='string'||!request.operationId||request.operationId.length>256||typeof request.owner!=='string'||!request.owner)throw gozarError('invalid_input','A route operation needs a non-empty operationId and owner');
 const home=await canonicalHome(request.home,true),dir=await directory(home,true),path=join(dir,hash(JSON.stringify([request.owner,request.operationId]))+'.json');
 let winner=false;
 const record=await withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const prior=await optionalRead(path);if(prior)checkRecord(prior);
  const grant=await peekConsentGrant({home,token:request.approval?.candidateToken});
  const providerId=request.providerId??grant?.adapterId??prior?.intent.providerId;
  if(!providerId)throw gozarError('consent_required','The operation needs a current exact provider approval');
  const configuration=await embeddingServices.readConfiguration({home,owner:request.owner,providerId});
  const intent={registryId,providerId,configurationRevision:configuration.revision,scopeId:configuration.scopeId,usage:request.usage,
    owner:request.owner,target:request.target,origin:request.origin??null,requirements:request.requirements,route:request.route??null,intent:request.intent??'create',
    consentFactsDigest:request.approval?.consentFactsDigest??grant?.consentFactsDigest??prior?.intent.consentFactsDigest??null};
  const intentDigest=canonicalDigest(intent);
  if(prior){if(prior.intentDigest!==intentDigest)throw gozarError('operation_conflict','This operationId already names a different route intent');return prior;}
  const external=adapters?.find(a=>a.id===providerId)?.definition.ownership==='external-owned';
  const origin=request.origin??grant?.origin??(prior?.view.handle.kind==='external'?prior.view.handle.id:null);
  if(external&&!origin)throw gozarError('consent_required','An owner route needs the approved exact origin');
  const handle=external?{kind:'external',id:origin,generation:1}:newHandle(request);
  if(handle.kind==='durable'){const existing=await optionalRead(join(home,'routes',hash(handle.id)+'.json'));if(existing)handle.generation=existing.generation;}
  const value={schemaVersion:1,owner:request.owner,operationId:request.operationId,intent,intentDigest,phase:'starting',view:startingRoute(handle,request.target,request.operationId)};
  await atomicWrite(path,value);winner=true;return value;
 },{waitSeconds:30});
 // Allocation completion and Stop persist under the same reservation lock.
 const persist=async value=>withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const current=checkRecord(await readRecord(path));
  if(current.view.cleanup.state==='confirmed')return structuredClone(current.view);
  await atomicWrite(path,value);return structuredClone(value.view);
 },{waitSeconds:30});
 if(!winner){
  if(record.view.cleanup.state==='confirmed')return structuredClone(record.view);
  try{return {...await status({home,handle:record.view.handle}),operationId:request.operationId};}
  catch(error){
   if(error.code==='route_conflict'){const reference=await operationReferenceForRoute({home,handle:record.view.handle});if(reference?.owner===record.owner&&reference.operationId===record.operationId)return {...await status({home,handle:reference.handle}),operationId:request.operationId};}
   if(!['route_not_found','provider_unavailable',...(record.phase==='starting'?['route_conflict']:[])].includes(error.code))throw error;
   return {...structuredClone(record.view),state:'uncertain',routeState:'cleanup-unconfirmed',published:null,ingress:null,
    verification:{...record.view.verification,status:'unverified'},cleanup:{state:'unconfirmed',nextAction:null}};
  }
 }
 try{const view={...await run(record.view.handle),operationId:request.operationId};record.view=view;record.phase='allocated';return await persist(record);}
 catch(error){
  record.phase='recovery';let recovered=error.route;
  if(!recovered)try{recovered=await status({home,handle:record.view.handle});}catch(statusError){
   if(statusError.code==='route_conflict'){
    // Follow a committed restoration only for the exact operation and owner.
    try{
     const reference=await operationReferenceForRoute({home,handle:record.view.handle});
     if(reference?.owner===record.owner&&reference.operationId===record.operationId)
      recovered=await status({home,handle:reference.handle});
    }catch{}
   }
  }
  record.view=recovered?{...recovered,operationId:request.operationId}:{...record.view,state:'uncertain',routeState:'cleanup-unconfirmed',cleanup:{state:'unconfirmed',nextAction:null},published:null};
  error.route=await persist(record);throw error;
 }
}

export async function operationReferenceForRoute({home,handle}={}){
 if(typeof home!=='string'||!handle)return null;
 let record,owner,operationId,currentHandle=handle;
 if(handle.kind==='durable'){record=await optionalRead(join(home,'routes',hash(handle.id)+'.json'));owner=record?.owner;operationId=record?.operationId;if(record)currentHandle={...handle,generation:record.generation};}
 else if(handle.kind==='attached'){if(!/^att_[a-f0-9]{16}$/.test(handle.id))return null;record=await optionalRead(join(home,'attached',handle.id,'bootstrap.json'));owner=record?.owner;operationId=record?.operationId;}
 else if(handle.kind==='session'){const name=handle.id.split(':')[0];if(!/^port-[0-9]+$/.test(name))return null;record=await optionalRead(join(home,name,'bootstrap.json'));owner=record?.owner;operationId=record?.operationId;}
 else if(handle.kind==='external'){record=await optionalRead(join(home,'services',hash(handle.id)+'.json'));owner=record?.embedding?.request.owner;operationId=record?.embedding?.operationId;}
 return typeof owner==='string'&&typeof operationId==='string'?{owner,operationId,handle:currentHandle}:null;
}
export async function recordOperationView({home,view,reference}){
 if(!reference)return view;
 let dir;try{dir=await directory(home,false);}catch(error){if(error.code==='ENOENT')return view;throw error;}
 return withExclusiveLock(join(dir,'.reservation-lock'),async()=>{
  const path=join(dir,hash(JSON.stringify([reference.owner,reference.operationId]))+'.json'),record=await optionalRead(path);if(!record)return view;checkRecord(record);
  if(record.view.handle.kind!==view.handle.kind||record.view.handle.id!==view.handle.id)return view;
  record.view={...view,operationId:record.operationId};record.phase=view.cleanup.state==='confirmed'?'terminal':'recovery';await atomicWrite(path,record);return record.view;
 },{waitSeconds:30});
}

/** Missing route files are not absence evidence; only exact terminal journals are. */
export async function retainedOperationView({home,handle,owner}={}){
 if(handle?.kind!=='durable')return null;
 let dir;
 try{dir=await directory(home,false);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 const matches=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  if(!entry.isFile()||!/^[a-f0-9]{64}\.json$/.test(entry.name))continue;
  const record=checkRecord(await readRecord(join(dir,entry.name)));
  if(entry.name!==hash(JSON.stringify([record.owner,record.operationId]))+'.json')
   throw gozarError('provider_unavailable','The operation recovery filename does not match its identity');
  const ref=record.view.handle;
  if(ref.kind!==handle.kind||ref.id!==handle.id||ref.generation!==handle.generation||
    (owner!==undefined&&record.owner!==owner))continue;
  matches.push(record);
 }
 if(!matches.length)return null;
 // A nonterminal sibling is not erased by a terminal snapshot of another operation.
 const debt=matches.find(record=>record.phase!=='terminal'||record.view.state!=='released'||record.view.cleanup?.state!=='confirmed');
 if(debt)return recoveryHistory(structuredClone(debt.view),'Retained operation has no confirmed provider absence; retry cleanup with the original provider available.');
 return structuredClone(matches[0].view);
}

/** Read persisted snapshots only. Listing never mints consent or refreshes a provider proof. */
export async function listRecordedRoutes({home,owner}={},deps={}){
 if(owner!==undefined&&(typeof owner!=='string'||!owner))throw gozarError('invalid_input','owner must be a non-empty string');
 home=await canonicalHome(home,false);const routes=new Map();
 const routeKey=handle=>JSON.stringify([handle.kind,handle.id]);
 const put=view=>{
  const key=routeKey(view.handle),previous=routes.get(key);
  // Enumeration order is not lifecycle order. A stale active snapshot cannot
  // undo exact terminal evidence, and an older generation cannot hide a newer one.
  if(previous){
   if(previous.handle.generation>view.handle.generation)return;
   if(previous.handle.generation===view.handle.generation&&previous.state==='released'&&previous.cleanup?.state==='confirmed')return;
  }
  routes.set(key,{...view,operationId:view.operationId??null});
 };
 const names=async dir=>{try{await trustedDirectory(dir,false);return await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 for(const entry of await names(join(home,'operations'))){if(!entry.isFile()||!/[a-f0-9]{64}\.json$/.test(entry.name))continue;const record=checkRecord(await readRecord(join(home,'operations',entry.name)));if(owner===undefined||record.owner===owner)put(record.view);}
 for(const entry of await names(join(home,'attached'))){if(!entry.isDirectory()||!/^att_[a-f0-9]{16}$/.test(entry.name))continue;const root=join(home,'attached',entry.name),bootstrap=await readRecord(join(root,'bootstrap.json'));if(owner!==undefined&&bootstrap.owner!==owner)continue;const record=await optionalRead(join(root,'state.json'));if(!record)continue;if(!record.lastView?.handle)throw gozarError('provider_unavailable','The attached recovery snapshot is unreadable');let view=record.lastView;
  const controller=await optionalRead(join(root,'control.json'));
  if(view.state!=='released'&&(!controller||await processIdentity(controller.pid)!==controller.startIdentity))view={...view,state:'uncertain',published:null,routeState:'cleanup-unconfirmed',verification:{...view.verification,status:'unverified'},cleanup:{state:'unconfirmed',nextAction:null}};
  put({...view,operationId:bootstrap.operationId??routes.get(routeKey(view.handle))?.operationId??null});
 }
 for(const entry of await names(join(home,'routes'))){if(!entry.isFile()||!/[a-f0-9]{64}\.json$/.test(entry.name))continue;const record=await readRecord(join(home,'routes',entry.name));if(record?.schemaVersion!==1||typeof record.routeId!=='string'||!record.routeId||record.ownership!=='gozar-owned'||typeof record.owner!=='string'||!record.owner||!Number.isSafeInteger(record.generation)||record.generation<1||entry.name!==hash(record.routeId)+'.json')throw gozarError('provider_unavailable','The durable route record is unreadable');if(owner!==undefined&&record.owner!==owner)continue;const handle={kind:'durable',id:record.routeId,generation:record.generation};const previous=routes.get(routeKey(handle));put({...projectDurable(record,{handle,properties:unknownProperties()}),operationId:record.operationId??previous?.operationId??null});}
 for(const entry of await names(home)){if(!entry.isDirectory()||!/^port-[0-9]+$/.test(entry.name))continue;const bootstrap=await optionalRead(join(home,entry.name,'bootstrap.json'));if(!bootstrap||(owner!==undefined&&bootstrap.owner!==owner))continue;const journal=await optionalRead(join(home,entry.name,'session.json'));if(!journal?.snapshot)continue;const handle={kind:'session',id:`${entry.name}:${journal.snapshot.sessionId}`,generation:1};put({...projectSession(journal.embeddingView??{snapshot:journal.snapshot},{handle,properties:unknownProperties()}),operationId:bootstrap.operationId??routes.get(routeKey(handle))?.operationId??null});}
 for(const entry of await names(join(home,'services'))){if(!entry.isFile()||!/[a-f0-9]{64}\.json$/.test(entry.name))continue;const record=await readRecord(join(home,'services',entry.name));if(record.ownership!=='external-owned'||typeof record.origin!=='string')throw gozarError('provider_unavailable','The owner-route recovery record is unreadable');if(owner!==undefined&&record.embedding?.request.owner!==owner)continue;put(projectExternal(record,{handle:{kind:'external',id:record.origin,generation:record.generation??0}}));}
 // A disk snapshot is recovery evidence. Only routeStatus can obtain a fresh subject-bound proof.
 return {routes:[...routes.values()].map(view=>view.state==='released'?view:{...view,state:view.state==='usable'?'unverified':view.state,published:null,
  routeState:view.cleanup.state==='unconfirmed'?'cleanup-unconfirmed':view.origin?'detected':'unknown',verification:{...view.verification,status:'unverified',results:(view.verification.results??[]).map(result=>({...result,status:'unknown'}))}})};
}
```

## Read-only dependency packages/gozar-node/adapter-contract.d.ts

```js
// Gozar adapter boundary, version 1 (frozen in C0; amendment 1 adds context fields; amendment 2 adds Receipt.origin).
//
// One adapter is one directory plus one `{id, module, definition}` entry in adapters/manifest.json
// `providers`. Types only: no runtime behaviour is declared here. Opaque effect, readback and
// identity bodies stay provider-specific; core validates the envelope and the admission.
import type { Action, Fact, Availability, Properties, RouteView, Ingress, Usage, Requirements, Disclosure,InputRequirement,HostCapabilityId } from './route-contract.js';

export type AdapterState = 'ready' | 'action-required' | 'unsupported' | 'unknown';

/**
 * Every method is required. Unsupported setup/create/kinds return a typed `unsupported`, never fabricated success.
 * `create` and `remove` reject with an AdapterEffectError when they cannot apply the effect. A
 * `precondition_failed` rejection means nothing was changed: the core re-observes and re-plans (the
 * ownership decision stays in the core, never inside the adapter or `executePlan`).
 */
export interface Adapter {
  id: string;
  definition: AdapterDefinition;
  detect(ctx: ReadContext): Promise<{ state: AdapterState; facts: unknown }>;
  properties(facts: unknown): Properties;
  setupActions(facts: unknown): Action[];
  configurationActions?(): Action[];
  /** Prepares this attempt's protocol-specific challenge before provider creation. */
  prepareProof?(ctx: ReadContext, request: AdapterRequest, attempt: ProofAttempt): Promise<AdapterProofSession>;
  setup(ctx: SetupContext, actionId: string, secretHandle?: string): Promise<SetupResult>;
  plan(ctx: ReadContext, request: AdapterRequest): Promise<AdapterPlan>;
  create(ctx: AdmittedEffectContext, plan: AdapterPlan): Promise<Receipt>;
  observe(ctx: ReadContext, request: AdapterRequest): Promise<Observation>;
  verify(ctx: ReadContext, receipt: Receipt): Promise<Verification>;
  remove(ctx: AdmittedEffectContext, receipt: Receipt, observed: Observation): Promise<Removal>;
  runtimeFacts(ctx: ReadContext, receipt: Receipt): Promise<{ properties: Properties; ingress: Ingress | null; limits: RouteView['limits'];facts?:Fact[];binding?:RouteView['binding'] }>;
}

export type AdapterDefinition = {
  schemaVersion: 1;
  id: string;
  label: string;
  capabilities: Properties;
  facts?: Fact[];
  availability?: Availability;
  prerequisites?: {id: string; label: string; observation: string; actionId?: string}[];
  supportedKinds: ('session' | 'attached' | 'durable')[];
  disclosure: Disclosure;
  /** URL schemes accepted from this adapter, including the colon; default derives from transport. */
  originSchemes?: string[];
  needs?:string;
  ownership?:'gozar-owned'|'external-owned';
  inputRequirements?:InputRequirement[];
  requiredCapabilities?:HostCapabilityId[];
  effectOperations?:{kind:string;operation:string}[];
  byUsage?:Partial<Record<Usage['kind'],{needs?:string;ports?:number[]|null}>>;
};

/** The adapter binds verification to the fresh challenge and this attempt's endpoint. */
export type AdapterProofSession = {
  target: string;
  verify(input: {origin: string; receipt: Receipt; attempt: ProofAttempt}): Promise<{
    attemptId: string; endpoint: string;
    status: 'verified' | 'unverified'; checkedAt: string | null; validUntil?: string;
    vantage: RouteView['verification']['vantage']; checks: RouteView['verification']['checks']; facts?: Fact[];
  }>;
  close(): Promise<void>;
  /** Optional safe reproof. Without it status retains the original proof and its expiry. */
  refresh?: AdapterProofSession['verify'];
};
export type ProofAttempt = { id: string; nonce: string; deadlineMs: number; signal: AbortSignal };

export type AdapterRequest = {
  target: string;
  origin: string | null;
  usage: Usage;
  requirements: Requirements;
  configurationRef: string | null;
};

/**
 * `precondition` is required. null means the effect is unconditional. When non-null, `executePlan` and
 * `compareAndRemove` apply the effect only if the provider's current revision still equals
 * `precondition.revision` (null meaning the provider has no revision to compare); otherwise they reject with
 * AdapterEffectError `precondition_failed` and change nothing.
 */
export type AdapterPlan = {
  digest: string; origin: string | null; resourceKey: string; effects: unknown[]; readback: unknown; cleanup: unknown;
  precondition: { revision: string | null } | null;
};

/**
 * What an adapter operation (create, remove, executePlan, compareAndRemove) rejects with. Internal: apps never
 * see `precondition_failed`. The core retries the read-decide-write loop; when retries run out it surfaces
 * `provider_unavailable`. The other three codes are in the frozen consumer union and map to themselves.
 */
export type AdapterEffectError = {
  code: 'precondition_failed' | 'unsupported' | 'provider_unavailable' | 'setup_required';
  message: string;
};

/**
 * No raw secrets in facts, plans or receipts. `origin` (amendment 2) is the address the provider allocated at
 * create, or null when it allocated none; the core reads the published origin from it, never from provider-specific bodies.
 */
export type Receipt = { schemaVersion: 1; adapterId: string; resourceKey: string; generation: number; operationId?: string | null; identity: unknown; readback: unknown; origin: string | null };

/** `revision` is the provider's config revision (for example an ETag), or null when the provider has none. */
export type Observation = { present: boolean; resourceKey: string; identity: unknown; revision: string | null };

export type Verification = RouteView['verification'];

export type Removal = { removed: boolean; debt: null | { code: string; message: string } };

export type SetupResult = { state: 'complete' | 'pending' | 'blocked'; nextAction: Action | null };

/** Injected clock, read-only provider probe, challenge verifier and private configuration lookup. */
export type ReadContext = {
  /** Present only in the explicit public testing harness; operations must be declared in adapter data. */
  dispatchEffect?:(request:{kind:string;operation:string;input:unknown})=>Promise<unknown>;
  now: () => number;
  /** Canonical Gozar state home of the calling app (amendment 1: the durable plan needs it). */
  home: string;
  /** Host platform as reported by the core; adapters never read process.platform themselves (amendment 1). */
  platform: string;
  /**
   * Private configuration lookup, scoped to this adapter. It is the only path by which a secret
   * (for example a provider auth token) reaches an adapter. With ref null it returns the values the user
   * supplied through this adapter's completed `provide-secret` setup actions, keyed by action id, or null.
   * Every context may read them, because `plan` needs configured values such as a reserved address.
   * The secret must never be placed in facts, plans, receipts, errors or output, in any context.
   */
  configuration: (ref: string | null) => Promise<unknown>;
  /** Runs a read-only recipe through the engine; `ok` is the recipe parser's verdict (amendment 1). */
  probe: (recipe: unknown) => Promise<{ ok: boolean; detail?: unknown }>;
  verifyChallenge: (origin: string, target: string) => Promise<Verification>;
};

/** Adds only approved-action execution and private secret lookup. */
export type SetupContext = ReadContext & {
  executeApprovedAction: (id: string) => Promise<SetupResult>;
  withSecret: <T>(handle: string, use: (secret: Uint8Array) => Promise<T>) => Promise<T>;
};

/**
 * Adds only plan-engine-admitted create and conditional-remove operations plus generation checking.
 * Both honor `plan.precondition` / the observed revision and reject with AdapterEffectError
 * (`precondition_failed` when the provider revision moved; nothing is changed). Neither contains ownership logic.
 */
export type AdmittedEffectContext = ReadContext & {
  signal?:AbortSignal;deadlineMs?:number;attemptId?:string;operationId?:string|null;
  /** Route generation the effect is admitted for; receipts carry it (amendment 1). */
  generation: number;
  assertGeneration: () => Promise<void>;
  executePlan: (plan: AdapterPlan) => Promise<Receipt>;
  compareAndRemove: (receipt: Receipt, observed: Observation) => Promise<Removal>;
};

/** One entry of adapters/manifest.json `providers`. */
export type ManifestProvider = { id: string; module: string; definition: string };
```

## Read-only dependency packages/gozar-node/testing-contract.d.ts

```js
import type {GozarOptions,createGozar} from './route-contract.js';
export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export interface TestingEffectContext {signal:AbortSignal;fixture:true}
export interface TestingEffect {kind:string;operation:string;handle(input:JsonValue,context:TestingEffectContext):Promise<JsonValue>}
/** Exact initial SDK effect operations. Handler input may include synthetic credentials; trace never does. */
export type ListenerEffectRequest =
 | {kind:'sdk-listener';operation:'detect';input:Record<string,never>}
 | {kind:'sdk-listener';operation:'open';input:{options:{addr:string;authtoken:string;domain?:string;proto?:'tcp'|'tls';remote_addr?:string}}}
 | {kind:'sdk-listener';operation:'read'|'close';input:{handle:string}};
export type ListenerEffectResult = {available:boolean}|{handle:string;url:string}|{present:false}|{present:true;url:string}|{closed:boolean}|{error:{code:string}};
export type NetworkEffectRequest =
 | {kind:'network';operation:'fetch';input:{url:string;method:string;headers:Record<string,string>}}
 | {kind:'network';operation:'exchange';input:{endpoint:string;transport:'tcp'|'tls';bytes:string;pinnedCertificate:string|null;deadlineMs:number}};
export type NetworkEffectResult =
 | {status:number;headers:Record<string,string>;chunks:{data:string;delayMs:number}[]}
 | {bytes:string;certificate?:string};
export type ProcessEffectRequest =
 | {kind:'process-runtime';operation:'detect';input:{program:string}}
 | {kind:'process-runtime';operation:'open';input:{program:string;args:string[];credential:string;origin:string;target:string;deadlineMs:number}}
 | {kind:'process-runtime';operation:'read'|'close';input:{handle:string}};
export type ProcessEffectResult={available:boolean}|{handle:string}|{present:boolean}|{closed:boolean};
export type LocalApiEffectRequest={kind:'local-api';operation:'request';input:{path:string;method:string;headers:Record<string,string>;body:JsonValue}};
export type LocalApiEffectResult={status:number;headers:Record<string,string>;body:string};
export type RecipeProbeRequest={kind:'recipe';operation:'probe';input:{recipe:JsonValue}};
export type RecipeProbeResult={stdout:string;stderr:string;exitCode:number};
/** Long-running fixtures return an actual harmless child PID; the normal owned-PID ledger still governs removal. */
export type SpawnEffectRequest=
 |{kind:'spawn';operation:'run';input:{program:string;args:string[];longRunning:boolean}}
 |{kind:'spawn';operation:'read';input:{handle:string}}
 |{kind:'spawn';operation:'close';input:{handle:string;signal:string}};
export type SpawnEffectResult={stdout:string;stderr:string;exitCode:number}|{stdout:string;stderr:string;exitCode:null;handle:string;pid:number}|{present:boolean;exitCode?:number}|{closed:boolean};
export type ArtifactEffectRequest=
 |{kind:'artifact';operation:'fetch';input:{artifact:NonNullable<import('./route-contract.js').Action['artifact']>}}
 |{kind:'artifact';operation:'execute';input:{artifact:NonNullable<import('./route-contract.js').Action['artifact']>;effects:NonNullable<import('./route-contract.js').Action['effects']>;bytes:string}};
export type ArtifactEffectResult={bytes:string}|{executed:boolean;exitCode:number};
export interface TestingHarness {gozar:ReturnType<typeof createGozar>;events:{sequence:number;kind:string;operation:string;state:'requested'|'completed'|'failed';fixture:true}[];close():Promise<void>}
export function createTestingGozar(options:GozarOptions&{effects:TestingEffect[]}):Promise<TestingHarness>;
export function fakeRegistry(options:{id:string;label?:string;kinds:import('./route-contract.js').Usage['kind'][];reach:Exclude<import('./route-contract.js').Reach,'unknown'>;transport?:import('./route-contract.js').Properties['transport'];protocols?:import('./route-contract.js').Requirements['protocols'];dir?:string;facts?:import('./route-contract.js').Fact[];setupActions?:import('./route-contract.js').Action[];proofProtocol?:'http'|'echo'}):Promise<{manifest:NonNullable<GozarOptions['manifest']>;root:string;cleanup():Promise<void>}>;
export function fakeRouteScenarios(options?:{target?:string;now?:number}):import('./route-contract.js').RouteView[];
export function fakeReadContext(options?:{home?:string;probeOk?:boolean;verified?:boolean;now?:()=>number}):import('./adapter-contract.js').ReadContext;
export function createReadContext(options?:Record<string,unknown>):import('./adapter-contract.js').ReadContext;
/** Lower-level fixture factory retained for tests that inject individual local boundaries. */
export function createRouteApi(options?:GozarOptions&Record<string,unknown>):ReturnType<typeof createGozar>;
```

## Read-only dependency packages/gozar-node/testing.mjs

```js
// Test helpers for an app that uses Gozar: a route API with no network, a fake provider, and a fake read context.
// Import them from '@tnunamak/gozar/testing'. Nothing here starts a tunnel, calls a provider or reads real credentials.
//
//   const registry = await fakeRegistry({ id: 'fake-0a1b2c3d', kinds: ['session'], reach: 'internet' });
//   const api = createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home }) });
//   ...catalogRoutes, then expose with the candidate's token...
//   await registry.cleanup();
//
// A fake with kind 'durable' also keeps a rule store, a JSON file in the registry's own directory, so that separate
// processes see the same state. Pass `fakeReadContext({ verified })` to the route API and the durable route check answers as told.
import { mkdtemp, mkdir, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouteApi as createCoreRouteApi } from './route-api.mjs';
import { createReadContext } from './adapter-runtime.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gozarError } from './error-normalizer.mjs';
import { projectSession, projectDurable, projectAttached } from './route-view.mjs';
import { enrichRoute } from './embedding-state.mjs';
import {testingFetch} from './testing-network.mjs';
import {verification} from './service-state.mjs';

export { createReadContext };

/** Explicit fixture effects for the shipped trusted adapters. No ambient switch enables this. */
export async function createTestingGozar({effects,...options}={}){
  if(!Array.isArray(effects))throw gozarError('invalid_input','Testing effects must be an explicit mapping array');
  const handlers=new Map(),events=[],active=new Map(),abort=new AbortController();let closing;
  for(const effect of effects){
    if(typeof effect?.kind!=='string'||!effect.kind||typeof effect.operation!=='string'||!effect.operation||typeof effect.handle!=='function')throw gozarError('invalid_input','A testing effect needs kind, operation and handler');
    const key=JSON.stringify([effect.kind,effect.operation]);if(handlers.has(key))throw gozarError('invalid_input','Duplicate testing effect mapping');handlers.set(key,effect.handle);
  }
  const dispatchEffect=async request=>{
    const key=JSON.stringify([request?.kind,request?.operation]),handler=handlers.get(key);
    if(abort.signal.aborted||!handler)throw gozarError('unsupported','No matching testing effect is declared');
    const event={sequence:events.length,kind:request.kind,operation:request.operation,state:'requested',fixture:true};events.push(event);
    try{const result=await handler(structuredClone(request.input),{signal:abort.signal,fixture:true});event.state='completed';return structuredClone(result);}
    catch{event.state='failed';throw gozarError('provider_unavailable','The testing effect failed');}
  };
  const {manifest,root,secretBackend,hostCapabilities,identity}=options;
  const api=createCoreRouteApi({manifest,root,secretBackend,hostCapabilities,identity,dispatchEffect,
    verify:request=>verification(request,{fetch:testingFetch(dispatchEffect)})});
  const gozar={...api};
  const mark=value=>{const copy=structuredClone(value);copy.facts??=[];copy.facts.push({id:'gozar-testing-effects',label:'Fixture evidence',value:'Synthetic provider effects and isolated local transport; real provider acceptance is unverified.',known:true,group:'proof',affectsConsent:false,source:'@tnunamak/gozar/testing',asOf:null});return copy;};
  gozar.catalogRoutes=async request=>{const result=await api.catalogRoutes(request);return {...result,candidates:result.candidates.map(mark)};};
  gozar.listProviders=async request=>{const result=await api.listProviders(request);return {...result,providers:result.providers.map(mark)};};
  const track=(home,route)=>{for(const[key,prior]of active)if(prior.home===home&&prior.handle.kind===route.handle.kind&&prior.handle.id===route.handle.id&&prior.handle.generation<=route.handle.generation)active.delete(key);if(route.cleanup.state!=='confirmed')active.set(JSON.stringify(route.handle),{home,handle:route.handle,mode:'remove'});};
  for(const method of ['expose','ensureRoute','adoptRoute'])gozar[method]=async request=>{try{const route=mark(await api[method](request));track(request.home,route);return route;}catch(error){if(error.route){error.route=mark(error.route);track(request.home,error.route);}throw error;}};
  for(const method of ['routeStatus','suspendRoute','approveRouteConsent'])gozar[method]=async request=>mark(await api[method](request));
  gozar.listRoutes=async request=>{const result=await api.listRoutes(request);return {routes:result.routes.map(mark)};};
  gozar.watchRoutes=async function*(request){for await(const event of api.watchRoutes(request))yield event.route?{...event,route:mark(event.route)}:event;};
  gozar.closeRoute=async request=>{const route=mark(await api.closeRoute(request));if(route.cleanup.state==='confirmed')active.delete(JSON.stringify(route.handle));return route;};
  return {gozar,events,close:()=>closing??=(async()=>{const errors=[];for(const request of [...active.values()])try{const route=await gozar.closeRoute(request);if(route.cleanup.state!=='confirmed'){const error=gozarError('cleanup_debt','Fixture cleanup is unconfirmed; retain the route handle and retry');error.route=route;errors.push(error);}}catch(error){errors.push(error);}if(errors.length)throw errors[0];abort.abort();})().catch(error=>{closing=null;throw error;})};
}

/** Deterministic lifecycle projections for every admitted usage kind; no provider or process is started. */
export function fakeRouteScenarios({ target = '127.0.0.1:18765', now = Date.parse('2026-11-13T12:00:00Z') } = {}) {
  const properties = { reach: 'internet', transport: 'https', traffic: { tlsTermination: 'endpoint', providerCanReadPayload: false, readers: [], metadataVisibleTo: [], evidenceRef: 'testing' },
    address: { stability: 'stable', scope: 'fixture', conditions: [], ports: null }, cost: { kind: 'free', summary: 'Fixture', currency: null, amount: null, period: null },
    needsAccount: false, lifetimes: ['session', 'attached', 'durable'], supervision: 'controller', protocols: { sse: true, streamableHttp: true, oauthDcr: true }, proof: { vantage: 'this-device', checks: ['nonce', 'tls'] } };
  const origin = 'https://screen.example.invalid', checkedAt = new Date(now).toISOString(), future = new Date(now + 60_000).toISOString();
  return ['session', 'attached', 'durable'].flatMap(kind => ['detected', 'verified', 'expired', 'cleanup-unconfirmed'].map(state => {
    const handle = { kind, id: `fixture-${kind}`, generation: 1 }, verified = state !== 'detected';
    const subject={origin,target,instanceId:'fixture-instance',bootId:'fixture-boot',handleGeneration:handle.generation};
    const expiry = state === 'expired' ? new Date(now - 1).toISOString() : future;
    const options = { handle, properties, now };
    const route = kind === 'durable' ? projectDurable({ state: verified ? 'usable' : 'unverified', origin, target, verification: { status: verified ? 'verified' : 'unverified', checkedAt, validUntil: expiry,subject }, expiresAt: expiry }, options)
      : kind === 'attached' ? projectAttached({ state: verified ? 'usable' : 'unverified', origin, target, properties, checkedAtMs: now,proofSubject:subject, expiresAt: expiry }, options)
      : projectSession({proofSubject:subject,snapshot: { phase: verified ? 'published-ready' : 'candidate-ready', candidate: origin, published: verified ? origin : null, target, expiresAt: expiry, checkedAtMs: now } }, options);
    return enrichRoute({ ...route, cleanup: { state: state === 'cleanup-unconfirmed' ? 'unconfirmed' : 'none' } }, { target, expiresAt: expiry, validUntil: expiry, now });
  }));
}

/**
 * A read context whose probe and verification answer as told. `probeOk` is the detect verdict (default true);
 * `verified` is the outcome of a route check (default true). The testing `createRouteApi` also uses `verified` for the
 * challenge check of a durable route, so a durable fake answers as told too.
 */
export function fakeReadContext({ home, probeOk = true, verified = true, now = Date.now } = {}) {
  return createReadContext({
    home, platform: 'linux', now,
    configuration: async () => null,
    probe: async () => ({ ok: probeOk }),
    verifyChallenge: async () => ({ status: verified ? 'verified' : 'unverified', checkedAt: verified ? new Date(now()).toISOString() : null }),
  });
}

// An expose of kind session starts a controller process. A fake provider has none, so the testing API starts no process
// and answers as a controller that has a candidate address ready. A test may replace it with `expose: { startSession }`.
const fakeStartSession = options => ({ snapshot: { sessionId: `fake-${options.port}`, phase: 'candidate-ready', candidate: options.origin ?? 'https://fake.example.invalid', expiresAtMs: Date.now() + (options.lifetimeMs ?? 60_000) } });

/** The route API with no process or network: sessions are answered in memory. Same options as the package's own factory. */
export function createRouteApi(deps = {}) {
  // A durable route is checked by the challenge verifier. With a read context given, that verifier is the context's.
  const verify = deps.verify ?? (deps.readContext && (async ({ origin, target }) => {
    const checked = await deps.readContext.verifyChallenge(origin, target);
    return { method: 'challenge', error: checked.status === 'verified' ? null : 'fake', scope: 'controller-origin', ...checked };
  }));
  return createCoreRouteApi({ platform: 'linux', ...deps, ...(verify ? { verify } : {}), expose: { startSession: fakeStartSession, ...deps.expose } });
}

const KINDS = ['session', 'attached', 'durable'];
const REACHES = ['internet', 'tailnet', 'lan', 'this-device'];

const moduleSource = (actions = [], proofProtocol = 'http') => `// A fake provider written by @tnunamak/gozar/testing. It does nothing outside memory.
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8')).adapter;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const servers = new Map();
const proofProtocol = ${JSON.stringify(proofProtocol)};
const mark = event => appendFileSync(new URL('./events.jsonl', import.meta.url), JSON.stringify({event}) + '\\n');
export default {
  id: definition.id,
  definition,
  async detect(ctx) { const seen = definition.supportedKinds.includes('attached') ? {ok:true} : await ctx.probe({ fake: true }); const values=await ctx.configuration(null);const missing=${JSON.stringify(actions)}.filter(action=>action.required!==false&&!values?.[action.id]);return {state:seen?.ok!==true?'unknown':missing.length?'action-required':'ready',facts:{fake:true,detected:seen?.ok===true,setupNeeded:missing.length>0,missing}}; },
  properties: () => structuredClone(definition.capabilities),
  configurationActions: () => ${JSON.stringify(actions)},
  setupActions: facts => facts?.missing ?? ${JSON.stringify(actions)},
  async setup() { mark('setup'); return { state: 'complete', nextAction: null }; },
  async plan(ctx, request) {
    const resourceKey = definition.id + ':' + sha({ target: request.target }).slice(0, 16);
    return { digest: sha({ id: definition.id, target: request.target, usage: request.usage?.kind }), origin: request.origin ?? null, resourceKey, effects: [{target: request.target}],
      readback: { kind: request.usage?.kind, origin: request.origin ?? null, target: request.target }, cleanup: { kind: 'fake' }, precondition: null };
  },
  ...(proofProtocol === 'echo' ? {
    async prepareProof(ctx, request, attempt) {
      let proving=true,witness=false,used=false;
      const [host,port]=request.target.split(':');
      const proof = net.createServer({allowHalfOpen:true}, socket => {
        if(!proving){const upstream=net.connect(Number(port),host);upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.pipe(upstream).pipe(socket);return;}
        let input=Buffer.alloc(0);socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);if(input.length>65){socket.destroy();return;}if(input.length===65){witness=input.equals(Buffer.from(attempt.nonce+'\\n'));socket.end(witness?input:Buffer.from('wrong\\n'));}});
      });
      await new Promise((resolve,reject)=>{proof.once('error',reject);proof.listen(0,'127.0.0.1',resolve);});
      return {target:'127.0.0.1:'+proof.address().port,
        async verify({origin,attempt:current}) {
          if(used)throw new Error('initial proof only');used=true;
          mark('proof'); const endpoint=new URL(origin);
          try {
            const matched=await new Promise(resolve=>{let input=Buffer.alloc(0);const socket=net.connect(Number(endpoint.port),endpoint.hostname);const timer=setTimeout(()=>{socket.destroy();resolve(false);},1000);
              socket.once('connect',()=>socket.write(current.nonce+'\\n'));socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);if(input.length>65){socket.destroy();clearTimeout(timer);resolve(false);}});socket.once('error',()=>{clearTimeout(timer);resolve(false);});socket.once('end',()=>{clearTimeout(timer);resolve(input.equals(Buffer.from(current.nonce+'\\n')));}); });
            return {status:matched&&witness?'verified':'unverified',attemptId:current.id,endpoint:origin,checkedAt:new Date().toISOString(),validUntil:new Date(Date.now()+5000).toISOString(),vantage:'this-device',checks:['nonce'],facts:[]};
          } finally {proving=false;}
        },async close(){await new Promise(resolve=>proof.close(resolve));}};
    }
  }:{}),
  async create(ctx, plan) {
    if (plan.readback.kind === 'attached' && proofProtocol === 'echo') {
      const [host,port]=plan.effects[0].target.split(':');
      const server=net.createServer({allowHalfOpen:true}, socket=>{const upstream=net.connect(Number(port),host);upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.pipe(upstream).pipe(socket);});
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});servers.set(plan.resourceKey,server);plan={...plan,origin:'tcp://127.0.0.1:'+server.address().port};mark('start');
    } else if (plan.readback.kind === 'attached') {
      const target = new URL('http://' + plan.effects[0].target);
      const server = http.createServer((req,res) => {
        const upstream = http.request({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:req.headers}, reply => { res.writeHead(reply.statusCode,reply.headers); reply.pipe(res); });
        upstream.on('error',()=>{res.writeHead(502);res.end();}); req.pipe(upstream);
      });
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      servers.set(plan.resourceKey,server); plan={...plan,origin:'http://127.0.0.1:'+server.address().port};mark('start');
    }
    return { schemaVersion: 1, adapterId: definition.id, resourceKey: plan.resourceKey, generation: ctx.generation ?? 1,operationId:ctx.operationId??null, identity: null, readback: plan.readback, origin: plan.origin ?? 'https://' + definition.id + '.example.invalid' };
  },
  async observe(ctx, request) { return { present: false, resourceKey: definition.id + ':' + sha({ target: request.target }).slice(0, 16), identity: null, revision: null }; },
  async verify(ctx, receipt) { mark('proof'); return ctx.verifyChallenge(receipt?.readback?.origin ?? receipt?.origin ?? '', receipt?.readback?.target ?? ''); },
  async remove(ctx,receipt) { mark('stop'); const server=servers.get(receipt.resourceKey); if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));servers.delete(receipt.resourceKey);} mark('cleanup');return { removed: true, debt: null }; },
  async runtimeFacts() { return { properties: structuredClone(definition.capabilities), ingress: null, limits: { recommendedPollIntervalMs: 5000, idleTimeoutMs: null } }; },
};
`;

// The module of a fake that also has the durable kind. It keeps the session methods above, and answers the durable
// ones through the engine's own adapter, with a facet whose rule store is `store.json` next to the module: a version
// counter is the compare-and-set token, and a write is a rename, so another process sees whole states only.
const durableModuleSource = runtime => `// A fake durable provider written by @tnunamak/gozar/testing. Its rule store is the file store.json beside this module.
import { recipeAdapter } from ${JSON.stringify(runtime)};
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
// The session methods live in plain.mjs, written beside this file; it is loaded by URL so the text of this template is
// never mistaken for an import of the testing module itself.
const { default: plain } = await import(new URL('./plain.mjs', import.meta.url));

const storePath = new URL('./store.json', import.meta.url);
const read = () => JSON.parse(readFileSync(storePath, 'utf8'));
const write = state => { const temporary = new URL('./store.json.tmp', import.meta.url); writeFileSync(temporary, JSON.stringify(state)); renameSync(temporary, storePath); };
const slotIds = ['a', 'b', 'c'];

function durableFacet(definition) {
  return {
    family: 'fake',
    definition,
    async observe() { const state = read(); return { identity: state.identity, snapshot: state.entries, version: String(state.version) }; },
    slots: () => slotIds.map(slot => ({ slot, origin: 'https://' + slot + '.' + plain.id + '.invalid', permitted: true })),
    read: (snapshot, slot) => snapshot[slot]?.rule ?? null,
    foreign: (snapshot, slot) => snapshot[slot]?.foreign === true,
    occupied: (snapshot, slot) => snapshot[slot] !== undefined,
    expand: target => ({ forward: target }),
    expiresAt: () => null,
    async put(ctx, { slot, rule, version }) {
      const state = read();
      if (version !== String(state.version)) return 'conflict';
      state.entries[slot] = { rule }; state.version += 1; write(state);
      return 'written';
    },
    async delete(ctx, { slot, rule, version }) {
      const state = read();
      if (version !== String(state.version) || !isDeepStrictEqual(state.entries[slot]?.rule, rule)) return 'conflict';
      delete state.entries[slot]; state.version += 1; write(state);
      return 'written';
    },
  };
}

const base = recipeAdapter({ definition: new URL('./definition.json', import.meta.url), extend: ({ wrapped }) => ({ durable: durableFacet(wrapped) }) });
const isDurable = value => value === 'durable';
export default {
  ...plain,
  durable: base.durable,
  plan: (ctx, request) => (isDurable(request.usage?.kind) ? base.plan(ctx, request) : plain.plan(ctx, request)),
  observe: (ctx, request) => (isDurable(request.usage?.kind) ? base.observe(ctx, request) : plain.observe(ctx, request)),
  verify: (ctx, receipt) => (isDurable(receipt?.readback?.kind) ? base.verify(ctx, receipt) : plain.verify(ctx, receipt)),
  remove: (ctx, receipt, ...rest) => (isDurable(receipt?.readback?.kind) ? base.remove(ctx, receipt, ...rest) : plain.remove(ctx, receipt, ...rest)),
};
`;
// The Query's protocol words; a fake inspects no traffic, so it can carry each of them.
const PROTOCOLS = ['sse', 'streamable-http', 'oauth-dcr'];
const runtimeUrl = pathToFileURL(fileURLToPath(new URL('./adapter-runtime.mjs', import.meta.url))).href;

/**
 * Writes a one-provider registry to a scratch directory and returns `{ manifest, root, cleanup }`, which is what
 * `createRouteApi({ manifest, root })` loads. `kinds` is any of 'session' and 'durable'. A durable fake keeps its
 * rules in `<root>/providers/<id>/store.json` (read it to see what the provider holds; a rule is `entries.<slot>.rule`), so
 * another process sees the same state. The fake never touches the network. `id` is the id the catalog shows as `providerId`.
 * `protocols` uses the Query's words ('sse', 'streamable-http', 'oauth-dcr'); a fake carries all three unless a test narrows it,
 * so an app's protocol requirements do not make its own fake ineligible.
 */
export async function fakeRegistry({ id, label, kinds, reach, transport = 'https', protocols = PROTOCOLS, dir, facts = [], setupActions = [], proofProtocol = 'http' } = {}) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw gozarError('invalid_input', 'fakeRegistry needs an id of lowercase letters, digits and hyphens');
  // An attached fake would make expose start a real controller process, so only session and durable fakes exist.
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => !KINDS.includes(kind))) throw gozarError('invalid_input', `fakeRegistry kinds must be a non-empty list of ${KINDS.join(' and ')}: only session and durable fakes are supported`);
  if (!REACHES.includes(reach)) throw gozarError('invalid_input', `fakeRegistry reach must be one of ${REACHES.join(', ')}`);
  if (!['https', 'http', 'tcp', 'tls'].includes(transport)) throw gozarError('invalid_input', "fakeRegistry transport must be 'https' or 'http'");
  if (!Array.isArray(protocols) || protocols.some(item => !PROTOCOLS.includes(item))) throw gozarError('invalid_input', `fakeRegistry protocols must be a list of ${PROTOCOLS.join(', ')}`);
  const own = dir === undefined;
  const root = dir ?? await mkdtemp(join(tmpdir(), 'gozar-fake-'));
  const folder = join(root, 'providers', id);
  await mkdir(folder, { recursive: true });
  const definition = {
    schemaVersion: 1, id, label: label ?? `Fake ${id}`, needs: 'Needs nothing: this is a test fake.',
    capabilities: {
      reach, transport,
      traffic: { tlsTermination: transport === 'https' ? 'provider' : 'unknown', providerCanReadPayload: ['tcp','tls'].includes(transport) ? null : false, readers: [], metadataVisibleTo: [], evidenceRef: 'testing' },
      address: { stability: 'unknown', scope: 'a fake address that exists only in memory', conditions: [], ports: null },
      cost: { kind: 'free', summary: 'A fake costs nothing.', currency: null, amount: null, period: null },
      needsAccount: false, lifetimes: [...kinds], supervision: 'controller',
      protocols: { sse: protocols.includes('sse'), streamableHttp: protocols.includes('streamable-http'), oauthDcr: protocols.includes('oauth-dcr') },
      proof: { vantage: 'this-device', checks: ['nonce'] },
    },
    supportedKinds: [...kinds], facts, ...(proofProtocol === 'echo' ? {originSchemes:['tcp:']} : {}),
    disclosure: { revision: `disc-${id}`, text: 'A fake provider used in tests. Nothing leaves this process.', links: [] },
    ownership: 'gozar-owned',
  };
  await writeFile(join(folder, 'definition.json'), JSON.stringify({ adapter: definition }, null, 2));
  if (kinds.includes('durable')) {
    // The durable engine reads the provider's durable recipe from the wrapped definition of the recipe adapter.
    definition.capabilities.address.stability = 'stable';
    await writeFile(join(folder, 'definition.json'), JSON.stringify({ wraps: './wrapped.definition.json', adapter: definition }, null, 2));
    await writeFile(join(folder, 'wrapped.definition.json'), JSON.stringify({ schemaVersion: 1, definition: {
      id, planVersion: 1, idleTimeoutMs: null, providerResource: `${id}-slot`, addressStability: 'stable', durableLifetime: 'provider-persistent',
      actions: [], recipes: {}, durableRecipe: { mode: 'fake', slots: ['a', 'b', 'c'], listener: { forward: '{target}' } } } }, null, 2));
    await writeFile(join(folder, 'store.json'), JSON.stringify({ identity: `store-${id}`, version: 1, entries: {} }));
    await writeFile(join(folder, 'plain.mjs'), moduleSource(setupActions, proofProtocol));
    await writeFile(join(folder, 'index.mjs'), durableModuleSource(runtimeUrl));
  } else {
    await writeFile(join(folder, 'index.mjs'), moduleSource(setupActions, proofProtocol));
  }
  return {
    manifest: { providers: [{ id, module: `providers/${id}/index.mjs`, definition: `providers/${id}/definition.json` }] },
    root,
    cleanup: async () => { await rm(own ? root : join(root, 'providers', id), { recursive: true, force: true }); if (!own) await rmdir(join(root, 'providers')).catch(error => { if (!['ENOTEMPTY', 'ENOENT', 'EEXIST'].includes(error.code)) throw error; }); },
  };
}
```

## Read-only dependency packages/gozar-node/embedding-state.mjs

```js
// Stable computation fields and open-ended display facts. Unknown evidence stays explicit.
export const unknown = (reason = 'not-observed') => ({ known: false, reason });
export const known = value => ({ known: true, value });
import { bindingFor, cleanupRecovery } from './embedding-projections.mjs';
export const features = ['structured-state', 'open-facts', 'input-requirements', 'secret-intake',
  'configuration-revisions', 'consent-facts-digest', 'proof-subject', 'host-secret-backend',
  'prerequisite-actions', 'provider-inventory', 'route-binding', 'cleanup-recovery'];

export function availabilityFor(definition) {
  return Object.fromEntries(['session', 'attached', 'durable'].map(kind => [kind,
    definition.availability?.[kind] ?? (definition.supportedKinds.includes(kind)
      ? { state: 'available', reason: 'admitted' } : { state: 'unsupported', reason: 'usage-not-supported' })]));
}

export function prerequisitesFor(inspection, observedAt) {
  const { facts, adapter } = inspection;
  const actions = [...(inspection.missingActions ?? []), ...inspection.actions];
  const declarations = adapter.definition.prerequisites ?? [{ id: 'local-setup', label: 'Local prerequisites', observation: 'detected' }];
  return declarations.map(item => {
    const observed = facts?.[item.observation];
    return { id: item.id, label: item.label,
      state: observed === true ? 'present' : observed === false ? 'missing' : observed === 'denied' ? 'denied' : 'unknown',
      observedAt, version: unknown(), remedy: item.actionId ? actions.find(action => action.id === item.actionId) ?? null : actions[0] ?? null };
  });
}

export function configurationFor(actions, saved, declared) {
  const inputRequirements = declared?structuredClone(declared):actions.filter(action => ['provide-secret', 'provide-value'].includes(action.kind)).map(action => ({
    id: action.id, actionId: action.id, label: action.secretLabel ?? action.valueLabel ?? action.label,
    kind: action.valueFormat ?? 'text', secret: action.kind === 'provide-secret', help: action.help ?? action.label,
    required: action.required !== false, obtainUrl: action.obtainUrl ?? null, validation: 'syntax-only',
  }));
  return { inputRequirements, ...(saved.revision ? {revision:saved.revision,scopeId:saved.scopeId} : {}), values: saved.values, credentials: Object.fromEntries(inputRequirements.filter(field => field.secret)
    .map(field => [field.id, saved.credentials[field.id] ?? known(false)])),
    actions: actions.filter(action => ['provide-secret', 'provide-value'].includes(action.kind)) };
}

export function cleanupForSession(reply) {
  const snapshot = reply.snapshot ?? {};
  if (['cleanup-pending', 'stopping'].includes(snapshot.phase) || reply.localCleanupFailures?.length) return { state: 'unconfirmed' };
  if (snapshot.phase === 'stopped') {
    const confirmed = Array.isArray(reply.localCleanupFailures) && !reply.localCleanupFailures.length &&
      (snapshot.resources ?? []).every(resource => resource.ownership !== 'owned' || resource.cleanup === 'removed');
    return { state: confirmed ? 'confirmed' : 'unconfirmed' };
  }
  return { state: 'none' };
}

export function enrichRoute(route, { target, bindTarget, expiresAt, validUntil, now = Date.now(), facts = [] } = {}) {
  const expiry = typeof expiresAt === 'string' ? known(expiresAt) : unknown();
  const proofExpiry = typeof validUntil === 'string' ? known(validUntil) : unknown();
  const expired = [expiry, proofExpiry].some(item => item.known && Date.parse(item.value) <= now);
  const verified = route.verification.status === 'verified' && !expired && route.verification.subject!=null;
  const verification = { ...route.verification, observedAt:route.verification.observedAt??route.verification.checkedAt??null,subject:route.verification.subject??null, status: verified ? 'verified' : 'unverified', validUntil: proofExpiry,
    results: route.verification.checks.map(check => ({ check, status: verified ? 'passed' : 'unknown' })) };
  let localPort = unknown();
  try { const url = new URL(target.includes('://') ? target : `http://${target}`); localPort = known(Number(url.port || (url.protocol === 'https:' ? 443 : 80))); } catch { /* no recorded target */ }
  return { ...route,state:route.state==='usable'&&!verified?'unverified':route.state, schemaVersion: 2,operationId:route.operationId??null,published: verified ? route.published : null, verification, expiresAt: expiry,
    binding:route.binding??bindingFor({observedTarget:undefined,authority:route.ownership==='external-owned'?'owner':'unknown',remedy:null}),
    cleanup:cleanupRecovery(route.cleanup,route.handle),
    routeState: route.cleanup.state === 'unconfirmed' ? 'cleanup-unconfirmed' : expired ? 'expired' : verified ? 'verified'
      : route.state === 'released' ? 'inactive' : route.origin ? 'detected' : 'unknown',
    hostConfiguration: { target: target ? known(target) : unknown(), localPort, bindTarget: bindTarget ? known(bindTarget) : unknown(), origin: route.origin ? known(route.origin) : unknown() },
    facts, actions: route.state === 'released' ? [] : route.consentChange?.reason==='proof-refresh-unsupported'?['stop']:['stop', 'edit', 'rotate'] };
}
```

## Read-only dependency test/node/route-schema-check.mjs

```js
// Shared by the consumer-side route tests: the same schema keywords route-contract.test.mjs enforces, checked
// against runtime/route-catalog.schema.json, plus synthetic adapters. Not a test file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const schema = JSON.parse(readFileSync(join(root, 'runtime/route-catalog.schema.json'), 'utf8'));
export const fixtures = JSON.parse(readFileSync(join(root, 'test/fixtures/route-contract.json'), 'utf8'));
const annotations = new Set(['$schema', '$id', 'title', 'description', '$defs']);
const kinds = { string: v => typeof v === 'string', number: v => typeof v === 'number' && Number.isFinite(v), integer: v => Number.isInteger(v), boolean: v => typeof v === 'boolean',
  null: v => v === null, array: Array.isArray, object: v => typeof v === 'object' && v !== null && !Array.isArray(v) };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function validate(node, value, defs, path = '$') {
  const errors = [];
  for (const key of Object.keys(node)) {
    if (annotations.has(key)) continue;
    switch (key) {
      case '$ref': errors.push(...validate(defs[/^#\/\$defs\/(\w+)$/.exec(node.$ref)[1]], value, defs, path)); break;
      case 'type': if (![].concat(node.type).some(type => kinds[type](value))) errors.push(`${path}: expected ${node.type}`); break;
      case 'const': if (!same(value, node.const)) errors.push(`${path}: expected const ${JSON.stringify(node.const)}`); break;
      case 'enum': if (!node.enum.some(item => same(item, value))) errors.push(`${path}: not in enum`); break;
      case 'minimum': if (typeof value === 'number' && value < node.minimum) errors.push(`${path}: below minimum`); break;
      case 'pattern': if (typeof value === 'string' && !new RegExp(node.pattern).test(value)) errors.push(`${path}: pattern mismatch`); break;
      case 'required': if (kinds.object(value)) for (const name of node.required) if (!(name in value)) errors.push(`${path}: missing ${name}`); break;
      case 'properties': if (kinds.object(value)) for (const [name, sub] of Object.entries(node.properties)) if (name in value) errors.push(...validate(sub, value[name], defs, `${path}.${name}`)); break;
      case 'additionalProperties': if (kinds.object(value)) for (const name of Object.keys(value)) if (!(name in (node.properties ?? {}))) { if (node.additionalProperties === false) errors.push(`${path}: unknown property ${name}`); else errors.push(...validate(node.additionalProperties, value[name], defs, `${path}.${name}`)); } break;
      case 'items': if (Array.isArray(value)) value.forEach((item, i) => errors.push(...validate(node.items, item, defs, `${path}[${i}]`))); break;
      case 'oneOf': { const hits = node.oneOf.filter(sub => validate(sub, value, defs, path).length === 0).length; if (hits !== 1) errors.push(`${path}: matches ${hits} oneOf branches`); break; }
      case 'anyOf': if (!node.anyOf.some(sub => validate(sub, value, defs, path).length === 0)) errors.push(`${path}: matches no anyOf branch`); break;
      default: throw new Error(`Unsupported schema keyword ${key}`);
    }
  }
  return errors;
}
/** Asserts that `value` is a valid instance of the named $defs shape. */
export function assertShape(shape, value) {
  assert.ok(schema.$defs[shape], `no schema shape ${shape}`);
  assert.deepEqual(validate(schema.$defs[shape], value, schema.$defs), [], `${shape} is not valid`);
}
export const frozenCodes = new Set(fixtures.frozenErrorCodes);
/** The code an app would see; asserts it is in the frozen union. */
export async function codeOf(promise) {
  try { await promise; } catch (error) { assert.ok(frozenCodes.has(error.code), `unfrozen code ${error.code}`); return error.code; }
  assert.fail('expected a rejection');
}

const base = process.env.GOZAR_TEST_TMPDIR ?? join(homedir(), '.tmp', 'gozar-route-tests');
/** A private scratch directory, removed when the test ends. */
export async function scratch(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  await chmod(base, 0o700); // the service state check refuses group-writable ancestors
  const directory = await mkdtemp(join(base, 'route-'));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

// --- Synthetic adapters ---------------------------------------------------------------------------
export const properties = (over = {}) => ({
  reach: 'internet', transport: 'https',
  traffic: { tlsTermination: 'endpoint', providerCanReadPayload: false, readers: [], metadataVisibleTo: ['provider'], evidenceRef: 'evidence-synthetic-1' },
  address: { stability: 'stable', scope: 'account', conditions: [] }, cost: { kind: 'free', summary: 'No charge', currency: null, amount: null, period: null },
  needsAccount: false, lifetimes: ['session', 'attached', 'durable'], supervision: 'controller',
  protocols: { sse: true, streamableHttp: true, oauthDcr: true }, ...over });
export const disclosure = id => ({ revision: `disc-${id}`, text: `Synthetic disclosure for ${id}.`, links: [] });
export const action = (id, kind = 'gozar-runs', over = {}) => ({ id, kind, label: `Do ${id}`, digest: `sha256:${id}-1`, disclosure: disclosure(id), ...over });

/** An adapter with call counters. `world` is shared provider state that only create/remove/setup may change. */
export function stubAdapter(id, { caps = properties(), kinds = ['session', 'attached', 'durable'], state = 'ready', actions = [], world = { rules: [] }, origin = null, setup } = {}) {
  const calls = { detect: 0, plan: 0, observe: 0, create: 0, remove: 0, setup: 0, verify: 0 };
  const adapter = {
    id, calls, world,
    definition: { schemaVersion: 1, id, label: `Route ${id}`, capabilities: caps, supportedKinds: kinds, disclosure: disclosure(id) },
    async detect() { calls.detect++; return { state, facts: { id } }; },
    properties: () => caps,
    setupActions: () => actions,
    async setup(ctx, actionId, secretHandle) { calls.setup++; return setup ? setup(ctx, actionId, secretHandle) : { state: 'complete', nextAction: null }; },
    async plan(ctx, request) { calls.plan++; return { digest: `plan-${id}-${request.target}`, origin, resourceKey: `res-${id}`, effects: [], readback: null, cleanup: null, precondition: null }; },
    async observe() { calls.observe++; return { present: world.rules.length > 0, resourceKey: `res-${id}`, identity: null, revision: null }; },
    async create(ctx, plan) { calls.create++; world.rules.push(id); return { schemaVersion: 1, adapterId: id, resourceKey: `res-${id}`, generation: ctx.generation ?? 1, identity: { origin: origin ?? 'https://example.invalid' }, readback: null, origin: origin ?? 'https://example.invalid' }; },
    async verify() { calls.verify++; return { status: 'verified', checkedAt: new Date().toISOString() }; },
    async remove() { calls.remove++; world.rules.length = 0; return { removed: true, debt: null }; },
    async runtimeFacts() { return { properties: caps, ingress: null, limits: { recommendedPollIntervalMs: 5000, idleTimeoutMs: null } }; },
  };
  return adapter;
}
export const query = (over = {}) => ({ schemaVersion: 1, owner: 'example-app', target: '127.0.0.1:8799', home: '/nonexistent', usage: { kind: 'session', lifetimeMs: 60_000 },
  requirements: { reach: 'internet', transport: 'https', payloadAccess: 'allow-provider', address: 'any', setup: 'none', protocols: [] }, ...over });
// Token stubs that implement the seam: bound to the whole binding, single use.
export function tokenStubs() {
  const live = new Map(); let n = 0;
  const consentBinding = (q, home, revision) => ({ owner: q.owner, home, target: q.target, usage: q.usage, intent: q.intent ?? 'create', requirements: q.requirements,
    route: q.route ?? null, origin: q.origin ?? null, disclosureRevision: revision });
  const issue = async ({ binding, grant }) => { const token = `tok_synthetic_${++n}`; live.set(token, { binding, grant }); return { token, expiresAt: '2026-11-12T12:10:00.000Z' }; };
  const redeem = async ({ token, binding }) => {
    const entry = live.get(token); live.delete(token);
    if (!entry) throw Object.assign(new Error('unknown'), { code: 'consent_unknown' });
    if (JSON.stringify(entry.binding) !== JSON.stringify(binding)) throw Object.assign(new Error('mismatch'), { code: 'consent_mismatch' });
    return entry.grant;
  };
  return { consentBinding, issue, redeem, live };
}

/** A deep copy of a valid fixture value, so tests start from a shape the contract itself accepts. */
export function fixtureValue(shape, name) {
  const found = fixtures.valid.find(item => item.shape === shape && (name === undefined || item.name === name));
  assert.ok(found, `no fixture ${shape}/${name}`);
  return structuredClone(found.value);
}
```

## Read-only dependency test/node/operation-recovery.test.mjs

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGozar} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {scratch,query} from './route-schema-check.mjs';
test('host crash before saving its handle recovers by operation enumeration and exact close',async t=>{
 const home=await scratch(t),owner='crashed-host',operationId='saved-before-call';
 const registry=await fakeRegistry({id:'crash-recovery',dir:join(home,'registry'),kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo'});t.after(registry.cleanup);
 const q=query({home,owner,operationId,usage:{kind:'attached'},target:'127.0.0.1:1',requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const source=`import {createGozar} from '@tnunamak/gozar';\nconst api=createGozar(${JSON.stringify({manifest:registry.manifest,root:registry.root})});const q=${JSON.stringify(q)};const choice=(await api.catalogRoutes(q)).candidates[0];await api.expose({...q,wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}});process.stdout.write('allocated\\n');setInterval(()=>{},1000);\n`;
 const child=spawn(process.execPath,['--input-type=module','--eval',source],{cwd:fileURLToPath(new URL('../../',import.meta.url)),stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const exited=new Promise(resolve=>child.once('exit',resolve));
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('fixture host deadline '+stderr)),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',()=>{clearTimeout(timer);reject(new Error('fixture host exited '+stderr));});});
 child.kill('SIGKILL');await exited;
 const api=createGozar({manifest:registry.manifest,root:registry.root});
 const recovered=await api.listRoutes({home,owner});assert.equal(recovered.routes.length,1);const route=recovered.routes[0];assert.equal(route.operationId,operationId);
 assert.equal((await api.listRoutes({home,owner:'other'})).routes.length,0);
 assert.equal((await api.closeRoute({home,handle:route.handle,mode:'remove'})).cleanup.state,'confirmed');
 const events=(await readFile(join(registry.root,'providers','crash-recovery','events.jsonl'),'utf8')).trim().split('\n').map(v=>JSON.parse(v).event);
 assert.equal(events.filter(v=>v==='start').length,1);assert.ok(events.includes('cleanup'));
 await assert.rejects(api.listRoutes({home:join(home,'missing')}));
});
test('concurrent operation replay allocates once, conflicts before effects and stays terminal after close',async t=>{
 const home=await scratch(t),registry=await fakeRegistry({id:'operation-replay',dir:join(home,'registry'),kinds:['attached'],reach:'this-device',transport:'tcp',proofProtocol:'echo'});t.after(registry.cleanup);
 const api=createGozar({manifest:registry.manifest,root:registry.root}),q=query({home,owner:'operation-host',operationId:'journalled-intent',usage:{kind:'attached'},target:'127.0.0.1:1',requirements:{reach:'this-device',transport:'tcp',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}});
 const choice=(await api.catalogRoutes(q)).candidates[0],request={...q,wait:'verified',approval:{kind:'route',candidateToken:choice.candidateToken,disclosureRevision:choice.disclosure.revision,consentFactsDigest:choice.consentFactsDigest}};
 let route;t.after(async()=>{if(route)await api.closeRoute({home,handle:route.handle,mode:'remove'}).catch(()=>{});});
 const [first,second]=await Promise.all([api.expose(request),api.expose(request)]);route=first;
 assert.deepEqual(first.handle,second.handle);assert.equal(first.handle.generation,1);
 await assert.rejects(api.expose({...request,target:'127.0.0.1:2'}),{code:'operation_conflict'});
 const listed=await api.listRoutes({home,owner:q.owner});assert.equal(listed.routes.length,1);assert.equal(listed.routes[0].published,null);assert.equal(listed.routes[0].operationId,q.operationId);
 assert.equal((await api.closeRoute({home,handle:first.handle,mode:'remove'})).cleanup.state,'confirmed');
 assert.equal((await api.expose(request)).state,'released');
 const events=await readFile(join(registry.root,'providers','operation-replay','events.jsonl'),'utf8');assert.equal(events.split('"start"').length-1,1);
 const files=await readdir(join(home,'operations'));const record=files.find(name=>name.endsWith('.json'));await writeFile(join(home,'operations',record),'{unreadable');
 await assert.rejects(api.listRoutes({home,owner:q.owner}),error=>typeof error.code==='string');
});
```

## Consumer fixture effects.json

```json
{
  "recipe/probe": {
    "cases": [
      {
        "args": [
          "status",
          "--json",
          "--peers=false"
        ],
        "output": "node-status"
      },
      {
        "args": [
          "serve",
          "status",
          "--json"
        ],
        "output": "serve-config"
      },
      {
        "args": [
          "-V"
        ],
        "result": {
          "stdout": "",
          "stderr": "OpenSSH_9.9p1\n",
          "exitCode": 0
        }
      },
      {
        "args": [
          "--version"
        ],
        "result": {
          "stdout": "cloudflared version 2026.1.0\n",
          "stderr": "",
          "exitCode": 0
        }
      }
    ],
    "nodeStatus": {
      "BackendState": "Running",
      "Self": {
        "ID": "fixture-node",
        "DNSName": "fixture.invalid.",
        "TailscaleIPs": [],
        "CapMap": {
          "funnel": [],
          "https": [],
          "https://tailscale.com/cap/funnel-ports?ports=443,8443,10000": []
        }
      },
      "CurrentTailnet": {
        "MagicDNSSuffix": "fixture.invalid",
        "MagicDNSEnabled": true
      },
      "CertDomains": [
        "fixture.invalid"
      ]
    }
  },
  "local-api/request": {
    "statusPath": "/localapi/v0/status?peers=false",
    "configPath": "/localapi/v0/serve-config"
  },
  "spawn/run": {
    "trialArgs": [
      "-R"
    ],
    "trialOutput": "https://fixture.lhr.life\n",
    "publicArgs": [
      "funnel"
    ],
    "privateArgs": [
      "serve"
    ],
    "httpsPrefix": "--https=",
    "startupOutput": "Press Ctrl+C to exit.\n"
  },
  "artifact/fetch": {
    "content": "fixture prerequisite bytes"
  },
  "artifact/execute": {
    "result": {
      "executed": true,
      "exitCode": 0
    }
  },
  "sdk-listener/open": {
    "safeFailureCode": "provider_unavailable"
  }
}

```

## Consumer fixture effects.mjs

```js
// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import http from "node:http";
import tls from "node:tls";
function effect(kind, operation, handler) {
    return {
        kind,
        operation,
        handle: (input, context) => handler(input, context),
    };
}
function unsupported() {
    throw Object.assign(new Error("Fixture effect is unsupported"), {
        code: "unsupported",
    });
}
function targetAddress(addr) {
    const parsed = new URL(addr.includes("://") ? addr : `tcp://${addr}`);
    // Fixture effects may reach only the owned local gate, never a public account.
    if (!["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname))
        unsupported();
    return {
        host: parsed.hostname.replace(/^\[|\]$/g, ""),
        port: Number(parsed.port),
    };
}
const fixtureData = JSON.parse(readFileSync(new URL("./effects.json", import.meta.url), "utf8"));
// Each handler is selected only by the public exact kind and operation pair.
export function createEffectFixtures({ uncertainCloseOnce = false, streamDelayMs = 0, failInitialStream = false, sdkOpenFailure = false, } = {}) {
    const listeners = new Map();
    const origins = new Map();
    const children = new Map();
    let serveConfig = {}, configRevision = 0;
    const nodeStatus = fixtureData["recipe/probe"].nodeStatus;
    const dnsName = nodeStatus.Self.DNSName.replace(/\.$/, "");
    function register(url, addr) {
        const parsed = new URL(url);
        url = `${parsed.protocol}//${parsed.host}`;
        const item = {
            handle: randomUUID(),
            url,
            target: targetAddress(addr),
            present: true,
            closeAttempts: 0,
        };
        listeners.set(item.handle, item);
        origins.set(url, item);
        return item;
    }
    function syncConfig() {
        for (const item of origins.values())
            if (item.url.includes(dnsName))
                item.present = false;
        const configs = [
            serveConfig,
            ...Object.values(serveConfig.Foreground ?? {}),
        ];
        for (const config of configs)
            for (const [authority, web] of Object.entries(config.Web ?? {})) {
                const proxy = web.Handlers?.["/"]?.Proxy;
                if (typeof proxy === "string")
                    register(`https://${authority}`, proxy);
            }
    }
    function sourceOutput(args) {
        const row = fixtureData["recipe/probe"].cases.find(row => JSON.stringify(row.args) === JSON.stringify(args));
        if (!row)
            unsupported();
        if (row.result)
            return row.result;
        return {
            stdout: JSON.stringify(row.output === "node-status" ? nodeStatus : serveConfig),
            stderr: "",
            exitCode: 0,
        };
    }
    async function closeChild(handle) {
        const record = children.get(handle);
        if (!record)
            unsupported();
        if (record.child.exitCode === null && record.child.signalCode === null) {
            const exited = new Promise(resolve => record.child.once("exit", () => resolve()));
            record.child.kill("SIGTERM");
            await exited;
        }
        if (record.listener)
            record.listener.present = false;
        delete serveConfig.Foreground?.[handle];
        syncConfig();
        return { closed: true };
    }
    let credentialSeen = false;
    let initialStreamSeen = false;
    let artifactExecutions = 0;
    function entry(endpoint) {
        const parsed = new URL(endpoint);
        const origin = `${parsed.protocol}//${parsed.host}`;
        const item = origins.get(origin);
        if (item?.present)
            return item;
        // Service verification checks both the proxy and its exact local target.
        // Only targets already registered by a present owned effect are admitted.
        if (parsed.protocol === "http:") {
            const host = parsed.hostname.replace(/^\[|\]$/g, "");
            const port = Number(parsed.port || "80");
            const owned = [...listeners.values()].find(listener => listener.present && listener.target.host === host && listener.target.port === port);
            if (owned)
                return owned;
        }
        unsupported();
    }
    const effects = [
        effect("process-runtime", "detect", async () => ({ available: true })),
        effect("process-runtime", "open", async (input) => {
            assertTransientProcessCredential(input);
            credentialSeen = Boolean(input.credential);
            const item = register(input.origin, input.target);
            return { handle: item.handle };
        }),
        effect("process-runtime", "read", async ({ handle }) => {
            const item = listeners.get(handle);
            if (!item)
                unsupported();
            return { present: item.present };
        }),
        effect("process-runtime", "close", async ({ handle }) => {
            const item = listeners.get(handle);
            if (!item)
                unsupported();
            if (uncertainCloseOnce && ++item.closeAttempts === 1)
                return { closed: false };
            item.present = false;
            return { closed: true };
        }),
        effect("recipe", "probe", async ({ recipe }) => {
            if (!recipe ||
                typeof recipe !== "object" ||
                Array.isArray(recipe) ||
                !Array.isArray(recipe.args))
                unsupported();
            return sourceOutput(recipe.args);
        }),
        effect("local-api", "request", async ({ path, method, headers, body, }) => {
            const data = fixtureData["local-api/request"];
            if (path === data.statusPath && method === "GET")
                return { status: 200, headers: {}, body: JSON.stringify(nodeStatus) };
            if (path !== data.configPath)
                unsupported();
            if (method === "GET")
                return {
                    status: 200,
                    headers: { etag: String(configRevision) },
                    body: JSON.stringify(serveConfig),
                };
            if (method !== "POST")
                unsupported();
            if (headers["If-Match"] !== String(configRevision))
                return { status: 412, headers: {}, body: "" };
            if (!body || typeof body !== "object" || Array.isArray(body))
                unsupported();
            serveConfig = structuredClone(body);
            configRevision++;
            syncConfig();
            return { status: 200, headers: {}, body: "" };
        }),
        effect("spawn", "run", async ({ args, longRunning }) => {
            if (!longRunning)
                return sourceOutput(args);
            const data = fixtureData["spawn/run"];
            let item, output = "";
            const handle = randomUUID();
            if (data.trialArgs.every((arg) => args.includes(arg))) {
                const redirect = args[args.indexOf(data.trialArgs[0]) + 1];
                const port = Number(redirect?.split(":").at(-1));
                if (!port)
                    unsupported();
                output = data.trialOutput;
                item = register(output.trim(), `localhost:${port}`);
            }
            else {
                const port = Number(args
                    .find(arg => arg.startsWith(data.httpsPrefix))
                    ?.slice(data.httpsPrefix.length));
                if (!port)
                    unsupported();
                const proxy = args.at(-1);
                const authority = `${dnsName}:${port}`;
                const config = {
                    TCP: { [port]: { HTTPS: true } },
                    Web: { [authority]: { Handlers: { "/": { Proxy: proxy } } } },
                };
                if (data.publicArgs.every((arg) => args.includes(arg)))
                    config.AllowFunnel = { [authority]: true };
                else if (!data.privateArgs.every((arg) => args.includes(arg)))
                    unsupported();
                (serveConfig.Foreground ??= {})[handle] = config;
                item = register(`https://${authority}`, proxy);
                output = data.startupOutput;
            }
            // An actual harmless child supplies a verifiable PID and birth identity.
            const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: {} });
            if (!child.pid)
                unsupported();
            children.set(handle, { child, listener: item });
            child.once("exit", () => {
                item.present = false;
                delete serveConfig.Foreground?.[handle];
                syncConfig();
            });
            return {
                stdout: output,
                stderr: "",
                exitCode: null,
                handle,
                pid: child.pid,
            };
        }),
        effect("spawn", "read", async ({ handle }) => {
            const item = children.get(handle);
            if (!item)
                unsupported();
            return {
                present: item.child.exitCode === null && item.child.signalCode === null,
                ...(item.child.exitCode === null
                    ? {}
                    : { exitCode: item.child.exitCode }),
            };
        }),
        effect("spawn", "close", async ({ handle }) => closeChild(handle)),
        effect("sdk-listener", "detect", async () => ({
            available: true,
        })),
        effect("sdk-listener", "open", async ({ options }, { signal }) => {
            signal.throwIfAborted();
            if (sdkOpenFailure)
                return {
                    error: { code: fixtureData["sdk-listener/open"].safeFailureCode },
                };
            const target = targetAddress(options.addr);
            if (typeof options.authtoken !== "string" || !options.authtoken)
                unsupported();
            credentialSeen = true; // Never retain or log the token.
            const handle = randomUUID();
            const scheme = options.proto === "tcp" || options.proto === "tls"
                ? options.proto
                : "https";
            const authority = options.remote_addr ?? options.domain ?? `${handle}.invalid`;
            const allocated = new URL(authority.includes("://") ? authority : `${scheme}://${authority}`);
            if (scheme === "tls" && !allocated.port)
                allocated.port = "443";
            const url = `${allocated.protocol}//${allocated.host}`;
            const item = { handle, url, target, present: true, closeAttempts: 0 };
            listeners.set(handle, item);
            origins.set(url, item);
            return { handle, url };
        }),
        effect("sdk-listener", "read", async ({ handle }) => {
            const item = listeners.get(handle);
            if (!item)
                unsupported();
            return item.present
                ? { present: true, url: item.url }
                : { present: false };
        }),
        effect("sdk-listener", "close", async ({ handle }) => {
            const item = listeners.get(handle);
            if (!item)
                unsupported();
            item.closeAttempts++;
            if (uncertainCloseOnce && item.closeAttempts === 1)
                return { closed: false };
            item.present = false;
            return { closed: true };
        }),
        effect("artifact", "fetch", async () => ({
            bytes: Buffer.from(fixtureData["artifact/fetch"].content).toString("base64"),
        })),
        effect("artifact", "execute", async ({ bytes }) => {
            const expected = Buffer.from(fixtureData["artifact/fetch"].content).toString("base64");
            if (bytes !== expected)
                unsupported();
            artifactExecutions++;
            return fixtureData["artifact/execute"].result;
        }),
        effect("network", "fetch", async ({ url, method, headers }, { signal }) => {
            const item = entry(url), request = new URL(url);
            const target = new URL(`http://${net.isIP(item.target.host) === 6 ? `[${item.target.host}]` : item.target.host}:${item.target.port}`);
            target.pathname = request.pathname;
            target.search = request.search;
            const response = await new Promise((resolve, reject) => {
                const requestHeaders = { ...headers, host: headers.host ?? headers.Host ?? request.host };
                const upstream = http.request(target, { method, headers: requestHeaders, signal }, reply => {
                    const chunks = [];
                    const observedChunks = [];
                    let lastAt = performance.now();
                    let length = 0;
                    reply.on("data", (chunk) => {
                        length += chunk.length;
                        if (length > 4 * 1024 * 1024)
                            upstream.destroy(new Error("Fixture response exceeded its bound"));
                        else {
                            const at = performance.now();
                            chunks.push(chunk);
                            observedChunks.push({ data: chunk.toString("base64"), delayMs: at - lastAt });
                            lastAt = at;
                        }
                    });
                    reply.once("error", reject);
                    reply.once("end", () => resolve({ status: reply.statusCode ?? 500, headers: Object.fromEntries(Object.entries(reply.headers).filter((row) => row[1] !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value])), bytes: Buffer.concat(chunks), chunks: observedChunks }));
                });
                upstream.once("error", reject);
                upstream.end();
            });
            const body = response.bytes;
            const stream = response.headers["content-type"]?.split(";")[0] ===
                "text/event-stream";
            if (stream)
                initialStreamSeen = true;
            return {
                status: response.status,
                headers: response.headers,
                chunks: stream && failInitialStream
                    ? [{ data: body.subarray(0, 1).toString("base64"), delayMs: streamDelayMs + (response.chunks[0]?.delayMs ?? 0) }]
                    : response.chunks.map((chunk, index) => ({ ...chunk, delayMs: chunk.delayMs + (stream && index === 0 ? streamDelayMs : 0) })),
            };
        }),
        effect("network", "exchange", async ({ endpoint, transport, bytes, pinnedCertificate, deadlineMs }, { signal }) => {
            const item = entry(endpoint);
            // A TLS result must carry real gate TLS evidence; never invent a cert.
            if (transport !== "tcp" && transport !== "tls")
                unsupported();
            return new Promise((resolve, reject) => {
                signal.throwIfAborted();
                const socket = transport === "tls"
                    ? tls.connect({ ...item.target, rejectUnauthorized: false })
                    : net.connect(item.target);
                const chunks = [];
                const timer = setTimeout(() => socket.destroy(new Error("Fixture exchange deadline exceeded")), Math.max(1, Math.min(10_000, deadlineMs - Date.now())));
                const abort = () => socket.destroy(new Error("Fixture exchange cancelled"));
                signal.addEventListener("abort", abort, { once: true });
                socket.once(transport === "tls" ? "secureConnect" : "connect", () => {
                    if (socket instanceof tls.TLSSocket &&
                        pinnedCertificate &&
                        socket
                            .getPeerCertificate()
                            .fingerprint256?.replaceAll(":", "")
                            .toLowerCase() !==
                            pinnedCertificate.replaceAll(":", "").toLowerCase()) {
                        socket.destroy(new Error("Fixture certificate mismatch"));
                        return;
                    }
                    socket.end(Buffer.from(bytes, "base64"));
                });
                socket.on("data", data => chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
                socket.once("error", reject);
                socket.once("end", () => {
                    const result = {
                        bytes: Buffer.concat(chunks).toString("base64"),
                    };
                    if (socket instanceof tls.TLSSocket) {
                        const raw = socket.getPeerCertificate().raw;
                        if (raw)
                            result.certificate = `-----BEGIN CERTIFICATE-----\n${raw
                                .toString("base64")
                                .match(/.{1,64}/g)
                                ?.join("\n")}\n-----END CERTIFICATE-----\n`;
                    }
                    resolve(result);
                });
                socket.once("close", () => {
                    clearTimeout(timer);
                    signal.removeEventListener("abort", abort);
                });
            });
        }),
    ];
    return {
        effects,
        registerOwnedProxy: (origin, target) => { register(origin, target); },
        get initialStreamSeen() {
            return initialStreamSeen;
        },
        get credentialSeen() {
            return credentialSeen;
        },
        get artifactExecutions() {
            return artifactExecutions;
        },
        // Deliberately redacted ledger for leak assertions and independent absence.
        ledger: () => [...listeners.values()].map(({ handle, url, present }) => ({
            handle,
            url,
            present,
        })),
        close: async () => {
            for (const handle of children.keys())
                await closeChild(handle);
            for (const item of listeners.values())
                item.present = false;
            origins.clear();
        },
    };
}
// Check transient credential delivery before any trace or ledger write.
export function assertTransientProcessCredential(input) {
    if (!input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        typeof input.credential !== "string" ||
        !input.credential)
        return;
    const credential = input.credential;
    function contains(value) {
        if (typeof value === "string")
            return value.includes(credential);
        if (value && typeof value === "object")
            return Object.values(value).some(contains);
        return false;
    }
    if (Object.entries(input).some(([key, value]) => key !== "credential" && contains(value))) {
        throw new Error("Credential must not be delivered through process metadata");
    }
}

```

## Consumer fixture unknown-provider.json

```json
{
  "id": "fixture-orchid",
  "label": "Orchid route",
  "kinds": ["attached"],
  "reach": "this-device",
  "transport": "http",
  "proofProtocol": "http",
  "facts": [
    {
      "id": "orchid.residency-window",
      "label": "Residency window",
      "value": "An additional consent boundary supplied only by registry data.",
      "group": "jurisdiction-new",
      "known": true,
      "affectsConsent": true,
      "source": "fixture-data",
      "asOf": null
    }
  ],
  "setupActions": [
    {
      "id": "orchid.credential",
      "kind": "provide-secret",
      "label": "Fixture credential",
      "secretLabel": "Credential",
      "required": true,
      "digest": "fixture-secret-v1",
      "disclosure": {
        "revision": "fixture-v1",
        "text": "Store the synthetic credential in host custody.",
        "links": []
      }
    },
    {
      "id": "orchid.value",
      "kind": "provide-value",
      "label": "Fixture label",
      "valueLabel": "Label",
      "valueFormat": "text",
      "required": true,
      "digest": "fixture-value-v1",
      "disclosure": {
        "revision": "fixture-v1",
        "text": "Store a non-secret label.",
        "links": []
      }
    }
  ],
  "addedFact": {
    "id": "orchid.storage-window",
    "label": "New storage window",
    "value": "This row arrived as data after the earlier approval.",
    "group": "jurisdiction-new",
    "known": true,
    "affectsConsent": true,
    "source": "fixture-data",
    "asOf": null
  },
  "secondId": "fixture-marigold"
}

```

## Consumer fixture runtime-provider.mjs

```js
// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
// Trusted fixture adapter decorator: changing an observation changes a typed
// consent disclosure without changing the registered code or configuration.

import { readFile } from "node:fs/promises";
import provider from "./index.mjs";

const observation = async () =>
  JSON.parse(await readFile(new URL("../../../runtime-observations.json", import.meta.url), "utf8"));
export default {
  ...provider,
  async detect(context) {
    const result = await provider.detect(context);
    return { ...result, facts: { ...result.facts, fixtureCostKind: (await observation()).costKind } };
  },
  properties(facts) {
    const properties = provider.properties(facts);
    return { ...properties, cost: { ...properties.cost, kind: facts.fixtureCostKind } };
  },
  async runtimeFacts(...args) {
    const result = await provider.runtimeFacts(...args);
    return {
      ...result,
      properties: { ...result.properties, cost: { ...result.properties.cost, kind: (await observation()).costKind } },
    };
  },
};

```
# Current source supplement: a23ac56 (authoritative for overlapping sections)

Runtime HTTP/session helper fix is ALREADY green91/91 at a23ac56. Do not implement it again. The earlier6ef dependency snapshots are historical where current sections below overlap. These are explicitly authorized read-only dependency transcripts; edit only each job's named source/test files. Public root declarations, external ownership declarations, pure metadata release, core interfaces/host/driver and embedding configuration are now supplied. Aggregate source is for host validation later, never worker execution.


## Current packages/gozar-node/route-contract.d.ts

```js
// Gozar consumer contract: query version 1, catalog and route response version 2.
//
// Types only: this file declares the consumer boundary and implements nothing. The JSON Schemas in
// runtime/route-catalog.schema.json and the fixtures in test/fixtures/route-contract.json are the
// machine-checkable form of the same shapes; a change to one needs a versioned change to all three.
// Provider names, provider enums and adapter tuples never appear here: apps branch on these shapes
// and on GozarErrorCode only.

// --- Shapes -------------------------------------------------------------------------------------

export type Reach = 'internet' | 'tailnet' | 'lan' | 'this-device' | 'unknown';

export type Usage =
  | { kind: 'durable'; routeId: string }
  | { kind: 'session'; lifetimeMs: number }
  | { kind: 'attached' };

export type Requirements = {
  /** A requirement can never ask for 'unknown' reach; only Properties.reach may be unknown. */
  reach: Exclude<Reach, 'unknown'>;
  /**
   * 'https' (the default use) needs an encrypted route. 'any' also accepts plain HTTP and is valid only with reach
   * 'lan' or 'this-device'; with any other reach the query fails with invalid_input.
   */
  transport: 'https' | 'tcp' | 'tls' | 'any';
  payloadAccess: 'endpoint-only' | 'allow-provider';
  address: 'stable' | 'any';
  /** 'none' means ready now; 'allow' permits a candidate that still needs a setup action. */
  setup: 'none' | 'allow';
  protocols: ('sse' | 'streamable-http' | 'oauth-dcr')[];
};

export type Query = {
  operationId?:string;
  hostCapabilities?:import('./embedding-contract.js').HostCapabilities;
  schemaVersion: 1;
  owner: string;
  target: string;
  usage: Usage;
  requirements: Requirements;
  home: string;
  /** Gozar-owned named policy; uninterpreted by apps. Unknown name: route_not_found. */
  route?: string;
  origin?: string;
  /**
   * Selects exactly one adapter by the `providerId` its Candidate shows; the catalog then holds only that candidate.
   * An unknown id is route_not_found, and its message lists every id on offer. Not valid together with `route`.
   * Apps show, store and send the id back; they never compare it with a literal.
   */
  providerId?: string;
  /** Default: 'create'. */
  intent?: 'create' | 'adopt';
  /** Opaque reference from inspectLegacyRoute. */
  migrationRef?: string;
};

export type Disclosure = {
  revision: string;
  text: string;
  links: { rel: 'terms' | 'privacy'; label: string; href: string }[];
};

export type Action = {
  id: string;
  kind: 'open-url' | 'instructions' | 'provide-secret' | 'provide-value' | 'gozar-runs'|'clear-input'|'install-artifact';
  inputId?:string;
  consent?:SetupConsentSnapshot;
  review?:{canonicalInput:unknown};
  label: string;
  digest: string;
  disclosure: Disclosure;
  href?: string;
  instructions?: string;
  secretLabel?: string;
  obtainUrl?: string;
  help?: string;
  /** For 'provide-value' only: a plain, non-secret input (a domain, an address). Answer it with runSetupAction `value`. */
  valueLabel?: string;
  valuePlaceholder?: string;
  valueFormat?: 'https-origin' | 'domain' | 'text';
  required?: boolean;
  artifact?:{url:string;sha256:string;platform:string;architecture:string};
  effects?:{writes:string[];networkOrigins:string[];requiresPrivilege:boolean;restartRequired:boolean};
};

export type Properties = {
  reach: Reach;
  transport: 'http' | 'https' | 'tcp' | 'tls';
  traffic: {
    tlsTermination: 'endpoint' | 'provider' | 'unknown';
    providerCanReadPayload: boolean | null;
    readers: string[];
    metadataVisibleTo: string[];
    evidenceRef: string | null;
  };
  address: {
    stability: 'stable' | 'ephemeral' | 'unknown'; scope: string; conditions: string[];
    /** The public ports a route of the queried (or viewed) usage kind may use, in the order Gozar tries them; null when the provider assigns the port. */
    ports: number[] | null;
  };
  cost: { kind: 'free' | 'paid' | 'unknown'; summary: string; currency: string | null; amount: number | null; period: string | null };
  needsAccount: boolean | null;
  lifetimes: ('session' | 'attached' | 'durable')[];
  supervision: 'controller' | 'provider-persistent' | 'host-supervised';
  protocols: { sse: boolean; streamableHttp: boolean; oauthDcr: boolean };
  /**
   * What Gozar checks before it publishes: where the check runs from, and which checks it makes for this request.
   * `tls` appears only for an https provider, and `sse` only when the request asks for SSE.
   */
  proof: { vantage: ProofVantage; checks: ProofCheck[] };
};

export type ProofVantage = 'public' | 'tailnet' | 'lan' | 'this-device' | 'none';
export type ProofCheck = 'tls' | 'nonce' | 'sse';

export type UnmetRequirement = 'reach' | 'transport' | 'payloadAccess' | 'address' | 'setup' | 'protocols' | 'usage' | 'platform';
export type UnmetReason = 'not_met' | 'unknown' | 'unsupported_platform';


/** An observation, never a guessed default. */
export type Observation<T> = { known: true; value: T } | { known: false; reason: string };
/** Open display data. Show every affectsConsent row before approval. Groups and ids are open strings. */
export type Fact = { id: string; label: string; value: string | number | boolean | null; group: string;
  affectsConsent: boolean; source: string; asOf: string | null } &
  ({ known: true; reason?: string|null } | { known: false; reason: string });
export type SetupConsentScope={kind:'setup';registryId:string;scopeId:string;providerId:string;configurationRevision:string;draftId:string|null;actionId:string;disclosureRevision:string;actionDigest:string};
export type RouteConsentScope={kind:'route';registryId:string;scopeId:string;providerId:string;configurationRevision:string;query:{usage:Usage;reach:Reach;transport:Properties['transport'];target:string;expectedOrigin:string|null};reviewHandle?:string;handleGeneration?:number};
/** The actual typed canonical input. Setup includes the full trusted action, including artifact/effect disclosures. */
export type SetupConsentDisclosures={action:Omit<Action,'consent'|'review'>};
export type RouteConsentDisclosures={reach:Reach;transport:Properties['transport'];traffic:Properties['traffic'];address:Properties['address'];cost:{kind:Properties['cost']['kind']};lifetimes:Properties['lifetimes'];supervision:Properties['supervision'];protocols:Properties['protocols'];disclosure:Disclosure};
export type ConsentDisclosures=SetupConsentDisclosures|RouteConsentDisclosures;
export type SetupConsentSnapshot={scope:SetupConsentScope;consentFactsDigest:string;facts:Fact[];disclosures:SetupConsentDisclosures};
export type RouteConsentSnapshot={scope:RouteConsentScope;consentFactsDigest:string;facts:Fact[];disclosures:RouteConsentDisclosures};
export type ConsentSnapshot=SetupConsentSnapshot|RouteConsentSnapshot;
export type Availability = Record<Usage['kind'], { state: 'available' | 'detect-only' | 'unsupported'; reason: string }>;
export type Prerequisite = { id: string; label: string; state: 'present' | 'missing' | 'unknown' | 'denied'|'unsupported';
  observation?:Observation<boolean|string>;observedAt: string|null; version: Observation<string>; remedy: Action | null };
export type InputRequirement = { id: string; actionId:string; label: string; kind: 'text' | 'domain' | 'https-origin'; secret: boolean; help: string;
  required: boolean; obtainUrl: string | null; validation: 'syntax-only' };
export type Configuration = { revision:string;scopeId:string;inputRequirements: InputRequirement[]; values: Record<string,string>;
  credentials: Record<string,Observation<boolean>>; actions: Action[] };

export type Candidate = {
  consent:RouteConsentSnapshot;
  consentFactsDigest:string;
  review:{canonicalInput:unknown};
  availability: Availability;
  prerequisites: Prerequisite[];
  facts: Fact[];
  configuration: Configuration;
  /** The adapter's own stable id, the value `Query.providerId` takes. Pass-through data: show it, store it, send it back. */
  providerId: string;
  /** Opaque to apps. */
  name: string;
  /** Opaque to apps; the only value usable in a preference list. */
  preferenceRef: string;
  rank: number;
  eligible: boolean;
  unmet: { requirement: UnmetRequirement; actual: unknown; reasonCode: UnmetReason }[];
  display: {
    label: string; description: string;
    /** One static sentence: what a route of the queried usage kind needs on this computer, naming its ports. Shown whether or not setup is ready. */
    needs: string;
  };
  properties: Properties;
  /**
   * On a platform Gozar does not support (anything but Linux and macOS in 0.2.0), every candidate has
   * setup.state 'unsupported', eligible false and the unmet entry
   * `{requirement:'platform', reasonCode:'unsupported_platform'}` (revision 3; amendment 3).
   */
  setup: { state: 'ready' | 'action-required' | 'unsupported' | 'unknown' | 'detect-only'; actions: Action[] };
  disclosure: Disclosure;
  /**
   * Set only when `eligible` is true AND `setup.state` is 'ready'. An 'action-required' candidate has
   * null: after runSetupAction the app asks the catalog again to get a token. Bearer data: hold
   * transiently or in a 0600 file; never log.
   */
  candidateToken: string | null;
  expiresAt: string | null;
};

export type Catalog = {
  schemaVersion: 2;
  features: string[];
  catalogRevision: string;
  observedAt: string;
  preferenceRevision: number;
  candidates: Candidate[];
  noMatch: null | { code: 'requirements_unsatisfied'; requirements: string[] };
};

export type Handle = { kind: 'session' | 'attached' | 'durable' | 'external'; id: string; generation: number };

export type Ingress = {
  generation: number;
  verifiedAt: string;
  validUntil: string;
  publicAuthority: string;
  authorityHandling: 'configured-origin';
  clientAddress:
    | { source: 'unavailable'; reason: string }
    | { source: 'socket' }
    | {
        source: 'trusted-header';
        evidenceRef: string;
        peer:
          | { kind: 'unix-socket'; path: string; ownerUid: number }
          | { kind: 'mtls'; spkiSha256: string }
          | { kind: 'network-boundary'; cidrs: string[]; boundaryRef: string };
        header: {
          name: string;
          format: 'rfc7239' | 'ip-list';
          sanitization: 'strip-inbound-and-write';
          selection: 'rightmost-untrusted';
          trustedHops: number;
          trustedProxyCidrs: string[];
        };
      };
};

export type RouteView = {
  operationId:string|null;
  binding:import('./embedding-contract.js').RouteBinding;
  schemaVersion: 2;
  routeState: 'detected' | 'verified' | 'expired' | 'cleanup-unconfirmed' | 'inactive' | 'unknown';
  expiresAt: Observation<string>;
  hostConfiguration: { target: Observation<string>; localPort: Observation<number>; bindTarget: Observation<string>; origin: Observation<string> };
  facts: Fact[];
  actions: ('stop' | 'edit' | 'rotate')[];
  handle: Handle;
  origin: string | null;
  published: string | null;
  state: 'creating' | 'usable' | 'unverified' | 'unknown' | 'lost' | 'suspending' | 'suspended' | 'address_changed' | 'uncertain' | 'releasing' | 'released' | 'handing-back';
  ownership: 'gozar-owned' | 'external-owned';
  properties: Properties;
  ingress: Ingress | null;
  /** `vantage` is where the last check actually ran from; a check made from this computer is 'this-device'. `checks` lists what that check made. */
  verification: { status: 'verified' | 'unverified'; observedAt:string|null;subject:ProofSubject|null;checkedAt: string | null; vantage: ProofVantage; checks: ProofCheck[]; validUntil: Observation<string>; results: {check: ProofCheck; status: 'passed' | 'failed' | 'unknown'}[] };
  limits: { recommendedPollIntervalMs: number; idleTimeoutMs: number | null };
  cleanup: { state: 'none' | 'unconfirmed' | 'confirmed'; message?: string;nextAction:Action|null };
};
export type ProofSubject={origin:string;target:string;instanceId:string;handleGeneration:number;bootId:string};

export type Approval = { kind:'route';consentFactsDigest:string;candidateToken: string; disclosureRevision: string };

/** Frozen. Apps branch only on these codes; provider diagnostics stay inside Gozar. */
export type GozarErrorCode =
  | 'invalid_input' | 'requirements_unsatisfied' | 'setup_required' | 'consent_required' | 'consent_unknown'
  | 'consent_expired' | 'consent_mismatch' | 'candidate_stale' | 'preference_conflict' | 'route_not_found'
  | 'route_conflict' | 'address_changed' | 'stopped_by_user' | 'handing_back' | 'verification_failed'
  | 'provider_unavailable' | 'cleanup_debt' | 'unsupported' | 'ambiguous_route' | 'busy' | 'internal_error'
  | 'configuration_stale'|'configuration_in_use'|'secret_in_use'|'secret_backend_locked'|'secret_backend_unavailable'
  | 'host_policy_denied'|'artifact_integrity_failed'|'configuration_migration_required'|'proof_refresh_unsupported'|'operation_conflict';
// 'busy': a lock is held; retry after a pause. 'internal_error': an unexpected Gozar fault.

export type GozarError = { schemaVersion: 1; error: { code: GozarErrorCode; message: string; nextAction: Action | null } };

/** What JS callers catch: `.code` and `.nextAction` carry the same data as the CLI GozarError envelope. */
export interface GozarThrownError extends Error { code: GozarErrorCode; nextAction: Action | null;route?:RouteView }

// --- Results and records ------------------------------------------------------------------------

export type PreferenceRecord = {
  schemaVersion: 1;
  scope: 'user';
  revision: number;
  /** What was stored: preferenceRef or providerId values. */
  adapterPreference: string[];
  onUnavailable: 'ask';
};

export type SetupActionResult = {
  configuration:Configuration;configurationRevision:string;scopeId:string;
  schemaVersion: 1;
  state: 'complete' | 'pending' | 'blocked';
  nextAction: Action | null;
  catalogRevision: string;
};

export type WatchEvent = {
  schemaVersion: 1;
  sequence: number;
  type: 'snapshot' | 'changed' | 'terminal'|'consent_changed';
  oldDigest?:string;newDigest?:string;nextAction?:Action|null;reason?:string;
  route: RouteView;
};

export type InspectLegacyRouteResult = {
  schemaVersion: 1;
  migrationRef: string;
  origin: string | null;
  target: string;
  bridgeHome: string | null;
  state: 'adoptable' | 'external' | 'blocked';
  reasonCode: 'unrecognized_format' | 'not_found' | 'target_mismatch' | 'origin_mismatch' | 'not_adoptable' | null;
  /** For 'unrecognized_format': the sign-in-again setup action. */
  nextAction: Action | null;
};

export type ResolveClientAddressResult = {
  address: string | null;
  source: 'socket' | 'trusted-header' | 'unavailable';
  reason: string | null;
};

// --- Requests -----------------------------------------------------------------------------------

/** Paths are opaque input. Gozar recognises provider-owned formats only; anything else becomes a sign-in-again setup action. */
export type InspectLegacyRouteRequest = {
  home: string;
  owner: string;
  source: { stateFiles: string[] };
  origin?: string;
  target: string;
};

/**
 * Requires usage.kind 'durable'. Clearing a user-stop tombstone needs a fresh `approval`;
 * `reconsent: true` without `approval` fails with consent_required (revision 3).
 */
export type EnsureRouteRequest = Query & { intent?: 'create'; usage: { kind: 'durable'; routeId: string }; approval?: Approval; reconsent?: boolean };

/**
 * Durable only; no claim input. The old-owner fence is the caller's precondition. `approval` is always
 * required. A user-stop tombstone is cleared only when `reconsent: true` is also set; without it,
 * adopt fails with stopped_by_user (symmetric with ensureRoute).
 */
export type AdoptRouteRequest = Query & {
  intent?: 'adopt';
  usage: { kind: 'durable'; routeId: string };
  reconsent?: boolean;
  origin: string;
  approval: Approval;
  handover: { from: string; generation: number };
};

/**
 * Session or attached usage only. With attached usage the calling process holds the lease: the library
 * sends heartbeats on an unref'd timer, process exit ends the lease within the expiry window, and
 * closeRoute({handle}) ends it early. There is no lease object and no extra export.
 */
export type ExposeRequest = Query & {
  intent?: 'create';
  usage: { kind: 'session'; lifetimeMs: number } | { kind: 'attached' };
  approval: Approval;
  wait: 'allocated' | 'verified';
};

export type RouteRef = { home: string; handle: Handle };
export type SuspendRouteRequest = RouteRef & { handle: Handle & { kind: 'durable' } };
export type CloseRouteRequest = RouteRef & { mode: 'remove' };
export type WatchRoutesRequest = RouteRef & { signal: AbortSignal; intervalMs?: number };
export type SetRoutePreferencesRequest = {
  profileHome: string;
  expectedRevision: number;
  /** preferenceRef or providerId values. */
  adapterPreference: string[];
  onUnavailable: 'ask';
};
export type RunSetupActionRequest = {
  home: string;
  owner?:string;providerId:string;expectedConfigurationRevision:string;draftId?:string;
  actionId: string;
  approval: { kind:'setup';consentFactsDigest:string;digest: string; disclosureRevision: string };
  /** Points into Gozar's private store; never a token value. For 'provide-secret'. */
  secretHandle?: string;
  /** For 'provide-value': checked against the action's valueFormat, then kept as configuration (not in the secret store). */
  value?: string;
};

/** Transport-derived facts only. The exact member types are not fixed by the plan; see Open contract questions. */
export type ClientAddressProof = {
  socketPeer: { address: string; port: number };
  peerIdentity:
    | { kind: 'unix-socket'; path: string; ownerUid: number }
    | { kind: 'mtls'; spkiSha256: string }
    | { kind: 'network-boundary'; address: string }
    | null;
  headers: Record<string, string | string[]>;
  now: number;
  routeGeneration: number;
};

// --- Root exports -------------------------------------------------------------------------------

export function catalogRoutes(query: Query): Promise<Catalog>;
/** Alias of catalogRoutes. */
export function detect(query: Query): Promise<Catalog>;
export function inspectLegacyRoute(request: InspectLegacyRouteRequest): Promise<InspectLegacyRouteResult>;
export function ensureRoute(request: EnsureRouteRequest): Promise<RouteView>;
export function adoptRoute(request: AdoptRouteRequest): Promise<RouteView>;
/**
 * Fresh proof for one handle. An external service is read with `handle: {kind:'external', id:<origin>}`
 * and returns the normalized RouteView (ownership 'external-owned'); there is no separate projection export.
 */
export function routeStatus(request: RouteRef): Promise<RouteView>;
/** Removes forwarding but keeps the pin and consent. Resume with ensureRoute. */
export function suspendRoute(request: SuspendRouteRequest): Promise<RouteView>;
export function closeRoute(request: CloseRouteRequest): Promise<RouteView>;
export function watchRoutes(request: WatchRoutesRequest): AsyncIterable<WatchEvent>;
export function getRoutePreferences(request: { profileHome: string }): Promise<PreferenceRecord>;
export function setRoutePreferences(request: SetRoutePreferencesRequest): Promise<PreferenceRecord>;
export function runSetupAction(request: RunSetupActionRequest): Promise<SetupActionResult>;
export function resolveClientAddress(proof: ClientAddressProof, ingress: Ingress): ResolveClientAddressResult;

/**
 * Legacy session options, kept through a version-discriminated overload: a call without
 * `schemaVersion: 1` is the legacy call. Keys mirror the legacy CLI flags in api.mjs.
 */
export type LegacyExposeOptions = {
  schemaVersion?: undefined;
  home?: string; port?: number; clientReach?: string; adapterId?: string; origin?: string; lifetimeMs?: number;
  bindAddress?: string; firewallAck?: boolean; transport?: string; clientProfileId?: string; probeWaitMs?: number;
  probeDirectory?: string; probeRequest?: string; probeReceipt?: string; probeExecutorId?: string;
  installLinkTemplate?: string; yes?: boolean; sse?: boolean; streamableHttp?: boolean; oauthDcr?: boolean; operational?: boolean;
};
export type LegacySessionReply = Record<string, unknown>;
/** Attached usage returns a plain RouteView; see ExposeRequest for who holds the lease. */
export function expose(request: ExposeRequest): Promise<RouteView>;
export function expose(options: LegacyExposeOptions): Promise<LegacySessionReply>;
export function status(options?: LegacyExposeOptions): Promise<LegacySessionReply>;
export function stop(options?: LegacyExposeOptions): Promise<LegacySessionReply>;

// --- Kept service and hand-back exports (also at @tnunamak/gozar/service) ------------------------
// The pre-0.2 durable signatures (ensureRoute/adoptRoute with adapterId and approvals tuples, and
// statusRoutes) are not kept: durable routes were never published, only 0.1.0 is on npm. The root
// ensureRoute/adoptRoute above replace them.

export type ServiceRoute = Record<string, unknown>;
export function addService(request: { origin: string; target: string; home?: string; verifyCmd?: string | null }): Promise<{ schemaVersion: 1; route: ServiceRoute }>;
export function statusServices(request?: { home?: string; origin?: string }): Promise<{ schemaVersion: 1; routes: ServiceRoute[] }>;
export function removeService(request: { origin: string; home?: string }): Promise<{ schemaVersion: 1; origin: string; removed: boolean }>;
/** In-app proof handler; returns true when it answered the request. */
export function createServiceVerifier(): (req: unknown, res: unknown) => boolean;

export type ReleaseRouteResult = { schemaVersion: 1; routeId: string; removed: boolean; providerRemoved: boolean; cleanupDebt: unknown };
/** `claim` is opaque Gozar-owned rollback data, never an adopt input. */
export type HandBackResult = { schemaVersion: 1; routeId: string; claim: unknown; transfer: string };
export function releaseRoute(request: { routeId: string; mode: 'hand-back'; home?: string }): Promise<HandBackResult>;
export function releaseRoute(request: { routeId: string; mode?: 'remove' | 'dismiss'; home?: string }): Promise<ReleaseRouteResult>;
export function confirmHandBack(request: { routeId: string; transfer: string; home?: string }): Promise<{ schemaVersion: 1; routeId: string; handedBack: true; claim: unknown }>;
export function cancelHandBack(request: { routeId: string; transfer: string; home?: string }): Promise<{ schemaVersion: 1; route: ServiceRoute }>;

/** Stores secret bytes privately; returns an opaque handle only. */
export const storeSecret:import('./embedding-contract.js').HostEmbeddingMethods['storeSecret'];
export const discardSecret:import('./embedding-contract.js').HostEmbeddingMethods['discardSecret'];
export const beginConfigurationDraft:import('./embedding-contract.js').HostEmbeddingMethods['beginConfigurationDraft'];
export const commitConfigurationDraft:import('./embedding-contract.js').HostEmbeddingMethods['commitConfigurationDraft'];
export const discardConfigurationDraft:import('./embedding-contract.js').HostEmbeddingMethods['discardConfigurationDraft'];
export const listProviders:import('./embedding-contract.js').HostEmbeddingMethods['listProviders'];
export const readConfigurationDraft:import('./embedding-contract.js').HostEmbeddingMethods['readConfigurationDraft'];
export const clearConfigurationInput:import('./embedding-contract.js').HostEmbeddingMethods['clearConfigurationInput'];
export function reviewRouteConsent(request:RouteRef):Promise<RouteConsentSnapshot&{subject:ProofSubject|null;approvalToken:string;expiresAt:string}>;
export function approveRouteConsent(request:RouteRef&{approvalToken:string;consentFactsDigest:string}):Promise<RouteView>;
export function listRoutes(request:{home:string;owner?:string}):Promise<{routes:RouteView[]}>;
export type {SecretBackend,HostCapabilities,HostCapabilityId,HostIdentity,ConfigurationDraft,ProviderInventory} from './embedding-contract.js';
export type {Adapter,AdapterDefinition,AdapterRequest,AdapterPlan,AdapterProofSession,ProofAttempt,ReadContext,SetupContext,AdmittedEffectContext,Receipt,Removal,Verification,Observation as AdapterObservation} from './adapter-contract.js';

/** Trusted executable extension registry. Relative provider paths resolve under root/providers. */
export type GozarOptions={manifest?: string | {providers: {id:string; module:string; definition:string}[]}; root?: string;secretBackend?:import('./embedding-contract.js').SecretBackend;hostCapabilities?:import('./embedding-contract.js').HostCapabilities;identity?:import('./embedding-contract.js').HostIdentity};
export function createGozar(options?: GozarOptions): import('./embedding-contract.js').HostEmbeddingMethods & {
 catalogRoutes: typeof catalogRoutes; expose: (request:ExposeRequest)=>Promise<RouteView>;
 ensureRoute: typeof ensureRoute; adoptRoute: typeof adoptRoute; routeStatus: typeof routeStatus;
 closeRoute: typeof closeRoute; suspendRoute: typeof suspendRoute; watchRoutes: typeof watchRoutes;
 runSetupAction: typeof runSetupAction; inspectLegacyRoute: typeof inspectLegacyRoute;
 getRoutePreferences: typeof getRoutePreferences; setRoutePreferences: typeof setRoutePreferences;
 resolveClientAddress: typeof resolveClientAddress;
 reviewRouteConsent:typeof reviewRouteConsent;approveRouteConsent:typeof approveRouteConsent;
 listRoutes:typeof listRoutes;
};
```

## Current packages/gozar-node/embedding-contract.d.ts

```js
import type {Configuration,Reach,Properties,Prerequisite,Fact,Action,Usage} from './route-contract.js';
/** Additive host embedding contract for Gozar 0.4.0. Trusted host APIs only. */
export type Observation<T> = {known:true;value:T}|{known:false;reason:string};
export type HostCapabilityId = 'installer.execute'|'privilege.elevate'|'secrets.backend'|'runtime.attached'|'runtime.durable'|(string & {});
export type HostCapabilities = Partial<Record<HostCapabilityId,Observation<boolean|string>>>;
export interface HostIdentity {instanceId:string;bootId:string}
export interface SecretBackend {
 put(request:{scopeId:string;inputId:string;revision:string;bytes:Uint8Array}):Promise<{handle:string}>;
 withSecret<T>(request:{scopeId:string;handle:string},use:(bytes:Uint8Array)=>Promise<T>):Promise<T>;
 presence(request:{scopeId:string;handle:string}):Promise<Observation<boolean>>;
 delete(request:{scopeId:string;handle:string}):Promise<{deleted:boolean}>;
}
export interface ConfigurationSnapshot {revision:string;scopeId:string;values:Record<string,string>;credentials:Record<string,Observation<boolean>>}
export interface ConfigurationRequest {home:string;owner?:string;providerId:string;expectedConfigurationRevision:string;draftId?:string}
export interface ConfigurationDraft {draftId:string;scopeId:string;baseRevision:string;configuration:Configuration}
export interface HostEmbeddingMethods {
 storeSecret(request:ConfigurationRequest&{inputId:string;scopeId:string;bytes:Uint8Array}):Promise<{handle:string;configurationRevision:string;scopeId:string}>;
 readConfigurationDraft(request:{home:string;owner?:string;providerId:string;draftId:string}):Promise<ConfigurationDraft>;
 clearConfigurationInput(request:ConfigurationRequest&{draftId:string;inputId:string;approval:{kind:'setup';digest:string;disclosureRevision:string;consentFactsDigest:string}}):Promise<Configuration>;
 beginConfigurationDraft(request:ConfigurationRequest):Promise<ConfigurationDraft>;
 commitConfigurationDraft(request:ConfigurationRequest&{draftId:string}):Promise<Configuration>;
 discardConfigurationDraft(request:{home:string;owner?:string;providerId:string;draftId:string}):Promise<{discarded:boolean}>;
 discardSecret(request:{home:string;handle:string}):Promise<{discarded:boolean}>;
 listProviders(request:{home:string;owner?:string;hostCapabilities?:HostCapabilities}):Promise<{schemaVersion:number;catalogRevision:string;observedAt:string;providers:ProviderInventory[]}>;
}
export interface ProviderInventory {
 providerId:string;label:string;reach:Reach;transport:Properties['transport'];
 availability:Record<Usage['kind'],{state:'available'|'detect-only'|'unsupported'|'ready'|'action-required'|'unknown';reason:string}>;
 prerequisites:Prerequisite[];configuration:Configuration;facts:Fact[];
}
export interface RouteBinding {authority:'adapter'|'owner'|'unknown';target:Observation<string>;remedy:Action|null}
```

## Current packages/gozar-node/route-api.mjs

```js
// The consumer API (route-contract.d.ts), wired from the modules that own each part. Apps call these by
// requirement and never name a provider: the catalog picks candidates from the adapter registry, a single-use
// consent token carries the user's approval, and every reply is a RouteView or a GozarThrownError.
//
// `createRouteApi(deps)` exists so a test can replace the adapter registry, platform or state loaders; the
// package root exports the instance with real dependencies. Nothing here names a provider.
import { catalogRoutes as buildCatalog } from './route-catalog.mjs';
import { routeStatus as viewStatus, closeRoute as viewClose, suspendRoute as viewSuspend, projectDurable, propertiesFor } from './route-view.mjs';
import { watchRoutes as pollRoutes } from './route-watch.mjs';
import { getRoutePreferences, setRoutePreferences } from './route-preferences.mjs';
import { runSetupAction as runSetup } from './route-setup.mjs';
import { openAttachedRoute, openSessionRoute, redeemApproval,reviewAttachedConsent,approveAttachedConsent,releaseAttachedConfiguration,releaseSessionConfiguration,sessionConsent } from './attached-route.mjs';
import { preflightExpose } from './attached-route.mjs';
import { peekConsentGrant } from './consent-token.mjs';
import { projectExternal } from './route-view.mjs';
import { resolveClientAddress } from './ingress.mjs';
import { gozarError, normalizeError } from './error-normalizer.mjs';
import { registryIdentity } from './registry-identity.mjs';
import { createEmbeddingServices } from './embedding-services.mjs';
import { listProviders as inventory } from './embedding-inventory.mjs';
import { setupConsentReview,consentSnapshot } from './consent-facts.mjs';
import {offeredConfiguration,readConfigurationDraft,clearConfigurationInput} from './embedding-setup.mjs';
import {withRouteOperation,listRecordedRoutes,recordOperationView,operationReferenceForRoute,retainedOperationView} from './route-operations.mjs';
import {withServiceContext,reviewExternalConsent,approveExternalConsent} from './service.mjs';
import {catalogFactsFor} from './catalog-facts.mjs';

const lazy = loader => { let loaded; return () => (loaded ??= loader()); };
const engine = lazy(() => import('./durable-route.mjs'));
const legacy = lazy(() => import('./legacy-import.mjs'));
const runtime = lazy(() => import('./adapter-runtime.mjs'));

export function createRouteApi(deps = {}) {
  const platform = () => deps.platform ?? process.platform;
  let loaded;
  const adapters = async () => deps.adapters ?? (loaded ??= runtime().then(module => module.loadAdapters(deps.manifest ? { manifest: deps.manifest, root: deps.root } : undefined)).catch(error => { loaded = undefined; throw error; }));
  let servicesPromise;
  const services = () => servicesPromise ??= (async()=>{
    const registryId = await registryIdentity({...deps,adapters:deps.adapters});
    return {registryId,embeddingServices:deps.embeddingServices??createEmbeddingServices({registryId,secretBackend:deps.secretBackend,hostCapabilities:deps.hostCapabilities,identity:deps.identity})};
  })();
  const shared = async (request={}) => { const resolved=await services(); return ({ adapters: await adapters(), platform: platform(), ...resolved, owner:request.owner,home:request.home,
    ...(deps.manifest ? { registry: { manifest: deps.manifest, root: deps.root } } : {}),
    hostCapabilities:deps.hostCapabilities??{}, ...(deps.dispatchEffect?{dispatchEffect:deps.dispatchEffect}:{}),
    ...(deps.readContext ? { readContext: deps.readContext } : {}),
    decorateSetupAction:({action,adapter,configuration,draftId=null,inspection})=>{
      const review=setupConsentReview({registryId:resolved.registryId,providerId:adapter.id,configuration,draftId,action,facts:catalogFactsFor(inspection??{adapter})});
      return {...action,consent:consentSnapshot(review),review:{canonicalInput:review.canonicalInput}};
    } }); };
  const publicError=cause=>{const normalized=normalizeError(cause),error=gozarError(normalized.code,normalized.message,normalized.nextAction?structuredClone(normalized.nextAction):null);if(normalized.route)error.route=structuredClone(normalized.route);return error;};
  const guard = async action => { try { return structuredClone(await action()); } catch (error) { throw publicError(error); } };
  const setupDeps=async request=>{
    const context=await shared(request);
    const invoke=async(operation,input)=>{const adapter=context.adapters.find(a=>a.id===request.providerId);if(!adapter?.definition.effectOperations?.some(row=>row.kind==='artifact'&&row.operation===operation))throw gozarError('unsupported','The adapter has not declared this artifact effect');return context.dispatchEffect({kind:'artifact',operation,input});};
    const artifactExecutor=context.dispatchEffect?{
      async fetchArtifact(artifact){const result=await invoke('fetch',{artifact});if(typeof result?.bytes!=='string'||Buffer.byteLength(result.bytes,'base64')>32*1024*1024)throw gozarError('artifact_integrity_failed','The artifact observation is invalid');return new Uint8Array(Buffer.from(result.bytes,'base64'));},
      async executeArtifact({artifact,effects,bytes}){const result=await invoke('execute',{artifact,effects,bytes:Buffer.from(bytes).toString('base64')});if(result?.executed!==true||result.exitCode!==0)throw gozarError('provider_unavailable','The approved artifact did not execute successfully');return result;},
    }:deps.setup?.artifactExecutor;
    return {...deps.setup,...context,...(artifactExecutor?{artifactExecutor}:{}),validateSetupApproval:({action,adapter,configuration,inspection})=>{
      const review=setupConsentReview({registryId:context.registryId,providerId:adapter.id,configuration,draftId:request.draftId??null,action,facts:catalogFactsFor(inspection??{adapter})});
      if(request.approval?.kind!=='setup'||request.approval.consentFactsDigest!==review.consentFactsDigest)throw gozarError('consent_mismatch','Setup consent changed; review the current action again');
    }};
  };
  // A `verify` option ({ origin, target }) replaces the challenge verifier for the durable calls below. It is for tests.
  const verified=async(action,request={})=>{const module=await engine(),context={...await shared(request),...(deps.verify?{verify:deps.verify}:{})};return withServiceContext(context,()=>module.withRuntimeContext(context,()=>deps.verify?module.withVerifier(deps.verify,action):action()));};

  /** A durable engine reply is a record view; its RouteView needs the adapter's declared properties. */
  async function durableView(reply) {
    const handle = { kind: 'durable', id: reply.routeId, generation: reply.generation };
    return projectDurable(reply, { handle, ...await propertiesFor(reply.adapterId, { adapters: await adapters() }, 'durable') });
  }

  /**
   * A route its owner keeps (the adapter's definition says `ownership: 'external-owned'`) is not created by the durable
   * engine: Gozar records it as a service route and checks it. The approval's grant names the adapter, so this looks
   * at the grant, never at an id. Anything else returns undefined and goes to the durable engine.
   */
  async function ownerKept(request) {
    if (typeof request?.approval?.candidateToken !== 'string' || typeof request.home !== 'string') return undefined;
    let grant;
    try { grant = await peekConsentGrant({ home: request.home, token: request.approval.candidateToken }); } catch { return undefined; }
    const adapter = grant && (await adapters()).find(item => item.id === grant.adapterId);
    if (adapter?.definition.ownership !== 'external-owned') return undefined;
    if (request.usage?.kind !== 'durable' || (request.intent !== undefined && request.intent !== 'create')) throw gozarError('invalid_input', 'An owner-run route is created with usage durable and intent create');
    const redeemed = await redeemApproval(request, await shared(request));
    const service = deps.service?.addService ?? (await import('./service.mjs')).addService;
    const context=await shared(request),handle={kind:'external',id:redeemed.plan.origin,generation:1};
    await context.embeddingServices.registerConfigurationUse({home:redeemed.home,owner:request.owner,providerId:adapter.id,revision:redeemed.grant.configurationRevision,handle});
    const {approval,wait,...query}=request;
    const { route } = await service({ origin: redeemed.plan.origin, target: request.target, home: redeemed.home,embedding:{request:query,consentReview:redeemed.consentReview,operationId:request.operationId??null} });
    return projectExternal(route, { handle: { kind: 'external', id: route.origin, generation: route.generation } });
  }

  const api = {
    catalogRoutes: query => guard(()=>verified(async () => buildCatalog(query, { ...await shared(query), profileHome: deps.profileHome,
      pinnedAdapterId: async q => q.usage.kind === 'durable' ? (await engine()).durablePin({ home: q.home, routeId: q.usage.routeId }) : null }),query)),

    inspectLegacyRoute: request => guard(async () => (await legacy()).inspectLegacyRoute(request)),

    // The loaded adapters go to every durable engine call as an optional second argument; an engine that does not use it ignores it.
    ensureRoute: request => guard(async()=>withRouteOperation(request,{...await shared(request),status:api.routeStatus,run:()=>verified(async () => (await ownerKept(request)) ?? durableView((await (await engine()).ensureRoute(request, { adapters: await adapters() })).route),request)})),
    adoptRoute: request => guard(() => verified(async () => durableView((await (await engine()).adoptRoute(request, { adapters: await adapters() })).route),request)),

    /** A request with schemaVersion 1 is the route API; anything else is the legacy session call (handled by the caller). */
    expose: request => guard(async () => {
      const options = { ...await shared(request), ...deps.expose };
      await preflightExpose(request, options);
      if (request?.usage?.kind === 'attached') return withRouteOperation(request,{...options,status:api.routeStatus,run:reservedHandle=>openAttachedRoute(request,{...options,reservedHandle})});
      if (request?.usage?.kind === 'session') return withRouteOperation(request,{...options,status:api.routeStatus,run:reservedHandle=>openSessionRoute(request,{...options,reservedHandle})});
      throw gozarError('invalid_input', "expose needs usage 'session' or 'attached'");
    }),

    routeStatus: request => guard(() => verified(async () => viewStatus(request, { adapters: await adapters(), ...deps.view }),request)),
    closeRoute: request => guard(() => verified(async () => {const reference=await operationReferenceForRoute(request);let view;try{view=await viewClose(request, { adapters: await adapters(), ...deps.view });}catch(error){if(error.code!=='route_not_found')throw error;const retained=await retainedOperationView(request);if(!retained)throw error;return retained;}if(view.cleanup.state==='confirmed'){if(request.handle.kind==='attached')await releaseAttachedConfiguration(request,await services());if(request.handle.kind==='session')await releaseSessionConfiguration(request,await services());}return recordOperationView({home:request.home,view,reference});},request)),
    suspendRoute: request => guard(() => verified(async () => viewSuspend(request, { adapters: await adapters(), ...deps.view }),request)),
    watchRoutes:async function*(request){try{for await(const event of pollRoutes(request,{routeStatus:r=>verified(async()=>viewStatus(r,{adapters:await adapters(),...deps.view}),r),...deps.watch}))yield structuredClone(event);}catch(error){throw publicError(error);}},
    getRoutePreferences, setRoutePreferences,
    runSetupAction: request => guard(async () => runSetup(request,await setupDeps(request))),
    listProviders: request => guard(async()=>inventory(request,await shared(request))),
    listRoutes:request=>guard(()=>listRecordedRoutes(request)),
    ...Object.fromEntries(['storeSecret','discardSecret','discardConfigurationDraft'].map(method=>[method,request=>guard(async()=> (await services()).embeddingServices[method](request))])),
    beginConfigurationDraft:request=>guard(async()=>{const context=await shared(request);const draft=await context.embeddingServices.beginConfigurationDraft(request);return {...draft,configuration:await offeredConfiguration({...request,draftId:draft.draftId},draft.configuration,context)};}),
    readConfigurationDraft:request=>guard(async()=>readConfigurationDraft(request,await shared(request))),
    commitConfigurationDraft:request=>guard(async()=>{const context=await shared(request);const snapshot=await context.embeddingServices.commitConfigurationDraft(request);return offeredConfiguration({...request,draftId:undefined},snapshot,context);}),
    clearConfigurationInput:request=>guard(async()=>clearConfigurationInput(request,await setupDeps(request))),
    reviewRouteConsent:request=>guard(async()=>request.handle?.kind==='external'?verified(()=>reviewExternalConsent(request),request):request.handle?.kind==='session'?sessionConsent(request,{adapters:await adapters()}):request.handle?.kind==='durable'?verified(async()=>(await engine()).reviewDurableConsent(request),request):reviewAttachedConsent(request)),
    approveRouteConsent:request=>guard(async()=>request.handle?.kind==='external'?verified(async()=>projectExternal(await approveExternalConsent(request),{handle:request.handle}),request):request.handle?.kind==='session'?sessionConsent(request,{approve:true,adapters:await adapters()}):request.handle?.kind==='durable'?verified(async()=>durableView(await (await engine()).approveDurableConsent(request)),request):approveAttachedConsent(request)),
    resolveClientAddress,
  };
  return api;
}
```

## Current packages/gozar-node/route-view.mjs

```js
// Consumer-side route views: errors an app may see, projections of every route kind to RouteView,
// and routeStatus / closeRoute, which dispatch on handle.kind. Apps never learn which provider
// answered; the public factory strips raw provider diagnostics from thrown errors.
import { join } from 'node:path';
import {readRecord} from './service-state.mjs';
import { enrichRoute, cleanupForSession } from './embedding-state.mjs';
import {cleanupRecovery} from './embedding-projections.mjs';

import { gozarError, normalizeError } from './error-normalizer.mjs';
export { gozarError, normalizeError };

// --- Shapes -------------------------------------------------------------------------------------

const KINDS = ['session', 'attached', 'durable', 'external'];
export function checkRef(request) {
  const handle = request?.handle;
  if (typeof request?.home !== 'string' || !request.home || !handle || !KINDS.includes(handle.kind) || typeof handle.id !== 'string' ||
      !handle.id || !Number.isInteger(handle.generation) || handle.generation < 0)
    throw gozarError('invalid_input', 'A route reference needs a home and a handle {kind, id, generation}');
  return handle;
}

/** What Gozar can say about a route it did not create: nothing about privacy or stability, nothing assumed. */
export const unknownProperties = () => ({
  reach: 'unknown', transport: 'https',
  traffic: { tlsTermination: 'unknown', providerCanReadPayload: null, readers: [], metadataVisibleTo: [], evidenceRef: null },
  address: { stability: 'unknown', scope: 'owner-managed', conditions: [], ports: null },
  cost: { kind: 'unknown', summary: 'Cost is not known to Gozar', currency: null, amount: null, period: null },
  needsAccount: null, lifetimes: ['durable'], supervision: 'host-supervised',
  protocols: { sse: false, streamableHttp: false, oauthDcr: false },
  proof: { vantage: 'none', checks: [] },
});

/**
 * A definition's `byUsage` entry for one usage kind replaces the ports and the needs line it declares at the top level,
 * because a usage kind can take its slot from a different list (a durable route uses the durable engine's ports).
 */
const usageEntry = (definition, kind) => definition?.byUsage?.[kind] ?? {};
export const needsFor = (definition, kind) => usageEntry(definition, kind).needs ?? definition.needs ?? '';

/**
 * A definition may leave out the two facts that came after 0.2; the consumer shape always carries them, saying "none" when
 * unknown. With the definition and a usage kind, the ports are that kind's.
 */
export const completeProperties = (properties, definition, kind) => {
  const own = usageEntry(definition, kind);
  const ports = Object.hasOwn(own, 'ports') ? own.ports : properties.address.ports ?? null;
  return { ...properties, address: { ...properties.address, ports }, proof: properties.proof ?? { vantage: 'none', checks: [] } };
};

/**
 * The declared checks that run for one request: the stream check only when the request needs SSE, and the TLS check
 * only when the origin is https (an origin not known yet keeps it; the registry already drops it for plain-HTTP providers).
 */
export const checksFor = (checks, { sse = false, origin = null } = {}) =>
  (checks ?? []).filter(check => (check !== 'sse' || sse) && (check !== 'tls' || typeof origin !== 'string' || origin.startsWith('https://')));

const iso = ms => new Date(ms).toISOString();
const STATES = new Set(['creating', 'usable', 'unverified', 'unknown', 'lost', 'suspending', 'suspended', 'address_changed', 'uncertain', 'releasing', 'released', 'handing-back']);
// What the last check proved, and from where. Every check Gozar runs for a route runs from this computer, so the
// vantage is 'this-device' once a check ran and 'none' before. Checks are listed only while the route is verified.
const proven = (status, checkedAt, checks) => ({ status, checkedAt, vantage: checkedAt === null ? 'none' : 'this-device', checks: status === 'verified' ? [...checks] : [] });
const verificationOf = (state, checkedAtMs, checks = []) => proven(state === 'usable' ? 'verified' : 'unverified', checkedAtMs === null ? null : iso(checkedAtMs), checks);
// The service challenge (a nonce read at the target and at the origin) is the check durable and external routes pass; an https origin is also read through TLS.
const challengeChecks = origin => (typeof origin === 'string' && origin.startsWith('https://') ? ['nonce', 'tls'] : ['nonce']);
const debtMessage = debt => typeof debt === 'string' ? debt : debt?.message ?? debt?.reason ?? 'Cleanup is incomplete';

function view({ handle, origin, published, state, ownership, properties, ingress = null, verification, limits, cleanup = { state: 'none' }, target, bindTarget, expiresAt, validUntil, now, facts,consentChange,consentFactsDigest,operationId,binding }) {
  return enrichRoute({ schemaVersion: 2, handle: { kind: handle.kind, id: handle.id, generation: handle.generation }, origin, published, state, ownership,
    properties, ingress, verification, limits, cleanup,...(binding?{binding}:{}),...(consentChange?{consentChange}:{}),...(consentFactsDigest?{consentFactsDigest}:{}),operationId:operationId??null }, { target, bindTarget, expiresAt, validUntil, now, facts });
}
const limitsOf = (limits, fallbackPollMs, idleTimeoutMs = null) => ({
  recommendedPollIntervalMs: limits?.recommendedPollIntervalMs ?? fallbackPollMs, idleTimeoutMs: limits?.idleTimeoutMs ?? idleTimeoutMs });

/** From the durable engine's reply: a record view that already names its state, origin and verification. */
export function projectDurable(reply, { handle, properties, ingress = null, limits, facts = [], now = Date.now() }) {
  const state = STATES.has(reply.state) ? reply.state : 'unknown';
  const published = state === 'usable' && typeof reply.origin === 'string' ? reply.origin : null;
  const checkedAt = typeof reply.verification?.checkedAt === 'string' ? Date.parse(reply.verification.checkedAt) : null;
  const proof=proven(reply.verification?.status==='verified'&&state==='usable'?'verified':'unverified',Number.isFinite(checkedAt)?iso(checkedAt):null,challengeChecks(reply.origin??reply.allocatedOrigin));
  Object.assign(proof,{observedAt:reply.verification?.observedAt??proof.checkedAt,subject:reply.verification?.subject??null});
  // RouteView.origin is the route's address, also before verification; `published` is what the app may advertise.
  return view({binding:reply.binding,operationId:reply.operationId,consentChange:reply.consentChange,consentFactsDigest:reply.consentFactsDigest, target: reply.target, expiresAt: reply.expiresAt, validUntil: reply.verification?.validUntil, facts, now, handle, origin: reply.allocatedOrigin ?? reply.origin ?? null, published, state, ownership: 'gozar-owned', properties, ingress,
    verification: proof,
    limits: limitsOf(limits, 60_000, reply.idleTimeoutMs), cleanup: reply.cleanupDebt ? { state: 'unconfirmed', message: debtMessage(reply.cleanupDebt) } : { state: 'none' } });
}

const PHASES = { idle: 'creating', detecting: 'creating', planned: 'creating', preflight: 'creating', persisting: 'creating', starting: 'creating',
  validating: 'unverified', 'transport-ready': 'unverified', 'candidate-ready': 'unverified', 'published-ready': 'usable', degraded: 'unverified',
  stopping: 'releasing', 'cleanup-pending': 'uncertain', stopped: 'released', failed: 'lost', blocked: 'unknown', unknown: 'unknown' };

/** From a session snapshot (the controller's status reply). Published only while the core says published-ready. */
export function projectSession(reply, { handle, properties, ingress = null, limits, facts = [], now = Date.now() }) {
  const snapshot = reply.snapshot ?? {};
  const state = PHASES[snapshot.phase] ?? 'unknown';
  const published = state === 'usable' && typeof snapshot.published === 'string' ? snapshot.published : null;
  const receipt = reply.validation?.probeReceipt;
  const verification = verificationOf(state, state === 'usable' ? receipt?.observedAtMs ?? snapshot.checkedAtMs ?? null : null,
    receipt ? ['tls', 'nonce', 'sse'].filter(check => ({ tls: receipt.tls, nonce: receipt.instanceMatched, sse: receipt.sse })[check] === true)
      : checksFor(properties?.proof?.checks, { sse: reply.sseChecked === true, origin: published }));
  if (receipt && ['public', 'tailnet', 'lan', 'this-device'].includes(receipt.vantage)) verification.vantage = receipt.vantage;
  verification.subject=reply.proofSubject??null;verification.observedAt=verification.checkedAt;
  if(reply.fixtureEffects&&verification.checkedAt)verification.vantage='this-device';
  return view({operationId:reply.operationId,consentChange:reply.consentChange,consentFactsDigest:reply.consentFactsDigest, target: reply.target ?? snapshot.target, expiresAt: snapshot.expiresAt ?? (Number.isFinite(reply.expiresAtMs??snapshot.expiresAtMs) ? iso(reply.expiresAtMs??snapshot.expiresAtMs) : undefined), validUntil: Number.isFinite(reply.validation?.probeReceipt?.expiresAtMs) ? iso(reply.validation.probeReceipt.expiresAtMs) : undefined, facts, now, handle, origin: snapshot.published ?? snapshot.candidate ?? null, published, state, ownership: 'gozar-owned', properties, ingress,
    verification, limits: limitsOf(limits, 5_000),
    cleanup: cleanupForSession(reply) });
}

/** From an external service record (owner-managed ingress). Privacy and stability stay unknown. */
export function projectExternal(record, { handle, now = Date.now() }) {
  if(handle.generation!==(record.generation??0))throw gozarError('route_conflict','The external tracking generation does not match');
  const verified = record.generation===1&&record.verification?.status === 'verified'&&record.verification.method!=='host-command'&&!!record.verification.subject;
  const checkedAt = typeof record.verification?.checkedAt === 'string' ? Date.parse(record.verification.checkedAt) : null;
  const proof={...proven(verified?'verified':'unverified',Number.isFinite(checkedAt)?iso(checkedAt):null,challengeChecks(record.origin)),subject:record.verification?.subject??null,observedAt:record.verification?.observedAt??null};
  return view({operationId:record.embedding?.operationId,consentChange:record.consentChange,consentFactsDigest:record.embedding?.consentReview.consentFactsDigest, target: record.target, validUntil: record.verification?.validUntil, now, handle, origin: record.origin, published: verified ? record.origin : null, state: verified ? 'usable' : 'unverified',
    ownership: 'external-owned', properties: unknownProperties(), verification:proof,
    limits: limitsOf(null, 60_000) });
}

/** From an attached lease record kept by its controller. */
export function projectAttached(lease, { handle, now = Date.now() }) {
  const state = STATES.has(lease.state) ? lease.state : 'unknown';
  const verification = lease.proof ? { status: state === 'usable' && lease.proof.status === 'verified' ? 'verified' : 'unverified', checkedAt: lease.proof.checkedAt,
    vantage: lease.proof.vantage, checks: state === 'usable' ? lease.proof.checks : [] }
    : verificationOf(state, lease.checkedAtMs ?? null, checksFor(lease.properties?.proof?.checks, { sse: lease.sseChecked === true, origin: lease.origin ?? null }));
  verification.observedAt=verification.checkedAt??null;
  verification.subject=lease.proofSubject??null;
  return view({binding:lease.binding, target: lease.target, bindTarget: lease.bindTarget, expiresAt: lease.expiresAt ?? (Number.isFinite(lease.expiresAtMs) ? iso(lease.expiresAtMs) : undefined), validUntil: lease.proof?.validUntil ?? lease.ingress?.validUntil, facts: lease.facts, now, handle, origin: lease.origin ?? null, published: state === 'usable' ? lease.origin ?? null : null, state, ownership: 'gozar-owned',
    properties: lease.properties ? completeProperties(lease.properties) : lease.properties, ingress: lease.ingress ?? null, verification,
    limits: limitsOf(lease.limits, 5_000), cleanup: lease.cleanup?.state === 'debt' ? { ...lease.cleanup, state: 'unconfirmed' } : lease.cleanup ?? { state: 'none' } });
}


/** Retain old proof as history; loss is not a fresh observation or proof of absence. */
export function recoveryHistory(last, message) {
  return { ...last, state: 'uncertain', routeState: 'cleanup-unconfirmed', published: null, ingress: null,
    verification: { ...last.verification, status: 'unverified', checks: [] },
    cleanup: cleanupRecovery({ state: 'unconfirmed', message }, last.handle) };
}

export function releasedView(last, handle) {
  const base = last ?? view({ handle, origin: null, published: null, state: 'released', ownership: handle.kind === 'external' ? 'external-owned' : 'gozar-owned',
    properties: unknownProperties(), verification: proven('unverified', null, []), limits: { recommendedPollIntervalMs: 60_000, idleTimeoutMs: null } });
  return enrichRoute({ ...base, state: 'released', published: null, ingress: null, cleanup: { state: 'confirmed' }, verification: proven('unverified', base.verification.checkedAt, []) });
}

// --- Dispatch -----------------------------------------------------------------------------------

/** The declared properties of one adapter for one usage kind ('durable' or 'session'), or unknown ones when the adapter is gone. */
export async function propertiesFor(adapterId, deps, kind) {
  const adapters = deps.adapters ?? await (await import('./adapter-runtime.mjs')).loadAdapters();
  const adapter = adapters.find(item => item.id === adapterId);
  return adapter ? { properties: completeProperties(adapter.definition.capabilities, adapter.definition, kind), facts: structuredClone(adapter.definition.facts ?? []) } : { properties: unknownProperties() };
}

const defaults = {
  durable: {
    async status({ home, handle }, { adapters } = {}) {
      const { statusRoutes } = await import('./durable-route.mjs');
      const route = (await statusRoutes({ routeId: handle.id, home }, { adapters })).routes[0];
      if (!route) throw gozarError('route_not_found', `No durable route ${handle.id}`);
      return route;
    },
    async close({ home, handle }, { adapters } = {}) {
      const { releaseRoute } = await import('./durable-route.mjs');
      return releaseRoute({ routeId: handle.id, mode: 'remove', home, expectedGeneration: handle.generation }, { adapters });
    },
  },
  session: {
    async status({ home, handle }) {
      const { control } = await import('./daemon.mjs');
      const [directory, sessionId] = checkedSession(handle.id);
      let reply;
      try { reply = await control(join(home, directory), { type: 'status' }, 30_000); }
      catch (cause) { if(cause.code&&cause.code!=='ENOENT'&&cause.code!=='ECONNREFUSED')throw cause;throw gozarError('route_not_found', `No running session ${handle.id}`, null, cause); }
      if (sessionId && reply.snapshot?.sessionId !== sessionId) throw gozarError('route_conflict', 'The session was replaced; this handle is stale');
      return reply;
    },
    async close({ home, handle }) {
      const { stopSession } = await import('./daemon.mjs');
      const [name,sessionId]=checkedSession(handle.id),directory=join(home,name);
      if(sessionId){const bootstrap=await readRecord(join(directory,'bootstrap.json'));const recorded=bootstrap.sessionId??(await readRecord(join(directory,'session.json'))).snapshot?.sessionId;if(recorded!==sessionId)throw gozarError('route_conflict','The session was replaced; this handle is stale');}
      return stopSession(directory);
    },
  },
  async attached() { return import('./attached-route.mjs'); },
  external: {
    async status({ home, handle }) {
      const { statusServices } = await import('./service.mjs');
      const route = (await statusServices({ home, origin: handle.id })).routes.find(item => item.ownership === 'external-owned');
      if (!route) throw gozarError('route_not_found', 'No external service record for this origin');
      return route;
    },
    async close({ home, handle }) {
      const { removeService } = await import('./service.mjs');
      return removeService({ origin: handle.id, home,expectedGeneration:handle.generation });
    },
  },
};
export const splitSession = id => { const at = id.indexOf(':'); return at < 0 ? [id, null] : [id.slice(0, at), id.slice(at + 1)]; };
function checkedSession(id){const parts=splitSession(id);if(!/^port-[0-9]+$/.test(parts[0])||!parts[1]||!/^[A-Za-z0-9_-]+$/.test(parts[1]))throw gozarError('invalid_input','Invalid session handle');return parts;}

/** Fresh proof for one handle. An external service is read with handle {kind:'external', id:<origin>}. */
export async function routeStatus(request, deps = {}) {
  const handle = checkRef(request);
  const now = deps.now?.() ?? Date.now();
  try {
    switch (handle.kind) {
      case 'durable': {
        const reply = await (deps.durable ?? defaults.durable).status(request, { adapters: deps.adapters });
        if (Number.isInteger(reply.generation) && reply.generation !== handle.generation) throw gozarError('route_conflict', 'The route was replaced; this handle is stale');
        return projectDurable(reply, { handle, now, ...await propertiesFor(reply.adapterId, deps, 'durable') });
      }
      case 'session': {
        const generic=await defaults.attached();
        if(await generic.genericSessionRecord(request))return await generic.attachedStatus(request,deps.attachedDeps);
        const reply = await (deps.session ?? defaults.session).status(request);
        return projectSession(reply, { handle, now, ...await propertiesFor(reply.snapshot?.adapterId, deps, 'session') });
      }
      case 'attached': return await (deps.attached ?? await defaults.attached()).attachedStatus(request, deps.attachedDeps);
      case 'external': return projectExternal(await (deps.external ?? defaults.external).status(request), { handle, now });
    }
  } catch (error) { throw normalizeError(error); }
}

/** Ends one route. Durable, session and attached routes are removed; an external record loses its metadata only. */
export async function closeRoute(request, deps = {}) {
  const handle = checkRef(request);
  if (request.mode !== 'remove') throw gozarError('invalid_input', "closeRoute mode must be 'remove'");
  const now = deps.now?.() ?? Date.now();
  try {
    switch (handle.kind) {
      case 'durable': {
        let before;
        try { before = await routeStatus({ home: request.home, handle }, deps); }
        catch { /* Exact retained ownership is checked again by release; fresh proof is not cleanup authority. */ }
        const reply = await (deps.durable ?? defaults.durable).close(request, { adapters: deps.adapters });
        const debt = reply?.cleanupDebt ?? null;
        return { ...releasedView(before, handle), state: debt ? 'uncertain' : 'released', cleanup: cleanupRecovery(debt ? { state: 'unconfirmed', message: debtMessage(debt) } : { state: 'confirmed' },handle), routeState: debt ? 'cleanup-unconfirmed' : 'inactive' };
      }
      case 'session': {
        const generic=await defaults.attached();
        if(await generic.genericSessionRecord(request))return await generic.closeAttachedRoute(request,deps.attachedDeps);
        let before;try{before=await routeStatus({home:request.home,handle},deps);}catch{}
        const reply = await (deps.session ?? defaults.session).close(request);
        if(reply.snapshot?.sessionId&&splitSession(handle.id)[1]&&reply.snapshot.sessionId!==splitSession(handle.id)[1])throw gozarError('route_conflict','The session was replaced; this handle is stale');
        const stopped = projectSession(reply, { handle, now, properties: before?.properties??(await propertiesFor(reply.snapshot?.adapterId,deps,'session')).properties });
        return stopped.state === 'released' ? { ...releasedView(before, handle), cleanup: stopped.cleanup } : { ...stopped, ingress: null };
      }
      case 'attached': return await (deps.attached ?? await defaults.attached()).closeAttachedRoute(request, deps.attachedDeps);
      case 'external': {
        let before;try{before=await routeStatus({home:request.home,handle},deps);}catch(error){if(error.code==='route_conflict')throw error;}
        await (deps.external ?? defaults.external).close(request);
        return releasedView(before, handle);
      }
    }
  } catch (error) { throw normalizeError(error); }
}

/** Pauses a durable route without releasing its address or consent. */
export async function suspendRoute(request, deps = {}) {
  const handle = checkRef(request);
  if (handle.kind !== 'durable') throw gozarError('unsupported', 'Only durable routes can be suspended');
  const { suspendRoute: suspend } = await import('./durable-route.mjs');
  const reply = await suspend({ home: request.home, routeId: handle.id, expectedGeneration: handle.generation }, { adapters: deps.adapters });
  return projectDurable(reply.route, { handle, ...await propertiesFor(reply.route.adapterId, deps, 'durable') });
}
```

## Current packages/gozar-node/runtime-configuration-use.mjs

```js
import {createEmbeddingServices} from './embedding-services.mjs';
// Confirmed removal may release an old registry's exact metadata reservation.
// This operation never resolves, imports or deletes credential bytes.
export async function releaseRecordedConfigurationUse(request,runtime){
 const {registryId,...scope}=request;
 const services=registryId&&registryId!==runtime.registryId?createEmbeddingServices({registryId}):runtime.embeddingServices;
 if(services)await services.releaseConfigurationUse(scope);
}
```

## Current packages/gozar-node/host.mjs

```js
import { PublicRelayVerifier } from './public-relay.mjs';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { safeOrigin } from './catalog.mjs';
import { installIdentity } from './install-key.mjs';
import { dirname } from 'node:path';
import { selectedInterfaceAddress } from './interfaces.mjs';
import { createHash } from 'node:crypto';
import { acquireInstallKeyLease } from './key-route-lease.mjs';

// Feature names describe implemented boundaries. Remote execution is an injected trusted capability.
export const LOCAL_PLAN_FEATURES = ['recipe-sequence', 'typed-bindings', 'predicate-parser', 'owned-resource-ledger',
  'owned-process', 'interface-forwarder', 'private-file-reference', 'private-file-materialization', 'transport-origin-mapping', 'unused-port-selection', 'install-ed25519', 'json-event-origin', 'immutable-origin'];

export async function prepareHost(driver, adapter, { origin, gate, probeExecutor, authorities = {}, generation = 1, resolveCredential } = {}) {
  const nowMs = driver.nowMs(), expiresAtMs = nowMs + 900_000;
  const host = { nowMs, features: [...LOCAL_PLAN_FEATURES], bindings: {}, facts: {}, probe: null };
  if (gate) {
    host.features.push('probe-assertions');
    host.probe = { nonceRef: gate.nonceRef, verifierRef: gate.verifierRef, expiresAtMs, ...(probeExecutor instanceof PublicRelayVerifier ? { allowPublicRelay:true } : {}) };
  }
  if (probeExecutor) host.features.push('client-vantage-probe');
  const receipt = (value, expiry = expiresAtMs) => ({ value, generation, authorityRef: randomUUID(), sessionId: driver.sessionId, observedAtMs: nowMs, expiresAtMs: expiry });
  const stableBindingExpiry = driver.lifetimeMs !== undefined && Number.isFinite(gate?.expiresAtMs) ? gate.expiresAtMs : expiresAtMs;
  for (const [name, spec] of Object.entries(adapter.bindings ?? {})) {
    if (Object.hasOwn(spec, 'value') || (spec.source && spec.pointer)) continue;
    let value;
    if (spec.type === 'loopback-port') value = driver.targetPort;
    else if (spec.type === 'loopback-http-origin') value = `http://127.0.0.1:${driver.targetPort}`;
    else if (spec.type === 'credential-free-https-origin' && origin) {
      value = safeOrigin(origin);
      if (!value.startsWith('https://')) throw new Error('External origin requires HTTPS');
    } else if (spec.type === 'selected-interface-address' && driver.bindAddresses.length === 1) {
      const selected = driver.bindAddresses[0];
      if (selectedInterfaceAddress(selected) && Object.values(networkInterfaces()).flat().some(address => address.address === selected && !address.internal)) value = selected;
    } else if (spec.type === 'session-private-path' && !spec.materialize && !spec.provision) {
      const { fileHandle } = await driver.privateFiles.create();
      host.bindings[name] = { ...receipt(undefined), type: spec.type, handleRef: fileHandle, mode: '0600', parentMode: '0700' };
      delete host.bindings[name].value;
    }
    if (value !== undefined) {
      const expiry = ['loopback-port', 'loopback-http-origin', 'credential-free-https-origin'].includes(spec.type) ? stableBindingExpiry : expiresAtMs;
      host.bindings[name] = { ...receipt(value, expiry), type: spec.type };
    }
  }
  const exactInterface = driver.bindAddresses.length === 1 && selectedInterfaceAddress(driver.bindAddresses[0]) && Object.values(networkInterfaces()).flat().some(address => address.address === driver.bindAddresses[0] && !address.internal);
  if (exactInterface) host.facts['selected-interface-still-present'] = receipt({ address: driver.bindAddresses[0] });
  if (exactInterface && driver.firewallApproved) host.facts['firewall-user-approved'] = receipt({ bindAddress: driver.bindAddresses[0], port: 0, targetHost: '127.0.0.1', targetPort: driver.targetPort, scheme: 'http' });
  // Current profile, remote address reachability, provider permission and remote continuity are never synthesized.
  const supplied = typeof authorities === 'function' ? await authorities({ sessionId: driver.sessionId, adapterId: adapter.id, targetPort: driver.targetPort, nowMs, expiresAtMs, bindings: adapter.bindings }) : authorities;
  for (const [name, fact] of Object.entries(supplied.facts ?? {})) {
    if (fact.sessionId === driver.sessionId && fact.observedAtMs <= nowMs && fact.expiresAtMs > nowMs && fact.authorityRef) host.facts[name] = structuredClone(fact);
  }
  for (const [name, binding] of Object.entries(supplied.bindings ?? {})) {
    if (binding.sessionId === driver.sessionId && binding.observedAtMs <= nowMs && binding.expiresAtMs > nowMs && binding.authorityRef && adapter.bindings?.[name]?.type === binding.type) host.bindings[name] = structuredClone(binding);
  }
  driver.host = host;
  if (resolveCredential) driver.privateFiles.resolveCredential = resolveCredential;
  for (const [name, spec] of Object.entries(adapter.bindings ?? {})) {
    if (spec.materialize) await driver.materializePrivateFile(adapter.id, name, { generation });
  }
  driver.publicRelay = probeExecutor instanceof PublicRelayVerifier; driver.gate = gate; driver.probeExecutor = probeExecutor;
  return host;
}

// Installation identities are created only after the selected route is approved.
export async function acquireInstallIdentityLease(driver, adapter, targetPort = driver.targetPort) {
  const provision = Object.values(adapter?.bindings ?? {}).some(binding => binding.provision === 'install-ed25519');
  if (!provision) return null;
  const home = dirname(driver.journal.directory);
  const identity = await installIdentity(home);
  const keyFingerprint = createHash('sha256').update(identity).digest('hex');
  return acquireInstallKeyLease({ home, keyFingerprint, sessionDirectory:driver.journal.directory,
    sessionId:driver.sessionId, targetPort });
}

export async function prepareInstallIdentities(driver, adapter) {
  for (const [name, spec] of Object.entries(adapter?.bindings ?? {})) {
    if (!spec.provision || driver.host.bindings[name]) continue;
    if (spec.provision !== 'install-ed25519' || spec.type !== 'session-private-path' || Object.keys(spec).some(key => !['type', 'provision'].includes(key)) ||
        adapter.planVersion !== 1 || adapter.admission?.state !== 'admitted' || !adapter.admission.requiredFeatures?.includes('install-ed25519') ||
        !adapter.admission.requiredFeatures.every(feature => driver.host.features.includes(feature))) throw new Error('Identity provisioning is not admitted');
    if (driver.stopped) return;
    const content = await installIdentity(dirname(driver.journal.directory));
    if (driver.stopped) return;
    const { fileHandle } = await driver.privateFiles.create({ template: content });
    if (driver.stopped) { await driver.privateFiles.remove(fileHandle); return; }
    const nowMs = driver.nowMs();
    driver.host.bindings[name] = { type: 'session-private-path', handleRef: fileHandle, mode: '0600', parentMode: '0700',
      generation: 1, authorityRef: randomUUID(), sessionId: driver.sessionId, observedAtMs: nowMs,
      expiresAtMs: driver.gate?.expiresAtMs ?? nowMs + 900000 };
  }
}
```

## Current packages/gozar-node/interfaces.mjs

```js
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
```

## Current packages/gozar-node/driver.mjs

```js
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { PrivateFiles } from './private-files.mjs';
import { basename } from 'node:path';
import { admitPlanEffect, expandPlan } from './plan.mjs';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { isPublicIp } from './public-relay.mjs';
import { safeOrigin } from './catalog.mjs';
import { selectedInterfaceAddress } from './interfaces.mjs';
import { loadCore } from './core.mjs';
import { materializePrivateBinding, privateMaterializationScope } from './materialization.mjs';
import { attributable, processIdentity } from './journal.mjs';
import { createProgramResolver } from './program-resolution.mjs';

const mutates = effect => ['create', 'remove'].includes(effect.operation);
const allowedFields = {
  spawn: ['program', 'args', 'timeoutMs', 'maxOutputBytes', 'longRunning', 'persistent', 'collectMs', 'lifetimeMs'],
  'read-file': ['handleRef', 'maxOutputBytes', 'timeoutMs'],
  'http-probe': ['tls', 'probe', 'nonceRef', 'verifierRef', 'expiresAtMs', 'url', 'vantage', 'timeoutMs', 'maxOutputBytes', 'sse', 'streamableHttp', 'oauthDcr'],
  interfaces: ['timeoutMs', 'maxOutputBytes'],
  timer: ['delayMs', 'timeoutMs', 'maxOutputBytes'],
  'owned-process': ['signal', 'graceMs', 'thenSignal', 'confirmExit', 'timeoutMs', 'maxOutputBytes', 'afterExit', 'cleanupPrivateArtifacts'],
  'local-forwarder': ['targetPort', 'targetHost', 'bindAddress', 'port', 'timeoutMs', 'maxOutputBytes'],
};
const runtimeFields = new Set(['id', 'sessionId', 'generation', 'operation', 'adapterId', 'resourceId', 'origin', 'recipeRef', 'stepId', 'stage', 'bindings', 'bindingRefs', 'ownership']);
const shellPrograms = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'cmd', 'cmd.exe', 'powershell', 'pwsh']);
const bounded = (number, fallback, maximum) => Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// How long stop re-reads a provider that still shows an entry for a watcher that has exited (see proveProcessAbsent). Inside the 5 s receipt validity.
const ABSENCE_SETTLE_MS = 3000, ABSENCE_POLL_MS = 100;

export class EffectDriver {
  constructor({ adapters, journal, sessionId, targetPort, origin, consent = false, handles = {}, bindAddresses = [], firewallApproved = false, recoveryOnly = false, resolveCredential, observeProcessOutput = false, onProcessOutput, resolveProgram = createProgramResolver(), host = { features: [], bindings: {}, facts: {} }, onExit = () => {} }) {
    this.adapters = structuredClone(adapters);
    this.host = host;
    this.privateFiles = new PrivateFiles({ journal, sessionId, resolveCredential });
    this.journal = journal;
    this.sessionId = sessionId;
    this.targetPort = targetPort;
    this.origin = origin;
    this.consent = consent;
    this.handles = handles;
    this.bindAddresses = bindAddresses;
    this.firewallApproved = firewallApproved;
    this.onExit = onExit;
    this.resolveProgram = resolveProgram;
    this.observeProcessOutput = observeProcessOutput; this.onProcessOutput = onProcessOutput;
    this.outputEvents = []; this.outputBytes = 0; this.outputSequence = 0;
    this.recoveryOnly = recoveryOnly;
    this.children = new Map();
    this.routeLineBuffers = new Map();
    this.routeOutputReady = new Set();
    this.forwarders = new Map();
    this.receipts = new Map();
    this.intentRecords = new Map();
    this.timers = new Map();
    this.probeControllers = new Set();
    this.activeRequests = new Set();
    this.proofExpiries = new Map();
    this.generation = 0;
    this.selectedAdapter = null;
    this.stopped = false;
    // Core IDs carry a session-wide increasing sequence, including cleanup.
    this.issuedSequence = 0n;
    // Compatibility IDs cannot be compacted safely: cap without eviction.
    this.issued = new Set();
  }
  async materializePrivateFile(adapterId, bindingName, { generation } = {}) {
    const adapter = this.adapters.find(item => item.id === adapterId);
    if (adapter?.planVersion !== 1 || adapter.admission?.state !== 'admitted' ||
        !adapter.admission.requiredFeatures.every(feature => this.host.features.includes(feature)) || !this.host.features.includes('private-file-materialization')) throw new Error('Private materialization feature admission failed');
    const bindings = { ...this.host.bindings };
    for (const [name, spec] of Object.entries(adapter.bindings ?? {})) {
      if (Object.hasOwn(spec, 'value')) bindings[name] = { type: spec.type, value: spec.value, authorityRef: `plan:${generation}:${name}` };
    }
    const receipt = await materializePrivateBinding({ spec: adapter.bindings?.[bindingName], bindings, facts: this.host.facts ?? {},
      sessionId: this.sessionId, generation, nowMs: this.nowMs(), files: this.privateFiles, adapterId, bindingName });
    if (receipt.expiresAtMs <= this.nowMs()) {
      await this.privateFiles.remove(receipt.handleRef);
      throw new Error('Private materialization authority expired while resolving');
    }
    this.host.bindings[bindingName] = receipt;
    return receipt;
  }
  processOutput(effect, resource, stream, chunk) {
    if (resource?.privateMaterialized) return;
    if (!resource || (!this.observeProcessOutput && !this.onProcessOutput)) return;
    const output = chunk.subarray(Math.max(0,chunk.length-8192)).toString('utf8');
    const event = { sequence:++this.outputSequence, sessionId:this.sessionId, generation:resource.generation,
      adapterId:resource.adapterId, resourceId:resource.id, continuityRef:resource.continuityRef,
      effectId:effect.id, stream, observedAtMs:this.nowMs(), output };
    if (this.observeProcessOutput) {
      this.outputEvents.push(event); this.outputBytes += Buffer.byteLength(output);
      while (this.outputEvents.length > 128 || this.outputBytes > 32768) this.outputBytes -= Buffer.byteLength(this.outputEvents.shift().output);
    }
    if (this.onProcessOutput) {
      const key = `${resource.id}\0${stream}`;
      const frame = this.routeLineBuffers.get(key) ?? { buffer: '', dropping: false };
      for (const char of chunk.toString('utf8')) {
        if (char === '\n') {
          const line = frame.buffer.endsWith('\r') ? frame.buffer.slice(0, -1) : frame.buffer;
          if (!frame.dropping && line.length <= 4096) {
            if (this.routeOutputReady.has(resource.id)) { try { this.onProcessOutput({ ...event, completeLine: line }); } catch {} }
          }
          frame.buffer = ''; frame.dropping = false;
        } else if (!frame.dropping) {
          if (frame.buffer.length >= 4096) { frame.buffer = ''; frame.dropping = true; }
          else frame.buffer += char;
        }
      }
      this.routeLineBuffers.set(key, frame);
      try { this.onProcessOutput(event); } catch {}
    }
  }
  readProcessOutput(after = 0) { return this.outputEvents.filter(event=>event.sequence>after).map(event=>({...event})); }
  nowMs() { return Math.floor(performance.timeOrigin + performance.now()); }
  planContext() { return { adapters: this.adapters, sessionId: this.sessionId, targetPort: this.targetPort,
    features: this.host.features, host: this.host, nowMs: this.nowMs(), owned: this.journal.value.owned }; }
  payloadKey(value, bindings = value.bindings) {
    const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object' ?
      Object.fromEntries(Object.keys(item).sort().filter(key => key !== 'parser').map(key => [key, canonical(item[key])])) : item;
    const payload = Object.fromEntries(Object.entries(value).filter(([key]) => !runtimeFields.has(key)));
    return JSON.stringify(canonical({ payload, bindings: bindings ?? {} }));
  }
  receiptKey(effect) { return JSON.stringify([effect.sessionId, effect.generation, effect.adapterId, effect.operation, effect.resourceId ?? null]); }
  authorize(adapterId) { this.selectedAdapter = adapterId; this.consent = true; }
  expand(value, effect) {
    if (typeof value === 'string') return value.replace(/\{([A-Za-z]+)\}/g, (_, key) => {
      const binding = effect.bindings?.[key];
      if (binding) return binding.type === 'session-private-path' ? `{${key}}` : String(binding.value ?? binding.handleRef);
      const fields = { port: this.targetPort, targetPort: this.targetPort, target: `127.0.0.1:${this.targetPort}`,
        sessionId: this.sessionId, origin: this.origin, resourceId: effect.resourceId };
      if (fields[key] === undefined) throw new Error(`Unbound recipe field: ${key}`);
      return String(fields[key]);
    });
    if (Array.isArray(value)) return value.map(item => this.expand(item, effect));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.expand(item, effect)]));
    return value;
  }
  replaySequence(effect) {
    if (typeof effect.id !== 'string' || !effect.id || effect.id.length > 1024) throw new Error('Invalid effect ID');
    const prefix = `${this.sessionId}:`;
    if (!effect.id.startsWith(prefix)) return null;
    const suffix = effect.id.slice(prefix.length);
    if (!/^[0-9]+:[0-9]+$/.test(suffix)) return null;
    const match = /^(0|[1-9][0-9]*):([1-9][0-9]{0,19})$/.exec(suffix);
    if (!match || match[1] !== String(effect.generation)) throw new Error('Effect ID generation mismatch');
    const sequence = BigInt(match[2]);
    if (sequence > 18446744073709551615n) throw new Error('Invalid effect sequence');
    return sequence;
  }
  admit(effect) {
    if (effect.sessionId !== this.sessionId || !effect.id || !Number.isSafeInteger(effect.generation)) throw new Error('Effect identity mismatch');
    if (this.stopped && effect.operation !== 'remove' && !effect.recipeRef?.startsWith('remove/')) throw new Error('Session stopped; observation or allocation dispatch is fenced');
    const sequence = this.replaySequence(effect);
    if (sequence !== null) {
      if (sequence <= this.issuedSequence) throw new Error('Effect already dispatched or out of order');
    } else {
      if (this.issued.has(effect.id)) throw new Error('Effect already dispatched');
      if (this.issued.size >= 128) throw new Error('Legacy effect replay capacity exhausted');
    }
    if (effect.operation !== 'remove' && effect.generation < this.generation) throw new Error('Stale effect generation');
    if (effect.action === 'inspect') {
      this.admitInspection(effect); return;
    }
    if (effect.kind === 'timer' && effect.operation === 'health') {
      if (effect.recipeRef !== 'health/expiry' || effect.stepId !== 'expiry' || effect.stage !== 'health' || !this.host.probe ||
          ![...this.proofExpiries.values()].includes(effect.expiresAtMs) || effect.expiresAtMs > this.host.probe.expiresAtMs) throw new Error('Health timer lacks a matching verified receipt');
      return;
    }
    if (this.recoveryOnly && effect.operation !== 'remove') throw new Error('Recovery permits only owned local cleanup');
    if (this.recoveryOnly && effect.kind !== 'persist') {
      const resource = this.journal.value.owned[effect.resourceId];
      if (!resource || !((resource.kind === 'process' && ['spawn', 'owned-process'].includes(effect.kind)) ||
          (resource.kind === 'local-forwarder' && effect.kind === 'local-forwarder'))) throw new Error('Recovery cannot mutate remote or unowned resources');
    }
    if (effect.kind === 'persist') {
      const record = effect.record;
      if (!record || !['create', 'remove'].includes(effect.operation) || record.operation !== effect.operation ||
          record.sessionId !== this.sessionId || record.generation !== effect.generation ||
          record.adapterId !== this.selectedAdapter || (effect.adapterId && effect.adapterId !== record.adapterId) ||
          (effect.resourceId && effect.resourceId !== record.resourceId)) throw new Error('Persist intent scope mismatch');
      if (effect.recipeRef) {
        if (!isDeepStrictEqual(record.bindings, effect.bindings)) throw new Error('Persist binding scope mismatch');
        if (effect.stage !== 'persist' || effect.stepId !== 'intent' || effect.recipeRef !== `${effect.operation}/execute` || !record.execute || record.recipeRef !== effect.recipeRef) throw new Error('Persist plan step mismatch');
        const { parser, ...payload } = record.execute;
        admitPlanEffect({ ...payload, id: effect.id, sessionId: effect.sessionId, generation: effect.generation,
          operation: effect.operation, adapterId: effect.adapterId, resourceId: effect.resourceId,
          recipeRef: record.recipeRef, stage: 'execute', stepId: 'execute', bindings: effect.bindings, bindingRefs: effect.bindingRefs }, this.planContext());
      }
      if (!this.consent && effect.operation === 'create') throw new Error('Persist intent requires consent');
      if (effect.operation === 'remove') {
        const resource = this.journal.value.owned[record.resourceId];
        if (!resource || resource.sessionId !== this.sessionId || resource.adapterId !== record.adapterId) throw new Error('Persist removal requires exact ownership');
      }
      return;
    }
    const operational = effect.recipeRef && !['probe'].includes(effect.operation);
    if (operational) admitPlanEffect(effect, this.planContext());
    if (!operational && (!allowedFields[effect.kind] || Object.keys(effect).some(key => !runtimeFields.has(key) && key !== 'kind' && !allowedFields[effect.kind].includes(key)))) throw new Error('Unsupported recipe execution field; feature admission required');
    if (mutates(effect) && (!this.consent || !this.receipts.has(this.receiptKey(effect)))) throw new Error('Mutation requires consent and durable intent');
    if (effect.operation === 'create' && this.stopped) throw new Error('Session is stopping');
    if (effect.operation === 'create' && effect.kind === 'spawn' && !effect.longRunning && !effect.persistent) throw new Error('Finite create commands require owned mapping readback guards; only persistent owned processes are admitted');
    if (mutates(effect) && effect.recipeRef && this.receipts.get(this.receiptKey(effect)) !== this.payloadKey(effect)) throw new Error('Execution differs from acknowledged durable intent');
    const candidates = this.adapters.filter(adapter => (!effect.adapterId || adapter.id === effect.adapterId) &&
      (!mutates(effect) || adapter.id === this.selectedAdapter));
    const admitted = operational || candidates.some(adapter => {
      if (mutates(effect) && (adapter.ownership === 'external-owned' || adapter.admission || adapter.bindings)) return false;
      const recipe = adapter.recipes?.[effect.operation];
      if (!recipe || recipe.kind !== effect.kind) return false;
      const expanded = this.expand(recipe, effect);
      // Compare all execution fields in both directions; parser interpretation stays in Rust.
      const keys = new Set([...Object.keys(expanded), ...Object.keys(effect)]);
      return [...keys].every(key => runtimeFields.has(key) || key === 'parser' ||
        JSON.stringify(expanded[key]) === JSON.stringify(this.expand(effect[key], effect)));
    });
    // Probe exact core candidate, never a URL supplied in command text.
    const genericProbe = !admitted && effect.kind === 'http-probe' && effect.operation === 'probe' && this.origin &&
      [this.origin, `${this.origin}/`].includes(effect.url ?? effect.origin) && !effect.headers && !effect.body && !effect.method;
    if (!admitted && !genericProbe) throw new Error('Effect is outside admitted recipe scope');
    if (effect.operation === 'remove') {
      const resource = this.journal.value.owned[effect.resourceId];
      if (!resource || resource.sessionId !== this.sessionId || resource.adapterId !== effect.adapterId) {
        throw new Error('Removal requires an exact owned resource in the selected adapter scope');
      }
    }
  }
  async execute(effect) {
    let dispatched = false;
    try {
      this.admit(effect);
      const sequence = this.replaySequence(effect);
      if (sequence === null) this.issued.add(effect.id);
      else this.issuedSequence = sequence;
      this.generation = Math.max(this.generation, effect.generation);
      effect = this.expand(effect, effect);
      if (mutates(effect) && effect.kind !== 'persist') this.receipts.delete(this.receiptKey(effect));
      let result;
      dispatched = effect.kind !== 'persist';
      if (effect.action === 'inspect') result = await this.inspectOwnership(effect);
      else switch (effect.kind) {
        case 'persist': await this.journal.intent(effect); this.intentRecords.set(this.receiptKey(effect.record), effect.record); this.receipts.set(this.receiptKey(effect.record), effect.record.execute ? this.payloadKey(effect.record.execute, effect.record.bindings) : null); result = { durable: true }; break;
        case 'spawn': result = await this.runProcess(effect); break;
        case 'owned-process':
          if (effect.operation !== 'remove') throw new Error('Owned-process accepts only scoped removal');
          result = await this.removeProcess(effect.resourceId, effect); break;
        case 'read-file': result = await this.readHandle(effect); break;
        case 'http-probe': result = await this.probe(effect); break;
        case 'interfaces': result = { interfaces: networkInterfaces() }; break;
        case 'timer': result = await this.timer(effect); break;
        case 'local-forwarder': result = await this.forward(effect); break;
        default: throw new Error('Unsupported effect kind');
      }
      if (effect.recipeRef && effect.operation === 'observe') {
        const observedAtMs = this.nowMs(); result.observation = { authorityRef: randomUUID(), sessionId: this.sessionId, observedAtMs, expiresAtMs: observedAtMs + 5000 };
      }
      if (effect.recipeRef && effect.operation === 'observe' && effect.resourceId) {
        const receipt = await this.continuity(effect.resourceId);
        if (receipt) result.ownershipReceipt = receipt;
      }
      return { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation, ok: true, result };
    } catch (error) {
      return { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId, generation: effect.generation,
        ok: false, result: { ...(!dispatched ? { notApplied: true } : {}), code: error.code ?? 'blocked', detail: error.message } };
    }
  }
  admitInspection(effect) {
    const resource = this.journal.value.owned[effect.resourceId];
    const adapter = this.adapters.find(adapter => adapter.id === effect.adapterId);
    const ledger = effect.ownership;
    const expectedKind = resource?.kind === 'process' ? 'owned-process' : resource?.kind === 'local-forwarder' ? 'local-forwarder' : null;
    if (effect.operation !== 'observe' || effect.recipeRef !== 'remove/ownership' || effect.stepId !== 'ownership' || effect.stage !== 'before' ||
        !resource || resource.sessionId !== this.sessionId || resource.adapterId !== effect.adapterId || effect.kind !== expectedKind ||
        adapter?.planVersion !== 1 || adapter.recipes?.remove?.kind !== expectedKind || adapter.admission?.state !== 'admitted' ||
        adapter.admission.requiredFeatures.some(feature => !this.host.features.includes(feature)) || !ledger ||
        ledger.handleRef !== resource.id || ledger.continuityRef !== resource.continuityRef ||
        !isDeepStrictEqual(ledger.details, resource.details) || !isDeepStrictEqual(ledger.baseline, resource.baseline) ||
        !isDeepStrictEqual(ledger.bindings, resource.bindings)) throw new Error('Intrinsic ownership inspection scope mismatch');
  }
  async inspectOwnership(effect) {
    const ownershipReceipt = await this.continuity(effect.resourceId);
    if (!ownershipReceipt) throw new Error('Local resource continuity unavailable');
    return { details: this.journal.value.owned[effect.resourceId].details, ownershipReceipt };
  }
  timer(effect) {
    const delay = effect.expiresAtMs ? Math.max(1, effect.expiresAtMs - this.nowMs()) : bounded(effect.delayMs, 1, 86400000);
    return new Promise(resolve => {
      const finish = cancelled => {
        clearTimeout(timer); this.timers.delete(effect.id);
        if (effect.recipeRef === 'health/expiry' && this.proofExpiries.get(effect.generation) === effect.expiresAtMs) this.proofExpiries.delete(effect.generation);
        resolve(cancelled ? { cancelled: true } : { elapsed: true });
      };
      const timer = setTimeout(() => finish(false), Math.min(delay, 86400000));
      this.timers.set(effect.id, () => finish(true));
    });
  }
  cancelTimers() { for (const cancel of [...this.timers.values()]) cancel(); }
  async readHandle(effect) {
    const path = this.handles[effect.handleRef];
    if (!path) throw new Error('Unknown scoped file handle');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!(await file.stat()).isFile()) throw new Error('Handle is not a regular file');
      const limit = bounded(effect.maxOutputBytes, 16_384, 1_048_576);
      const buffer = Buffer.alloc(limit + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > limit) throw new Error('File exceeds output limit');
      return { stdout: buffer.subarray(0, bytesRead).toString('utf8'), stderr: '', exitCode: 0 };
    } finally { await file.close(); }
  }
  async runProcess(effect) {
    if (effect.operation === 'remove' && this.journal.value.owned[effect.resourceId]?.kind === 'process') {
      return this.removeProcess(effect.resourceId);
    }
    if (typeof effect.program !== 'string' || shellPrograms.has(basename(effect.program)) || !Array.isArray(effect.args)) throw new Error('Invalid direct argv recipe');
    const artifacts = new Set();
    const resolveArgument = async argument => {
      if (effect.recipeRef && (typeof argument === 'number' || typeof argument === 'boolean')) return String(argument);
      if (argument?.kind === 'private-file' && typeof argument.handleRef === 'string' && Object.keys(argument).every(key => ['kind', 'handleRef'].includes(key))) {
        artifacts.add(argument.handleRef); return this.privateFiles.path(argument.handleRef);
      }
      if (typeof argument !== 'string' || argument.includes('\0')) throw new Error('Invalid direct argv recipe');
      let value = argument;
      for (const [name, binding] of Object.entries(effect.bindings ?? {})) {
        if (binding.type !== 'session-private-path') continue;
        if (value === binding.handleRef || value.includes(`{${name}}`)) {
          const path = await this.privateFiles.path(binding.handleRef); artifacts.add(binding.handleRef);
          value = value === binding.handleRef ? path : value.replaceAll(`{${name}}`, path);
        }
      }
      if (/\{[A-Za-z][A-Za-z0-9]*\}/.test(value)) throw new Error('Unresolved argv binding');
      return value;
    };
    const args = await Promise.all(effect.args.map(resolveArgument));
    const timeoutMs = bounded(effect.timeoutMs, 5_000, 120_000);
    const limit = bounded(effect.maxOutputBytes, 16_384, 1_048_576);
    const longRunning = effect.longRunning === true || effect.persistent === true;
    const privateMaterialized = [...artifacts].some(handle => this.journal.value.owned[handle]?.materialized);
    for (const handle of artifacts) {
      const file = this.journal.value.owned[handle];
      if (!file?.materialized) continue;
      const adapter = this.adapters.find(item => item.id === effect.adapterId), spec = adapter?.bindings?.[file.bindingName];
      if (!effect.recipeRef || effect.bindings?.[file.bindingName]?.handleRef !== handle || file.adapterId !== effect.adapterId || file.generation !== effect.generation) throw new Error('Private artifact is outside its exact dispatch scope');
      const declaration = privateMaterializationScope(spec, effect.bindings, this.host.facts ?? {}, { sessionId: this.sessionId, generation: effect.generation, nowMs: this.nowMs(), hostBindings: this.host.bindings });
      if (declaration.declarationHash !== file.declarationHash) throw new Error('Private artifact declaration changed before dispatch');
    }
    if (privateMaterialized && !longRunning) throw new Error('Materialized credentials require an owned long-running process');
    if (privateMaterialized) {
      for (const handle of artifacts) {
        const file = this.journal.value.owned[handle];
        if (file?.materialized) file.pendingDispatch = { effectId: effect.id, sessionId: this.sessionId, generation: effect.generation };
      }
      await this.journal.save();
    }
    const processDetails = longRunning ? this.ledgerDetails(effect) : undefined;
    const child = (this.spawnProcess??spawn)(this.spawnProcess?effect.program:this.resolveProgram(effect.program, process.env), args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }, detached: false,...(this.spawnProcess?{fixtureEffect:{longRunning}}:{}) });
    let resource;
    if (longRunning) {
      try { await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); }
      catch (error) {
        if (!child.pid && privateMaterialized) {
          for (const handle of artifacts) if (this.journal.value.owned[handle]?.pendingDispatch?.effectId === effect.id) delete this.journal.value.owned[handle].pendingDispatch;
          await this.journal.save();
        }
        throw error;
      }
      const id = randomUUID();
      resource = { id, kind: 'process', pid: child.pid, startIdentity: await processIdentity(child.pid),
        nonce: randomUUID(), artifacts: [...artifacts], ...(privateMaterialized ? { privateMaterialized: true, dispatchEffectId: effect.id } : {}), continuityRef: randomUUID(), bindings: effect.bindings ?? {}, details: processDetails, baseline: this.intentRecords.get(this.receiptKey(effect))?.baseline ?? {}, sessionId: this.sessionId, adapterId: this.selectedAdapter, generation: effect.generation };
      if (!resource.startIdentity) { child.kill('SIGTERM'); throw new Error('Cannot establish process ownership'); }
      if (effect.lifetimeMs) {
        const lifetime = setTimeout(() => { if (!this.stopped) this.onExit({ resourceId: id, reason: 'lifetime-expired' }); }, (this.lifetimeMs ?? bounded(effect.lifetimeMs, 900000, 86400000)));
        lifetime.unref(); child.once('exit', () => clearTimeout(lifetime));
      }
      this.children.set(id, child);
      try {
        await this.journal.own(resource);
        if (privateMaterialized) {
          for (const handle of artifacts) if (this.journal.value.owned[handle]?.pendingDispatch?.effectId === effect.id) delete this.journal.value.owned[handle].pendingDispatch;
          await this.journal.save();
        }
      } catch (error) { child.kill('SIGTERM'); throw error; }
    }
    const completion = await new Promise((resolve, reject) => {
      let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), receivedBytes = 0, settled = false, idle;
      const finish = (error, exitCode = null) => {
        if (settled) return;
        settled = true; clearTimeout(deadline); clearTimeout(idle);
        if (error) { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 500).unref(); reject(error); }
        else resolve({ stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), exitCode,
          ...(resource ? { resourceId: resource.id, ...(effect.recipeRef ? { ownership: this.ownership(resource) } : {}) } : {}) });
      };
      const deadline = setTimeout(() => finish(new Error('Process timed out')), timeoutMs);
      const collect = stream => chunk => {
        this.processOutput(effect,resource,stream,chunk);
        if (settled) return;
        receivedBytes += chunk.length;
        if (receivedBytes > limit) return finish(new Error('Process output limit exceeded'));
        if (!privateMaterialized) {
          if (stream === 'stdout') stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
        }
        // The host only bounds collection. Core parses the collected bytes and decides readiness.
        if (longRunning && !settled) { clearTimeout(idle); idle = setTimeout(() => finish(null), bounded(effect.collectMs, 2000, 10000)); }
      };
      child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
      child.once('error', error => finish(error));
      child.once('close', code => {
        if (settled && resource) this.onExit({ resourceId: resource.id, exitCode: code });
        if (longRunning && !settled) finish(new Error('Owned process exited before its initial output was collected'));
        else finish(null, code);
      });
    });
    if (resource && this.onProcessOutput && !resource.privateMaterialized) {
      this.routeOutputReady.add(resource.id);
    }
    return completion;
  }
  ledgerDetails(effect, actual) {
    const recipe = this.adapters.find(adapter => adapter.id === effect.adapterId)?.recipes?.create;
    if (!recipe?.ledger) return {};
    const expected = expandPlan(recipe.ledger, effect.bindings ?? {});
    if (actual === undefined) return expected;
    if (!isDeepStrictEqual(expected, actual)) throw new Error('Declared ownership ledger differs from actual local resource');
    return actual;
  }
  async proveProcessAbsent(resource) {
    const observedAtMs = this.nowMs();
    if (resource?.sessionId !== this.sessionId || resource.kind !== 'process' || !resource.startIdentity || !resource.continuityRef ||
        await processIdentity(resource.pid) === resource.startIdentity) throw new Error('Recorded process is still running or its birth identity is unavailable');
    const adapter = this.adapters.find(item => item.id === resource.adapterId), remove = adapter?.recipes?.remove;
    if (this.journal.value.state) {
      const ledger = this.journal.value.state.resources?.find(item => item.id === resource.id)?.ledger;
      if (!ledger || ledger.handleRef !== resource.id || ledger.continuityRef !== resource.continuityRef ||
          !isDeepStrictEqual(ledger.bindings, resource.bindings) || !isDeepStrictEqual(ledger.details, resource.details)) throw new Error('Recorded process differs from the durable ownership ledger; inspect the session before retrying stop');
    }
    const processLifetime = adapter?.endpointLifetime === 'owned-process' && adapter.recipes.create?.kind === 'spawn' &&
      adapter.recipes.create.process?.mode === 'owned-long-running' && remove?.kind === 'owned-process' &&
      Array.isArray(remove.before) && !remove.before.length && Array.isArray(remove.after) && !remove.after.length &&
      Array.isArray(remove.requires) && !remove.requires.length;
    if (adapter?.planVersion === 1 && adapter.admission?.state === 'admitted' && processLifetime) {
      if (await processIdentity(resource.pid) === resource.startIdentity || this.nowMs() >= observedAtMs + 5000) throw new Error('Owned endpoint absence changed or expired; retry stop');
      return { sessionId: this.sessionId, handleRef: resource.id, continuityRef: resource.continuityRef,
        processGone: true, providerAbsent: true, observedAtMs, expiresAtMs: observedAtMs + 5000 };
    }
    if (adapter?.planVersion !== 1 || adapter.admission?.state !== 'admitted' || remove?.kind !== 'owned-process' ||
        !remove.before?.length || !remove.after?.length) throw new Error('No admitted identity and absence readbacks are available for this owned process');
    if ((remove.requires ?? []).some(rule => rule.op !== 'owned-ledger-match' || rule.source !== 'ownership' || rule.pointer !== '/route' ||
        Object.keys(rule).some(key => !['op', 'source', 'pointer'].includes(key)))) throw new Error('Unsupported removal prerequisite; absence cannot be proved');
    const step = await loadCore();
    const predicate = (rule, doc) => {
      const parser = { kind: 'json-document', predicate: rule };
      const initial = step({ command: { type: 'detect', sessionId: 'absence-readback' }, adapters: [{ id: 'readback', audience: 'local', ownership: 'external-owned',
        recipes: { detect: { kind: 'spawn', program: 'readback', args: [], parser } } }], requirements: { clientReach: 'this-device' } });
      const effect = initial.effects[0];
      if (!effect) throw new Error('Core did not admit the readback predicate');
      const parsed = step({ state: initial.state, command: { type: 'effect-result', effectId: effect.id, sessionId: effect.sessionId,
        generation: effect.generation, ok: true, result: { stdout: JSON.stringify(doc), exitCode: 0 } } });
      return parsed.snapshot.observations.readback === 'present';
    };
    for (const [stage, observations] of [['identity', remove.before], ['absence', remove.after]]) {
      for (const observation of observations) {
        const recipe = observation.recipe;
        if (recipe?.kind !== 'spawn' || !observation.assert || recipe.parser?.kind !== 'json-document' ||
            Object.keys(recipe).some(key => !['kind', 'program', 'args', 'timeoutMs', 'maxOutputBytes', 'parser'].includes(key)) ||
            Object.keys(observation).some(key => !['id', 'recipe', 'assert', 'captures'].includes(key))) throw new Error(`Unsupported ${stage} readback; inspect the admitted removal plan`);
        const expanded = expandPlan(recipe, resource.bindings ?? {});
        // A provider can keep a foreground entry visible for a moment after its watcher has exited. Only that one
        // condition (a readable document that still shows the entry) is re-read, for at most `absenceSettleMs`; a failed
        // read, an identity mismatch or an entry that outlives the bound still fails the stop as before.
        const settleUntil = stage === 'absence' ? this.nowMs() + (this.absenceSettleMs ?? ABSENCE_SETTLE_MS) : 0;
        let result, doc, matched;
        for (;;) {
          result = await this.runProcess(expanded);
          if (result.exitCode !== 0) throw new Error(`${stage} readback failed; confirm the provider is available and retry stop`);
          doc = JSON.parse(result.stdout);
          matched = doc && typeof doc === 'object' && !Array.isArray(doc) && predicate(expanded.parser.predicate, doc) && predicate(expandPlan(observation.assert, resource.bindings ?? {}), doc);
          if (matched || this.nowMs() >= settleUntil) break;
          await sleep(ABSENCE_POLL_MS);
        }
        if (!matched) throw new Error(stage === 'absence' ? `Recorded process is gone; listener ${resource.bindings?.port?.value ?? '(recorded port)'} may still be configured. Inspect the current mapping or stop its owning session, then retry stop.` : 'Identity readback did not match the recorded resource; inspect the current provider identity before retrying stop');
      }
    }
    if (await processIdentity(resource.pid) === resource.startIdentity) throw new Error('Recorded process is still running; absence cannot be proved');
    if (this.nowMs() >= observedAtMs + 5000) throw new Error('Absence readbacks expired; retry stop for a fresh check');
    return { sessionId: this.sessionId, handleRef: resource.id, continuityRef: resource.continuityRef,
      processGone: true, providerAbsent: true, observedAtMs, expiresAtMs: observedAtMs + 5000 };
  }
  async continuity(id) {
    const resource = this.journal.value.owned[id];
    if (!resource || resource.sessionId !== this.sessionId || !resource.continuityRef) return null;
    if (resource.retired && resource.kind === 'process') return null;
    if (resource.retired && resource.kind === 'local-forwarder') {
      const stillGone = !this.forwarders.has(id);
      if (!stillGone) return null;
      const nowMs = this.nowMs(); return { handleRef: id, continuityRef: resource.continuityRef, sessionId: this.sessionId, observedAtMs: nowMs, expiresAtMs: nowMs + 5000, continuous: true };
    }
    const owned = resource.kind === 'process' ? await attributable(resource, this.sessionId) :
      resource.kind === 'local-forwarder' && this.forwarders.has(id) && resource.daemonPid === process.pid && resource.daemonStartIdentity === await processIdentity(process.pid);
    if (!owned) return null;
    const nowMs = this.nowMs();
    return { handleRef: id, continuityRef: resource.continuityRef, sessionId: this.sessionId, observedAtMs: nowMs, expiresAtMs: nowMs + 5000, continuous: true };
  }
  ownership(resource) {
    return { handleRef: resource.id, continuityRef: resource.continuityRef, kind: resource.kind === 'local-forwarder' ? 'forwarder' : resource.kind,
      sessionId: resource.sessionId, generation: resource.generation, details: resource.details ?? {} };
  }
  async removeProcess(id, effect = {}) {
    const resource = this.journal.value.owned[id];
    if (!resource || resource.sessionId !== this.sessionId || !resource.nonce || !resource.startIdentity) throw new Error('Unknown owned process');
    for (const key of this.routeLineBuffers.keys()) if (key.startsWith(`${id}\0`)) this.routeLineBuffers.delete(key);
    this.routeOutputReady.delete(id);
    if ((effect.signal && effect.signal !== 'SIGTERM') || (effect.thenSignal && effect.thenSignal !== 'SIGKILL')) throw new Error('Unsupported owned-process signal');
    const attempts = Math.ceil(bounded(effect.graceMs, 500, 5000) / 25);
    if (await attributable(resource, this.sessionId)) {
      process.kill(resource.pid, 'SIGTERM');
      for (let attempt = 0; attempt < attempts && await attributable(resource, this.sessionId); attempt++) await sleep(25);
      if (await attributable(resource, this.sessionId)) process.kill(resource.pid, 'SIGKILL');
      for (let attempt = 0; attempt < 20 && await attributable(resource, this.sessionId); attempt++) await sleep(25);
      if (await attributable(resource, this.sessionId)) throw new Error('Owned process removal unconfirmed');
    }
    for (const handle of resource.artifacts ?? []) {
      if (this.journal.value.owned[handle]) await this.privateFiles.remove(handle);
    }
    if (effect.recipeRef || effect.retainRecord) { resource.retired = true; await this.journal.save(); }
    else await this.journal.removed(id);
    this.children.delete(id);
    return { exitCode: 0, removed: true, resourceId: id };
  }
  async probe(effect) {
    if (this.host.probe) return this.verifyProbe(effect);
    if (effect.vantage && effect.vantage !== 'local') throw Object.assign(new Error('Remote validation required: this executor only observes the local network vantage.'), { code: 'needs-validation' });
    const value = effect.url ?? effect.origin;
    const url = new URL(value);
    if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid probe URL');
    const limit = bounded(effect.maxOutputBytes, 16_384, 1_048_576);
    return new Promise((resolve, reject) => {
      let bytes = 0, body = '', settled = false, firstEvent = false;
      const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(deadline); this.activeRequests.delete(request); request.destroy(); error ? reject(error) : resolve(result); };
      const request = (url.protocol === 'https:' ? https : http).get(url, { headers: effect.sse ? { accept: 'text/event-stream' } : {}, rejectUnauthorized: true }, response => {
        const status = response.statusCode;
        if (status >= 300 && status < 400) return finish(new Error('Probe redirects are not admitted'));
        if (effect.sse && !response.headers['content-type']?.startsWith('text/event-stream')) return finish(new Error('SSE content type missing'));
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > limit) return finish(new Error('Probe output limit exceeded'));
          body += chunk.toString('utf8');
          if (effect.sse && /(?:^|\n)data:[^\n]*\r?\n\r?\n/.test(body)) {
            firstEvent = true;
            finish(null, { status, stdout: '', stderr: '', sseEventReceived: true, timedStreamingVerified: false, vantage: 'local' });
          }
        });
        response.on('end', () => {
          if (effect.sse && !firstEvent) finish(new Error('SSE ended before a complete event'));
          else finish(null, { status, stdout: body, stderr: '', exitCode: status >= 200 && status < 300 ? 0 : 1, vantage: 'local' });
        });
        response.on('error', error => finish(error));
      });
      this.activeRequests.add(request);
      const deadline = setTimeout(() => finish(new Error('Probe timed out')), bounded(effect.timeoutMs, 5_000, 120_000));
      request.on('error', error => finish(error));
    });
  }
  async verifyProbe(effect) {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error('Probe timed out')), bounded(effect.vantage && effect.vantage !== 'local' ? this.probeWaitMs ?? effect.timeoutMs : effect.timeoutMs, 5000, 600000));
    this.probeControllers.add(controller);
    try { return await this.verifyProbeBounded(effect, controller.signal); }
    finally { clearTimeout(deadline); this.probeControllers.delete(controller); }
  }
  cancelProbes() {
    for (const controller of this.probeControllers) controller.abort(new Error('Probe cancelled'));
    for (const request of this.activeRequests) request.destroy(new Error('Probe cancelled'));
  }
  async verifyProbeBounded(effect, signal) {
    const authorization = effect.probe ?? this.host.probe;
    const nowMs = this.nowMs();
    const origin = safeOrigin(effect.url ?? effect.origin);
    if (effect.tls === true && !origin.startsWith('https:')) throw new Error('HTTPS probe requirement cannot use an HTTP origin');
    if (!authorization || authorization.expiresAtMs <= nowMs || !this.gate || authorization.nonceRef !== this.host.probe?.nonceRef || authorization.verifierRef !== this.host.probe?.verifierRef || authorization.expiresAtMs !== this.host.probe?.expiresAtMs ||
        (effect.nonceRef && effect.nonceRef !== authorization.nonceRef) ||
        (effect.verifierRef && effect.verifierRef !== authorization.verifierRef)) throw new Error('Probe authorization missing, stale or mismatched');
    const vantage = effect.vantage ?? 'local';
    if (vantage !== 'local') {
      if (!this.probeExecutor || !this.probeExecutor.vantages?.includes(vantage) || typeof this.probeExecutor.verify !== 'function') {
        throw Object.assign(new Error('Remote validation required: configure a trusted executor on the client network.'), { code: 'needs-validation' });
      }
      let result;
      try { result = await Promise.race([this.probeExecutor.verify({ signal, origin, vantage, authorization: { ...authorization },
        challenge: this.gate.challenge(), networkTimeoutMs: bounded(effect.timeoutMs, 5000, 120000), requirements: { httpsRequired: effect.tls === true || origin.startsWith('https:'), sse: Boolean(effect.sse), streamableHttp: Boolean(effect.streamableHttp), oauthDcr: Boolean(effect.oauthDcr) } }), new Promise((resolve, reject) => {
        if (signal.aborted) reject(new Error('Probe cancelled'));
        else signal.addEventListener('abort', () => reject(new Error('Probe cancelled')), { once: true });
      })]); } catch (error) { throw Object.assign(new Error('Trusted outside validation pending or failed'), { code: error.code ?? 'needs-validation' }); }
      let receipt = result?.probeReceipt;
      const receivedAt = this.nowMs();
      const publicRelay = this.publicRelay === true && authorization.allowPublicRelay === true && vantage === 'public' && receipt?.networkPath === 'public-relay' && receipt.remote === false && receipt.publicDns === true && isPublicIp(receipt.resolvedIp) && receipt.tlsServername === new URL(origin).hostname;
      if (!receipt || receipt.nonceRef !== authorization.nonceRef || receipt.verifierRef !== authorization.verifierRef || receipt.origin !== origin ||
          receipt.vantage !== vantage || (!publicRelay && receipt.remote !== true) || receipt.observedAtMs < nowMs || receipt.observedAtMs > receivedAt || receipt.expiresAtMs <= receivedAt ||
          receipt.instanceMatched !== true || (origin.startsWith('https:') && receipt.tls !== true) ||
          (effect.sse && receipt.sse !== true) || (effect.streamableHttp && receipt.streamableHttp !== true) || (effect.oauthDcr && receipt.oauthDcr !== true)) throw new Error('Trusted remote probe returned an invalid or incomplete receipt');
      receipt = Object.fromEntries(['nonceRef', 'verifierRef', 'origin', 'vantage', 'remote', 'observedAtMs', 'expiresAtMs', 'tls', 'instanceMatched', 'sse', 'streamableHttp', 'oauthDcr', 'networkPath', 'publicDns', 'resolvedIp', 'resolver', 'tlsServername', 'relayHeaders'].map(key => [key, receipt[key]]));
      this.acceptedProbeReceipt = receipt; this.proofGeneration = effect.generation; this.proofProvenance = result.provenance;
      this.proofExpiries.set(effect.generation, Math.min(receipt.expiresAtMs, authorization.expiresAtMs));
      return { status: 200, vantage, probeReceipt: receipt, streaming: receipt.sse === true, streamableHttp: receipt.streamableHttp === true, oauthDcr: receipt.oauthDcr === true };
    }
    const checked = await this.gate.verify(origin, { sse: Boolean(effect.sse), signal });
    const observedAtMs = this.nowMs();
    const probeReceipt = { nonceRef: authorization.nonceRef, verifierRef: authorization.verifierRef, origin, vantage: 'local',
      observedAtMs, expiresAtMs: Math.min(observedAtMs + 15000, authorization.expiresAtMs), tls: checked.tls,
      instanceMatched: checked.instanceMatched, sse: checked.sse, streamableHttp: false, oauthDcr: false };
    this.acceptedProbeReceipt = probeReceipt; this.proofGeneration = effect.generation;
    this.proofExpiries.set(effect.generation, probeReceipt.expiresAtMs);
    return { status: 200, vantage: 'local', streaming: checked.streaming, streamableHttp: false, oauthDcr: false, probeReceipt };
  }
  async forward(effect) {
    if (effect.operation === 'remove') {
      const server = this.forwarders.get(effect.resourceId);
      if (!server) {
        const resource = this.journal.value.owned[effect.resourceId];
        if (!resource || resource.kind !== 'local-forwarder' || resource.sessionId !== this.sessionId || !resource.nonce ||
            !resource.daemonStartIdentity || await processIdentity(resource.daemonPid) === resource.daemonStartIdentity) {
          throw new Error('Forwarder ownership unavailable; reconcile required');
        }
        // The exact owning process is gone, so its in-process listening socket is gone too.
        if (effect.recipeRef || effect.retainRecord) { resource.retired = true; await this.journal.save(); }
        else await this.journal.removed(effect.resourceId);
        return { removed: true, resourceId: effect.resourceId };
      }
      const closed = new Promise(resolve => server.once('close', resolve));
      server.close(); server._ownedSockets.forEach(socket => socket.destroy());
      await closed;
      this.forwarders.delete(effect.resourceId);
      if (effect.recipeRef || effect.retainRecord) { this.journal.value.owned[effect.resourceId].retired = true; await this.journal.save(); }
      else await this.journal.removed(effect.resourceId);
      return { removed: true, resourceId: effect.resourceId };
    }
    if (effect.targetPort !== undefined && effect.targetPort !== this.targetPort) throw new Error('Forward target is outside approved port');
    if (effect.targetHost && effect.targetHost !== '127.0.0.1') throw new Error('Forward target must be loopback');
    const host = effect.bindAddress ?? '127.0.0.1';
    const exactInterface = selectedInterfaceAddress(host) && Object.values(networkInterfaces()).flat().some(address => address?.address === host && address.internal === false);
    if (host !== '127.0.0.1' && (!exactInterface || !this.bindAddresses.includes(host) || !this.firewallApproved)) {
      throw new Error('Firewall prerequisite: approve the exact interface before starting the forwarder');
    }
    if (effect.port && effect.port !== 0) throw new Error('Forwarder requires an owned ephemeral port');
    const details = this.ledgerDetails(effect, { bindAddress: host, targetHost: '127.0.0.1', targetPort: this.targetPort, scheme: 'http' });
    const sockets = new Set();
    const server = net.createServer(client => {
      const upstream = net.connect({ host: '127.0.0.1', port: this.targetPort });
      for (const socket of [client, upstream]) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); }
      client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
      client.pipe(upstream); upstream.pipe(client);
    });
    server._ownedSockets = sockets;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host, port: 0, exclusive: true }, resolve); });
    const id = randomUUID();
    const result = { resourceId: id, origin: `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`, port: server.address().port };
    this.forwarders.set(id, server);
    try { await this.journal.own({ id, kind: 'local-forwarder', sessionId: this.sessionId, generation: effect.generation,
      adapterId: this.selectedAdapter, continuityRef: randomUUID(), details, baseline: this.intentRecords.get(this.receiptKey(effect))?.baseline ?? {}, bindings: effect.bindings ?? {}, daemonPid: process.pid, daemonStartIdentity: await processIdentity(process.pid), nonce: randomUUID(), origin: result.origin }); }
    catch (error) { server.close(); this.forwarders.delete(id); throw error; }
    if (effect.recipeRef) result.ownership = this.ownership(this.journal.value.owned[id]);
    return result;
  }
  async closeLocal() {
    this.stopped = true;
    const failures = [];
    for (const [id, resource] of Object.entries(this.journal.value.owned)) {
      try {
        if (resource.kind === 'process') await this.removeProcess(id, { retainRecord: this.journal.value.state?.resources?.some(owned => owned.id === id && owned.cleanup !== 'removed') });
        else if (this.forwarders.has(id)) await this.forward({ operation: 'remove', resourceId: id, retainRecord: this.journal.value.state?.resources?.some(owned => owned.id === id && owned.cleanup !== 'removed') });
      } catch (error) { failures.push({ resourceId: id, detail: error.message }); }
    }
    for (const [id, resource] of Object.entries(this.journal.value.owned)) {
      if (resource.kind !== 'private-file' || Object.values(this.journal.value.owned).some(owned => owned.kind === 'process' && owned.artifacts?.includes(id))) continue;
      try { await this.privateFiles.remove(id); }
      catch (error) { failures.push({ resourceId: id, detail: error.message }); }
    }
    return failures;
  }
}
```

## Current packages/gozar-node/session-embedding.mjs

```js
// Host-owned authority for one operational controller incarnation. No secret bytes enter bootstrap.
import {randomBytes} from 'node:crypto';
import {loadAdapters} from './adapter-runtime.mjs';
import {registryIdentity} from './registry-identity.mjs';
import {connectEmbeddingBroker} from './embedding-broker.mjs';
import {currentRouteReview} from './route-consent.mjs';
import {consentReview,consentSnapshot} from './consent-facts.mjs';
import {fixtureSpawn} from './fixture-spawn.mjs';
import {testingFetch} from './testing-network.mjs';
import {gozarError,instructionAction} from './error-normalizer.mjs';

export async function connectSessionEmbedding(config,{onLoss}){
 const saved=config.embedding;if(!saved)return null;
 if(await registryIdentity(saved.registry)!==saved.registryId)throw gozarError('artifact_integrity_failed','The controller registry content changed');
 let lost=false,blocked=false,approved=saved.consentReview,current,subject=null;
 const services=await connectEmbeddingBroker({descriptor:saved.resolver,identity:saved.identity,onLoss:()=>{lost=true;blocked=true;onLoss();}});
 const adapters=await loadAdapters(saved.registry),adapter=adapters.find(a=>a.id===config.adapterId);
 if(!adapter)throw gozarError('artifact_integrity_failed','The selected controller adapter is absent');
 const dispatch=async request=>{
  if(!(adapter.definition.effectOperations??[]).some(row=>row.kind===request.kind&&row.operation===request.operation))throw gozarError('unsupported','The adapter has not declared this fixture effect operation');
  return services.dispatchEffect(request);
 };
 const deps={embeddingServices:services,registryId:saved.registryId,platform:process.platform,...(saved.fixtureEffects?{dispatchEffect:dispatch}:{})};
 const refresh=async()=>{
  if(lost)throw gozarError('secret_backend_unavailable','The host resolver is unavailable; readiness withdrawn');
  current=await currentRouteReview(saved.request,adapter,deps);
  if(current.review.consentFactsDigest!==approved.consentFactsDigest)blocked=true;
  return current;
 };
 const check=async()=>{await refresh();if(blocked)throw gozarError('consent_mismatch','Runtime consent changed; review the current route');};
 const tokens=new Map();
 return {
  ...(saved.fixtureEffects?{spawnProcess:fixtureSpawn(dispatch),fixtureVerifier:gate=>({vantages:['public','tailnet','lan'],async verify({origin,vantage,authorization,requirements,signal}){
   if(requirements.streamableHttp||requirements.oauthDcr)throw gozarError('unsupported','This fixture executor has no application protocol proof');
   const checked=await gate.verify(origin,{sse:requirements.sse,signal,fetch:testingFetch(dispatch)}),observedAtMs=Date.now();
   return {probeReceipt:{nonceRef:authorization.nonceRef,verifierRef:authorization.verifierRef,origin,vantage,remote:true,observedAtMs,expiresAtMs:Math.min(authorization.expiresAtMs,observedAtMs+15000),tls:checked.tls,instanceMatched:checked.instanceMatched,sse:checked.sse,streamableHttp:false,oauthDcr:false},provenance:{kind:'explicit-fixture-effects'}};
  }})}:{}),
  check,
  beforeEffect:async effect=>{if(['create','start'].includes(effect.operation))await check();},
  async project(output){
   try{await refresh();}catch{blocked=true;}
   const receipt=output.validation?.probeReceipt;
   if(receipt&&output.snapshot.phase==='published-ready')subject={origin:receipt.origin,target:saved.request.target,instanceId:saved.identity.instanceId,bootId:saved.identity.bootId,handleGeneration:1};
   const consentChange=blocked?{reason:lost?'host-resolver-unavailable':'consent-facts-changed',nextAction:lost?null:instructionAction('review-route-consent','Review changed route consent','Call reviewRouteConsent for this handle and show its current snapshot before approval.')}:null;
   return {...output,target:saved.request.target,owner:saved.request.owner,operationId:config.operationId??null,proofSubject:subject,fixtureEffects:saved.fixtureEffects===true,
    consentFactsDigest:current?.review.consentFactsDigest??approved.consentFactsDigest,...(consentChange?{consentChange}:{}),
    ...(blocked?{snapshot:{...output.snapshot,phase:output.snapshot.phase==='stopped'?'stopped':'degraded',published:null},validation:null}:{})};
  },
  async review(){
   blocked=true;await refresh();
   const scope={...current.review.canonicalInput.scope,reviewHandle:saved.handle.id,handleGeneration:saved.handle.generation};
   const review=consentReview({scope,typedDisclosures:current.review.canonicalInput.typedDisclosures,facts:current.review.canonicalInput.facts});
   const snapshot={...consentSnapshot(review),subject,approvalToken:randomBytes(32).toString('base64url'),expiresAt:new Date(Date.now()+600000).toISOString()};
   tokens.set(snapshot.approvalToken,{snapshot,review:current.review});return snapshot;
  },
  async approve(command,reprove){
   const offered=tokens.get(command.approvalToken);tokens.delete(command.approvalToken);await refresh();
   if(!offered||lost||Date.parse(offered.snapshot.expiresAt)<=Date.now()||offered.snapshot.consentFactsDigest!==command.consentFactsDigest||offered.review.consentFactsDigest!==current.review.consentFactsDigest||JSON.stringify(offered.snapshot.subject)!==JSON.stringify(subject))throw gozarError('consent_mismatch','The runtime review changed; request a new review');
   approved=current.review;blocked=false;
   try{const output=await reprove();await check();if(output.snapshot.phase!=='published-ready')throw gozarError('verification_failed','The existing route did not pass fresh proof');return output;}catch(error){blocked=true;throw error;}
  },
  async release(){if(!lost)await services.releaseConfigurationUse({owner:saved.request.owner,providerId:adapter.id,handle:saved.handle});},
  close(){services.close();},
 };
}
```

## Current packages/gozar-node/testing.mjs

```js
// Test helpers for an app that uses Gozar: a route API with no network, a fake provider, and a fake read context.
// Import them from '@tnunamak/gozar/testing'. Nothing here starts a tunnel, calls a provider or reads real credentials.
//
//   const registry = await fakeRegistry({ id: 'fake-0a1b2c3d', kinds: ['session'], reach: 'internet' });
//   const api = createRouteApi({ manifest: registry.manifest, root: registry.root, readContext: fakeReadContext({ home }) });
//   ...catalogRoutes, then expose with the candidate's token...
//   await registry.cleanup();
//
// A fake with kind 'durable' also keeps a rule store, a JSON file in the registry's own directory, so that separate
// processes see the same state. Pass `fakeReadContext({ verified })` to the route API and the durable route check answers as told.
import { mkdtemp, mkdir, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouteApi as createCoreRouteApi } from './route-api.mjs';
import { createReadContext } from './adapter-runtime.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gozarError } from './error-normalizer.mjs';
import { projectSession, projectDurable, projectAttached } from './route-view.mjs';
import { enrichRoute } from './embedding-state.mjs';
import {testingFetch} from './testing-network.mjs';
import {verification} from './service-state.mjs';

export { createReadContext };

/** Explicit fixture effects for the shipped trusted adapters. No ambient switch enables this. */
export async function createTestingGozar({effects,...options}={}){
  if(!Array.isArray(effects))throw gozarError('invalid_input','Testing effects must be an explicit mapping array');
  const handlers=new Map(),events=[],active=new Map(),abort=new AbortController();let closing;
  for(const effect of effects){
    if(typeof effect?.kind!=='string'||!effect.kind||typeof effect.operation!=='string'||!effect.operation||typeof effect.handle!=='function')throw gozarError('invalid_input','A testing effect needs kind, operation and handler');
    const key=JSON.stringify([effect.kind,effect.operation]);if(handlers.has(key))throw gozarError('invalid_input','Duplicate testing effect mapping');handlers.set(key,effect.handle);
  }
  const dispatchEffect=async request=>{
    const key=JSON.stringify([request?.kind,request?.operation]),handler=handlers.get(key);
    if(abort.signal.aborted||!handler)throw gozarError('unsupported','No matching testing effect is declared');
    const event={sequence:events.length,kind:request.kind,operation:request.operation,state:'requested',fixture:true};events.push(event);
    try{const result=await handler(structuredClone(request.input),{signal:abort.signal,fixture:true});event.state='completed';return structuredClone(result);}
    catch{event.state='failed';throw gozarError('provider_unavailable','The testing effect failed');}
  };
  const {manifest,root,secretBackend,hostCapabilities,identity}=options;
  const api=createCoreRouteApi({manifest,root,secretBackend,hostCapabilities,identity,dispatchEffect,
    verify:request=>verification(request,{fetch:testingFetch(dispatchEffect)})});
  const gozar={...api};
  const mark=value=>{const copy=structuredClone(value);copy.facts??=[];copy.facts.push({id:'gozar-testing-effects',label:'Fixture evidence',value:'Synthetic provider effects and isolated local transport; real provider acceptance is unverified.',known:true,group:'proof',affectsConsent:false,source:'@tnunamak/gozar/testing',asOf:null});return copy;};
  gozar.catalogRoutes=async request=>{const result=await api.catalogRoutes(request);return {...result,candidates:result.candidates.map(mark)};};
  gozar.listProviders=async request=>{const result=await api.listProviders(request);return {...result,providers:result.providers.map(mark)};};
  const track=(home,route)=>{for(const[key,prior]of active)if(prior.home===home&&prior.handle.kind===route.handle.kind&&prior.handle.id===route.handle.id&&prior.handle.generation<=route.handle.generation)active.delete(key);if(route.cleanup.state!=='confirmed')active.set(JSON.stringify(route.handle),{home,handle:route.handle,mode:'remove'});};
  for(const method of ['expose','ensureRoute','adoptRoute'])gozar[method]=async request=>{try{const route=mark(await api[method](request));track(request.home,route);return route;}catch(error){if(error.route){error.route=mark(error.route);track(request.home,error.route);}throw error;}};
  for(const method of ['routeStatus','suspendRoute','approveRouteConsent'])gozar[method]=async request=>mark(await api[method](request));
  gozar.listRoutes=async request=>{const result=await api.listRoutes(request);return {routes:result.routes.map(mark)};};
  gozar.watchRoutes=async function*(request){for await(const event of api.watchRoutes(request))yield event.route?{...event,route:mark(event.route)}:event;};
  gozar.closeRoute=async request=>{const route=mark(await api.closeRoute(request));if(route.cleanup.state==='confirmed')active.delete(JSON.stringify(route.handle));return route;};
  return {gozar,events,close:()=>closing??=(async()=>{const errors=[];for(const request of [...active.values()])try{const route=await gozar.closeRoute(request);if(route.cleanup.state!=='confirmed'){const error=gozarError('cleanup_debt','Fixture cleanup is unconfirmed; retain the route handle and retry');error.route=route;errors.push(error);}}catch(error){errors.push(error);}if(errors.length)throw errors[0];abort.abort();})().catch(error=>{closing=null;throw error;})};
}

/** Deterministic lifecycle projections for every admitted usage kind; no provider or process is started. */
export function fakeRouteScenarios({ target = '127.0.0.1:18765', now = Date.parse('2026-11-13T12:00:00Z') } = {}) {
  const properties = { reach: 'internet', transport: 'https', traffic: { tlsTermination: 'endpoint', providerCanReadPayload: false, readers: [], metadataVisibleTo: [], evidenceRef: 'testing' },
    address: { stability: 'stable', scope: 'fixture', conditions: [], ports: null }, cost: { kind: 'free', summary: 'Fixture', currency: null, amount: null, period: null },
    needsAccount: false, lifetimes: ['session', 'attached', 'durable'], supervision: 'controller', protocols: { sse: true, streamableHttp: true, oauthDcr: true }, proof: { vantage: 'this-device', checks: ['nonce', 'tls'] } };
  const origin = 'https://screen.example.invalid', checkedAt = new Date(now).toISOString(), future = new Date(now + 60_000).toISOString();
  return ['session', 'attached', 'durable'].flatMap(kind => ['detected', 'verified', 'expired', 'cleanup-unconfirmed'].map(state => {
    const handle = { kind, id: `fixture-${kind}`, generation: 1 }, verified = state !== 'detected';
    const subject={origin,target,instanceId:'fixture-instance',bootId:'fixture-boot',handleGeneration:handle.generation};
    const expiry = state === 'expired' ? new Date(now - 1).toISOString() : future;
    const options = { handle, properties, now };
    const route = kind === 'durable' ? projectDurable({ state: verified ? 'usable' : 'unverified', origin, target, verification: { status: verified ? 'verified' : 'unverified', checkedAt, validUntil: expiry,subject }, expiresAt: expiry }, options)
      : kind === 'attached' ? projectAttached({ state: verified ? 'usable' : 'unverified', origin, target, properties, checkedAtMs: now,proofSubject:subject, expiresAt: expiry }, options)
      : projectSession({proofSubject:subject,snapshot: { phase: verified ? 'published-ready' : 'candidate-ready', candidate: origin, published: verified ? origin : null, target, expiresAt: expiry, checkedAtMs: now } }, options);
    return enrichRoute({ ...route, cleanup: { state: state === 'cleanup-unconfirmed' ? 'unconfirmed' : 'none' } }, { target, expiresAt: expiry, validUntil: expiry, now });
  }));
}

/**
 * A read context whose probe and verification answer as told. `probeOk` is the detect verdict (default true);
 * `verified` is the outcome of a route check (default true). The testing `createRouteApi` also uses `verified` for the
 * challenge check of a durable route, so a durable fake answers as told too.
 */
export function fakeReadContext({ home, probeOk = true, verified = true, now = Date.now } = {}) {
  return createReadContext({
    home, platform: 'linux', now,
    configuration: async () => null,
    probe: async () => ({ ok: probeOk }),
    verifyChallenge: async () => ({ status: verified ? 'verified' : 'unverified', checkedAt: verified ? new Date(now()).toISOString() : null }),
  });
}

// An expose of kind session starts a controller process. A fake provider has none, so the testing API starts no process
// and answers as a controller that has a candidate address ready. A test may replace it with `expose: { startSession }`.
const fakeStartSession = options => ({ snapshot: { sessionId: `fake-${options.port}`, phase: 'candidate-ready', candidate: options.origin ?? 'https://fake.example.invalid', expiresAtMs: Date.now() + (options.lifetimeMs ?? 60_000) } });

/** The route API with no process or network: sessions are answered in memory. Same options as the package's own factory. */
export function createRouteApi(deps = {}) {
  // A durable route is checked by the challenge verifier. With a read context given, that verifier is the context's.
  const verify = deps.verify ?? (deps.readContext && (async ({ origin, target }) => {
    const checked = await deps.readContext.verifyChallenge(origin, target);
    return { method: 'challenge', error: checked.status === 'verified' ? null : 'fake', scope: 'controller-origin', ...checked };
  }));
  return createCoreRouteApi({ platform: 'linux', ...deps, ...(verify ? { verify } : {}), expose: { startSession: fakeStartSession, ...deps.expose } });
}

const KINDS = ['session', 'attached', 'durable'];
const REACHES = ['internet', 'tailnet', 'lan', 'this-device'];

const moduleSource = (actions = [], proofProtocol = 'http') => `// A fake provider written by @tnunamak/gozar/testing. It does nothing outside memory.
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
const definition = JSON.parse(readFileSync(new URL('./definition.json', import.meta.url), 'utf8')).adapter;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const servers = new Map();
const proofProtocol = ${JSON.stringify(proofProtocol)};
const mark = event => appendFileSync(new URL('./events.jsonl', import.meta.url), JSON.stringify({event}) + '\\n');
export default {
  id: definition.id,
  definition,
  async detect(ctx) { const seen = definition.supportedKinds.includes('attached') ? {ok:true} : await ctx.probe({ fake: true }); const values=await ctx.configuration(null);const missing=${JSON.stringify(actions)}.filter(action=>action.required!==false&&!values?.[action.id]);return {state:seen?.ok!==true?'unknown':missing.length?'action-required':'ready',facts:{fake:true,detected:seen?.ok===true,setupNeeded:missing.length>0,missing}}; },
  properties: () => structuredClone(definition.capabilities),
  configurationActions: () => ${JSON.stringify(actions)},
  setupActions: facts => facts?.missing ?? ${JSON.stringify(actions)},
  async setup() { mark('setup'); return { state: 'complete', nextAction: null }; },
  async plan(ctx, request) {
    const resourceKey = definition.id + ':' + sha({ target: request.target }).slice(0, 16);
    return { digest: sha({ id: definition.id, target: request.target, usage: request.usage?.kind }), origin: request.origin ?? null, resourceKey, effects: [{target: request.target}],
      readback: { kind: request.usage?.kind, origin: request.origin ?? null, target: request.target }, cleanup: { kind: 'fake' }, precondition: null };
  },
  ...(proofProtocol === 'echo' ? {
    async prepareProof(ctx, request, attempt) {
      let proving=true,witness=false,used=false;
      const [host,port]=request.target.split(':');
      const proof = net.createServer({allowHalfOpen:true}, socket => {
        if(!proving){const upstream=net.connect(Number(port),host);upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.pipe(upstream).pipe(socket);return;}
        let input=Buffer.alloc(0);socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);if(input.length>65){socket.destroy();return;}if(input.length===65){witness=input.equals(Buffer.from(attempt.nonce+'\\n'));socket.end(witness?input:Buffer.from('wrong\\n'));}});
      });
      await new Promise((resolve,reject)=>{proof.once('error',reject);proof.listen(0,'127.0.0.1',resolve);});
      return {target:'127.0.0.1:'+proof.address().port,
        async verify({origin,attempt:current}) {
          if(used)throw new Error('initial proof only');used=true;
          mark('proof'); const endpoint=new URL(origin);
          try {
            const matched=await new Promise(resolve=>{let input=Buffer.alloc(0);const socket=net.connect(Number(endpoint.port),endpoint.hostname);const timer=setTimeout(()=>{socket.destroy();resolve(false);},1000);
              socket.once('connect',()=>socket.write(current.nonce+'\\n'));socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);if(input.length>65){socket.destroy();clearTimeout(timer);resolve(false);}});socket.once('error',()=>{clearTimeout(timer);resolve(false);});socket.once('end',()=>{clearTimeout(timer);resolve(input.equals(Buffer.from(current.nonce+'\\n')));}); });
            return {status:matched&&witness?'verified':'unverified',attemptId:current.id,endpoint:origin,checkedAt:new Date().toISOString(),validUntil:new Date(Date.now()+5000).toISOString(),vantage:'this-device',checks:['nonce'],facts:[]};
          } finally {proving=false;}
        },async close(){await new Promise(resolve=>proof.close(resolve));}};
    }
  }:{}),
  async create(ctx, plan) {
    const forwarding = ['attached', 'session'].includes(plan.readback.kind);
    if (forwarding && proofProtocol === 'echo') {
      const [host,port]=plan.effects[0].target.split(':');
      const server=net.createServer({allowHalfOpen:true}, socket=>{const upstream=net.connect(Number(port),host);upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.pipe(upstream).pipe(socket);});
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});servers.set(plan.resourceKey,server);plan={...plan,origin:'tcp://127.0.0.1:'+server.address().port};mark('start');
    } else if (forwarding) {
      const target = new URL('http://' + plan.effects[0].target);
      const server = http.createServer((req,res) => {
        const upstream = http.request({hostname:target.hostname,port:target.port,path:req.url,method:req.method,headers:req.headers}, reply => { res.writeHead(reply.statusCode,reply.headers); reply.pipe(res); });
        upstream.on('error',()=>{res.writeHead(502);res.end();}); req.pipe(upstream);
      });
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      servers.set(plan.resourceKey,server); plan={...plan,origin:'http://127.0.0.1:'+server.address().port};mark('start');
    }
    return { schemaVersion: 1, adapterId: definition.id, resourceKey: plan.resourceKey, generation: ctx.generation ?? 1,operationId:ctx.operationId??null, identity: null, readback: plan.readback, origin: plan.origin ?? 'https://' + definition.id + '.example.invalid' };
  },
  async observe(ctx, request) { return { present: false, resourceKey: definition.id + ':' + sha({ target: request.target }).slice(0, 16), identity: null, revision: null }; },
  async verify(ctx, receipt) { mark('proof'); return ctx.verifyChallenge(receipt?.readback?.origin ?? receipt?.origin ?? '', receipt?.readback?.target ?? ''); },
  async remove(ctx,receipt) { mark('stop'); const server=servers.get(receipt.resourceKey); if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));servers.delete(receipt.resourceKey);} mark('cleanup');return { removed: true, debt: null }; },
  async runtimeFacts() { return { properties: structuredClone(definition.capabilities), ingress: null, limits: { recommendedPollIntervalMs: 5000, idleTimeoutMs: null } }; },
};
`;

// The module of a fake that also has the durable kind. It keeps the session methods above, and answers the durable
// ones through the engine's own adapter, with a facet whose rule store is `store.json` next to the module: a version
// counter is the compare-and-set token, and a write is a rename, so another process sees whole states only.
const durableModuleSource = runtime => `// A fake durable provider written by @tnunamak/gozar/testing. Its rule store is the file store.json beside this module.
import { recipeAdapter } from ${JSON.stringify(runtime)};
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
// The session methods live in plain.mjs, written beside this file; it is loaded by URL so the text of this template is
// never mistaken for an import of the testing module itself.
const { default: plain } = await import(new URL('./plain.mjs', import.meta.url));

const storePath = new URL('./store.json', import.meta.url);
const read = () => JSON.parse(readFileSync(storePath, 'utf8'));
const write = state => { const temporary = new URL('./store.json.tmp', import.meta.url); writeFileSync(temporary, JSON.stringify(state)); renameSync(temporary, storePath); };
const slotIds = ['a', 'b', 'c'];

function durableFacet(definition) {
  return {
    family: 'fake',
    definition,
    async observe() { const state = read(); return { identity: state.identity, snapshot: state.entries, version: String(state.version) }; },
    slots: () => slotIds.map(slot => ({ slot, origin: 'https://' + slot + '.' + plain.id + '.invalid', permitted: true })),
    read: (snapshot, slot) => snapshot[slot]?.rule ?? null,
    foreign: (snapshot, slot) => snapshot[slot]?.foreign === true,
    occupied: (snapshot, slot) => snapshot[slot] !== undefined,
    expand: target => ({ forward: target }),
    expiresAt: () => null,
    async put(ctx, { slot, rule, version }) {
      const state = read();
      if (version !== String(state.version)) return 'conflict';
      state.entries[slot] = { rule }; state.version += 1; write(state);
      return 'written';
    },
    async delete(ctx, { slot, rule, version }) {
      const state = read();
      if (version !== String(state.version) || !isDeepStrictEqual(state.entries[slot]?.rule, rule)) return 'conflict';
      delete state.entries[slot]; state.version += 1; write(state);
      return 'written';
    },
  };
}

const base = recipeAdapter({ definition: new URL('./definition.json', import.meta.url), extend: ({ wrapped }) => ({ durable: durableFacet(wrapped) }) });
const isDurable = value => value === 'durable';
export default {
  ...plain,
  durable: base.durable,
  plan: (ctx, request) => (isDurable(request.usage?.kind) ? base.plan(ctx, request) : plain.plan(ctx, request)),
  observe: (ctx, request) => (isDurable(request.usage?.kind) ? base.observe(ctx, request) : plain.observe(ctx, request)),
  verify: (ctx, receipt) => (isDurable(receipt?.readback?.kind) ? base.verify(ctx, receipt) : plain.verify(ctx, receipt)),
  remove: (ctx, receipt, ...rest) => (isDurable(receipt?.readback?.kind) ? base.remove(ctx, receipt, ...rest) : plain.remove(ctx, receipt, ...rest)),
};
`;
// The Query's protocol words; a fake inspects no traffic, so it can carry each of them.
const PROTOCOLS = ['sse', 'streamable-http', 'oauth-dcr'];
const runtimeUrl = pathToFileURL(fileURLToPath(new URL('./adapter-runtime.mjs', import.meta.url))).href;

/**
 * Writes a one-provider registry to a scratch directory and returns `{ manifest, root, cleanup }`, which is what
 * `createRouteApi({ manifest, root })` loads. `kinds` is any of 'session' and 'durable'. A durable fake keeps its
 * rules in `<root>/providers/<id>/store.json` (read it to see what the provider holds; a rule is `entries.<slot>.rule`), so
 * another process sees the same state. The fake never touches the network. `id` is the id the catalog shows as `providerId`.
 * `protocols` uses the Query's words ('sse', 'streamable-http', 'oauth-dcr'); a fake carries all three unless a test narrows it,
 * so an app's protocol requirements do not make its own fake ineligible.
 */
export async function fakeRegistry({ id, label, kinds, reach, transport = 'https', protocols = PROTOCOLS, dir, facts = [], setupActions = [], proofProtocol = 'http' } = {}) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw gozarError('invalid_input', 'fakeRegistry needs an id of lowercase letters, digits and hyphens');
  // An attached fake would make expose start a real controller process, so only session and durable fakes exist.
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(kind => !KINDS.includes(kind))) throw gozarError('invalid_input', `fakeRegistry kinds must be a non-empty list of ${KINDS.join(' and ')}: only session and durable fakes are supported`);
  if (!REACHES.includes(reach)) throw gozarError('invalid_input', `fakeRegistry reach must be one of ${REACHES.join(', ')}`);
  if (!['https', 'http', 'tcp', 'tls'].includes(transport)) throw gozarError('invalid_input', "fakeRegistry transport must be 'https' or 'http'");
  if (!Array.isArray(protocols) || protocols.some(item => !PROTOCOLS.includes(item))) throw gozarError('invalid_input', `fakeRegistry protocols must be a list of ${PROTOCOLS.join(', ')}`);
  const own = dir === undefined;
  const root = dir ?? await mkdtemp(join(tmpdir(), 'gozar-fake-'));
  const folder = join(root, 'providers', id);
  await mkdir(folder, { recursive: true });
  const definition = {
    schemaVersion: 1, id, label: label ?? `Fake ${id}`, needs: 'Needs nothing: this is a test fake.',
    capabilities: {
      reach, transport,
      traffic: { tlsTermination: transport === 'https' ? 'provider' : 'unknown', providerCanReadPayload: ['tcp','tls'].includes(transport) ? null : false, readers: [], metadataVisibleTo: [], evidenceRef: 'testing' },
      address: { stability: 'unknown', scope: 'a fake address that exists only in memory', conditions: [], ports: null },
      cost: { kind: 'free', summary: 'A fake costs nothing.', currency: null, amount: null, period: null },
      needsAccount: false, lifetimes: [...kinds], supervision: 'controller',
      protocols: { sse: protocols.includes('sse'), streamableHttp: protocols.includes('streamable-http'), oauthDcr: protocols.includes('oauth-dcr') },
      proof: { vantage: 'this-device', checks: ['nonce'] },
    },
    supportedKinds: [...kinds], facts, ...(proofProtocol === 'echo' ? {originSchemes:['tcp:']} : {}),
    disclosure: { revision: `disc-${id}`, text: 'A fake provider used in tests. Nothing leaves this process.', links: [] },
    ownership: 'gozar-owned',
  };
  await writeFile(join(folder, 'definition.json'), JSON.stringify({ adapter: definition }, null, 2));
  if (kinds.includes('durable')) {
    // The durable engine reads the provider's durable recipe from the wrapped definition of the recipe adapter.
    definition.capabilities.address.stability = 'stable';
    await writeFile(join(folder, 'definition.json'), JSON.stringify({ wraps: './wrapped.definition.json', adapter: definition }, null, 2));
    await writeFile(join(folder, 'wrapped.definition.json'), JSON.stringify({ schemaVersion: 1, definition: {
      id, planVersion: 1, idleTimeoutMs: null, providerResource: `${id}-slot`, addressStability: 'stable', durableLifetime: 'provider-persistent',
      actions: [], recipes: {}, durableRecipe: { mode: 'fake', slots: ['a', 'b', 'c'], listener: { forward: '{target}' } } } }, null, 2));
    await writeFile(join(folder, 'store.json'), JSON.stringify({ identity: `store-${id}`, version: 1, entries: {} }));
    await writeFile(join(folder, 'plain.mjs'), moduleSource(setupActions, proofProtocol));
    await writeFile(join(folder, 'index.mjs'), durableModuleSource(runtimeUrl));
  } else {
    await writeFile(join(folder, 'index.mjs'), moduleSource(setupActions, proofProtocol));
  }
  return {
    manifest: { providers: [{ id, module: `providers/${id}/index.mjs`, definition: `providers/${id}/definition.json` }] },
    root,
    cleanup: async () => { await rm(own ? root : join(root, 'providers', id), { recursive: true, force: true }); if (!own) await rmdir(join(root, 'providers')).catch(error => { if (!['ENOTEMPTY', 'ENOENT', 'EEXIST'].includes(error.code)) throw error; }); },
  };
}
```

## Current adapters/providers/own-address/index.mjs

```js
// own-address: an HTTPS address the owner already runs. Gozar creates and deletes nothing; it validates the address
// against this instance and keeps a record of it. The adapter is wrapped over its existing recipe definition (see
// ../../../packages/gozar-node/adapter-runtime.mjs) and adds what the owner's address needs:
//   - the address comes from the query (`ctx.origin`) or from a value the owner gave a `provide-value` action;
//   - without one the adapter is `action-required` and asks for it with one `provide-value` action;
//   - with one, its reach follows the address's host, and its proof is a check from this device until verified;
//   - a durable plan: the owner-run route kept as a service record.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { recipeAdapter, effectError } from '../../../packages/gozar-node/adapter-runtime.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A credential-free https origin, or null. */
function parseOrigin(value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname) return null;
  return url.pathname === '' || url.pathname === '/' ? url.origin : null;
}

const IPV4_PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./];
// 100.64.0.0/10 is shared carrier-grade NAT space: not public, and not a network this device can name. Its reach is unknown.
const sharedNat = host => { const [a, b] = host.split('.').map(Number); return a === 100 && b >= 64 && b <= 127; };
/** Where the address can be reached from: loopback is this device, a private address or a local name is the local network. */
export function reachOf(origin) {
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const family = isIP(host);
  // 0.0.0.0/8 means "this network", and 224.0.0.0/3 is multicast, reserved and broadcast: none is one remote host.
  if (family === 4) {
    const first = Number(host.split('.')[0]);
    return first === 0 || first >= 224 ? 'unknown' : first === 127 ? 'this-device' : IPV4_PRIVATE.some(pattern => pattern.test(host)) ? 'lan' : sharedNat(host) ? 'unknown' : 'internet';
  }
  if (family === 6) {
    if (host === '::1') return 'this-device';
    // A prefix test needs the whole first hextet: the parser drops leading zeros, so 00fd::1 prints as fd::1.
    if (host === '::' || /^ff[0-9a-f]{2}:/.test(host)) return 'unknown'; // unspecified, multicast
    // An IPv4-mapped address (::ffff:a.b.c.d) is classified as that IPv4 address. The deprecated IPv4-compatible
    // form (::a.b.c.d) is not routed as IPv4, so only its loopback reading is kept and anything else is unknown.
    // The URL parser prints both in hex, for example [::ffff:7f00:1] for 127.0.0.1, and drops a zero high hextet,
    // so ::0.0.0.2 prints as [::2].
    const embedded = host.match(/^::(ffff:)?(?:([0-9a-f]{1,4}):)?([0-9a-f]{1,4})$/);
    if (embedded) {
      const high = parseInt(embedded[2] ?? '0', 16), low = parseInt(embedded[3], 16);
      const ipv4 = reachOf(`https://${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      return embedded[1] || ipv4 === 'this-device' ? ipv4 : 'unknown';
    }
    return /^(f[cd][0-9a-f]{2}|fe[89a-f][0-9a-f]):/.test(host) ? 'lan' : 'internet'; // unique-local, link-local, old site-local
  }
  if (host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.localhost')) return 'this-device';
  return !host.includes('.') || /(^|\.)home\.arpa$/.test(host) || /\.(local|lan|internal)$/.test(host) ? 'lan' : 'internet';
}

export default recipeAdapter({
  definition: new URL('./definition.json', import.meta.url),
  externalOwned: true, // the owner keeps the route; nothing is created or deleted
  extend: ({ base, definition, platformOf, unsupported }) => {
    const originAction = (() => {
      const body = { id: 'origin', kind: 'provide-value', label: 'Provide the HTTPS address you run', valueLabel: 'HTTPS address',
        valuePlaceholder: 'https://app.example.com', valueFormat: 'https-origin', required: true, disclosure: definition.disclosure };
      return { ...body, digest: sha(body) };
    })();
    const given = async ctx => ctx.origin == null ? parseOrigin((await ctx.configuration(null).catch(() => null))?.origin) : parseOrigin(ctx.origin);

    return {
      async detect(ctx) {
        const result = await base.detect(ctx);
        if (result.state !== 'ready') return result;
        // An origin the app named that is not a credential-free https origin cannot be fixed by the owner's action.
        if (ctx.origin != null && parseOrigin(ctx.origin) === null) return { state: 'unsupported', facts: { ...result.facts, setupNeeded: false, origin: null, reach: 'unknown', invalidOrigin: ctx.origin } };
        const origin = await given(ctx);
        return origin
          ? { state: 'ready', facts: { ...result.facts, setupNeeded: false, origin, reach: reachOf(origin) } }
          : { state: 'action-required', facts: { ...result.facts, setupNeeded: true, origin: null, reach: 'unknown' } };
      },

      // The proof is a check from this device until the route is verified; Gozar claims no wider vantage.
      properties: facts => ({ ...base.properties(), reach: facts?.reach ?? 'unknown', proof: { vantage: 'this-device', checks: ['tls', 'nonce'] } }),

      setupActions: facts => (facts?.setupNeeded ? [structuredClone(originAction)] : []),

      async setup(ctx, actionId) {
        if (actionId !== originAction.id) throw unsupported(`setup action ${String(actionId).slice(0, 64)}`);
        return { state: 'pending', nextAction: structuredClone(originAction) };
      },

      async plan(ctx, request) {
        platformOf(ctx);
        const origin = request?.origin == null ? await given(ctx) : parseOrigin(request.origin);
        if (request?.origin != null && !origin) throw effectError('invalid_input', 'The requested origin is invalid');
        if (!origin) throw effectError('setup_required', 'Provide the HTTPS address you run first');
        // Detect and plan consume the same scoped mapping, including session plans.
        if (request?.usage?.kind !== 'durable') return base.plan(ctx, { ...request, origin });
        const resourceKey = `${definition.id}:${sha({ target: request.target, origin }).slice(0, 16)}`;
        return { digest: sha({ adapterId: definition.id, kind: 'durable', target: request.target, origin, resourceKey }), origin, resourceKey, effects: [],
          readback: { kind: 'durable', origin, target: request.target }, cleanup: { kind: 'external-owned' }, precondition: null };
      },
    };
  },
});
```

## Current adapters/providers/own-address/definition.json

```json
{
  "wraps": "../../own-address.definition.json",
  "adapter": {
    "schemaVersion": 1,
    "id": "own-address",
    "label": "Your own HTTPS address",
    "needs": "Needs an HTTPS address that you run yourself and that forwards to this service.",
    "capabilities": {
      "reach": "unknown",
      "transport": "https",
      "traffic": {
        "tlsTermination": "unknown",
        "providerCanReadPayload": null,
        "readers": [
          "the owner-managed proxy"
        ],
        "metadataVisibleTo": [
          "unknown"
        ],
        "evidenceRef": "adapters/own-address.definition.json"
      },
      "address": {
        "stability": "stable",
        "scope": "the owner-managed origin",
        "conditions": [
          "the owner keeps the route and the certificate",
          "a successful response alone does not prove the correct application or outside reach"
        ],
        "ports": null
      },
      "cost": {
        "kind": "free",
        "summary": "Gozar charges nothing; your own domain, hosting and certificate cost whatever you pay for them.",
        "currency": null,
        "amount": null,
        "period": null
      },
      "needsAccount": null,
      "lifetimes": [
        "session",
        "durable"
      ],
      "supervision": "controller",
      "protocols": {
        "sse": true,
        "streamableHttp": true,
        "oauthDcr": true
      },
      "proof": {
        "vantage": "public",
        "checks": [
          "tls",
          "nonce",
          "sse"
        ]
      }
    },
    "supportedKinds": [
      "session",
      "durable"
    ],
    "disclosure": {
      "revision": "disc-6046ee9650c1",
      "text": "Validate an existing owner-managed HTTPS origin against this instance. The address, route and certificate stay under the owner\u2019s control; Gozar creates and deletes nothing.",
      "links": []
    },
    "ownership": "external-owned",
    "availability": {
      "session": {
        "state": "available",
        "reason": "admitted"
      },
      "attached": {
        "state": "unsupported",
        "reason": "usage-not-supported"
      },
      "durable": {
        "state": "available",
        "reason": "admitted"
      }
    },
    "prerequisites": [
      {
        "id": "local-setup",
        "label": "Local prerequisites",
        "observation": "detected"
      }
    ],
    "facts": [
      {
        "id": "cost-detail",
        "label": "Cost details",
        "value": "Gozar charges nothing; your own domain, hosting and certificate cost whatever you pay for them.",
        "known": true,
        "group": "cost",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "entitlement",
        "label": "Account entitlement",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "account",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "quota",
        "label": "Remaining quota",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "limits",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "mapping",
        "label": "Effective provider mapping",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "configuration",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "address-condition-0",
        "label": "Address condition",
        "value": "the owner keeps the route and the certificate",
        "known": true,
        "group": "address",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "address-condition-1",
        "label": "Address condition",
        "value": "a successful response alone does not prove the correct application or outside reach",
        "known": true,
        "group": "address",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "public-names",
        "label": "Public names",
        "value": null,
        "known": false,
        "reason": "not-observed",
        "group": "privacy",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "certificate-logs",
        "label": "Certificate logs",
        "value": null,
        "known": false,
        "reason": "not-observed",
        "group": "privacy",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "browser-warning",
        "label": "Browser warning",
        "value": null,
        "known": false,
        "reason": "not-observed",
        "group": "access",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "provider-clocks",
        "label": "Actual provider expiry and quota window",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "limits",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "provider-retry",
        "label": "Current provider retry-after or refusal",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "limits",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "diagnostics-access",
        "label": "Current account diagnostic access",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "account",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "credential-validity",
        "label": "Current credential validity",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "account",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "traffic-policy",
        "label": "Effective remote traffic policy",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "access",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "certificate-renewal",
        "label": "Current CA issuance or renewal outcome",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "privacy",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "dns-authority",
        "label": "Current DNS configuration and token grants",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "configuration",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "authoritative-address",
        "label": "Current authoritative provider domain",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "address",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "account-authorization",
        "label": "Current organization approval and ACL entitlement",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "access",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "remote-residue",
        "label": "Remote DNS, certificate and token residue",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "ownership",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "alternative-cost",
        "label": "Account-specific alternative cost and quota",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "cost",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-12"
      },
      {
        "id": "proof-scope",
        "label": "Proof scope",
        "value": "Route transport and current Gozar boundary only; application login, authorization and downstream journeys are host-owned.",
        "known": true,
        "group": "proof",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "storage-policy",
        "label": "Credential storage",
        "value": "The configured host credential backend owns custody; the default uses private local files. Read-back returns presence and non-secret values only.",
        "known": true,
        "group": "setup",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "change-policy",
        "label": "Configuration changes",
        "value": "Saved inputs do not silently reconfigure a running route; stop and obtain fresh consent before replacing it.",
        "known": true,
        "group": "configuration",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "fallback-policy",
        "label": "Fallback policy",
        "value": "Never substitute a different provider without consent.",
        "known": true,
        "group": "access",
        "affectsConsent": false,
        "source": "adapter-definition",
        "asOf": "2026-11-13"
      },
      {
        "id": "remote-termination",
        "label": "Effective remote TLS termination",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "privacy",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-logging",
        "label": "Account-selected logging and retention",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "privacy",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-name-ownership",
        "label": "Current reserved name ownership",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "address",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-setup-completion",
        "label": "Provider consent or remote setup completion",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "provider-status",
        "label": "Current provider dashboard status",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "runtime",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "browser-warning-applicability",
        "label": "Account-specific browser warning applicability",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "access",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-collision",
        "label": "Current remote endpoint collision",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "address",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "revocation-state",
        "label": "Actual credential revocation and remaining connectors",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-control-authority",
        "label": "Current remote binding and controller authority",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "provider-depletion",
        "label": "Current provider depletion or license expiry",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "limits",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-domain-options",
        "label": "Account reserved-domain choices",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "account-domain-suggestion",
        "label": "Current account-assigned suggested domain",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-issuance",
        "label": "Provider credential issuance or refresh outcome",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-job-completion",
        "label": "Provider provisioning job completion",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "setup",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-identity",
        "label": "Authenticated remote account or tunnel identity",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "account",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-rotation",
        "label": "Remote credential rotation outcome",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "remote-deletion-proof",
        "label": "Remote revocation and deletion proof",
        "value": null,
        "known": false,
        "reason": "needs-provider-call",
        "group": "ownership",
        "affectsConsent": false,
        "source": "gozar:catalog:no-provider-call",
        "asOf": null
      },
      {
        "id": "retained-configuration",
        "label": "Retained configuration",
        "value": "Stopping a route keeps saved input values and credentials. Local rotation does not revoke a credential at the provider.",
        "known": true,
        "group": "ownership",
        "affectsConsent": false,
        "source": "adapter-configuration",
        "asOf": "2026-11-13"
      }
    ],
    "effectOperations": [
      {
        "kind": "recipe",
        "operation": "probe"
      },
      {
        "kind": "spawn",
        "operation": "run"
      },
      {
        "kind": "spawn",
        "operation": "read"
      },
      {
        "kind": "spawn",
        "operation": "close"
      },
      {
        "kind": "network",
        "operation": "fetch"
      }
    ]
  },
  "evidence": {
    "accessed": "2026-11-12",
    "sources": [],
    "protocols": {
      "sse/streamableHttp": "true. Backed by validation.sse (timed incremental event delivery when required) and validation.publish (exact-origin approval only after all required probes) in the wrapped recipe definition, with admission.requiredFeatures probe-assertions and client-vantage-probe.",
      "oauthDcr": "oauthDcr: the owner-managed HTTPS origin is stable by definition of this adapter, and the configured authority is preserved."
    }
  }
}
```

## Current adapters/own-address.definition.json

```json
{
  "schemaVersion": 1,
  "definition": {
    "id": "own-address",
    "addressStability": "stable",
    "durableLifetime": null,
    "idleTimeoutMs": null,
    "label": "Your own HTTPS address",
    "audience": "public",
    "ownership": "external-owned",
    "reason": "Validate an existing owner-managed origin; no route is created or deleted.",
    "capabilities": {
      "https": null,
      "sse": null,
      "streamableHttp": null,
      "oauthDcr": null
    },
    "unknowns": [
      "Current capability requires a successful probe from the intended client network.",
      "A successful HTTP response alone does not prove the correct application or external reach."
    ],
    "capabilityRecords": [
      {
        "when": "public TLS/instance probe succeeds",
        "capabilities": {
          "https": true
        }
      },
      {
        "when": "each requested transport probe succeeds",
        "capabilities": {
          "sse": true,
          "streamableHttp": true,
          "oauthDcr": true
        }
      }
    ],
    "actions": [
      {
        "id": "configure-origin",
        "label": "Point your reverse proxy at this instance",
        "reason": "The route and certificate remain under your ownership."
      },
      {
        "id": "validate-origin",
        "label": "Check the exact address",
        "reason": "TLS, instance identity and streaming must match before publication."
      }
    ],
    "recipes": {
      "detect": {
        "kind": "http-probe",
        "url": "{externalOrigin}",
        "timeoutMs": 10000,
        "maxOutputBytes": 16384,
        "parser": {
          "kind": "json-document",
          "predicate": {
            "op": "exists",
            "pointer": ""
          }
        }
      }
    },
    "admission": {
      "state": "admitted",
      "requiredFeatures": [
        "typed-bindings",
        "probe-assertions",
        "client-vantage-probe"
      ],
      "reason": "Normalized validate-only plan; trusted explicit origin and genuine public probe receipt required."
    },
    "validation": {
      "tls": "client-trusted certificate and exact hostname when HTTPS",
      "instanceNonce": "must equal private instance challenge",
      "sse": "timed incremental event delivery when required",
      "vantage": "public",
      "publish": "exact-origin approval only after all required probes"
    },
    "lifecycle": {
      "persistIntentBeforeMutation": false,
      "completionScope": [
        "effectId",
        "sessionId",
        "generation"
      ],
      "rawOutput": "transient bounded; never persist",
      "stop": "withdraw local publication only; never mutate external route",
      "globalCleanup": false
    },
    "endpoint": null,
    "bindings": {
      "externalOrigin": {
        "type": "credential-free-https-origin"
      }
    },
    "planVersion": 1,
    "endpointTemplate": "{externalOrigin}",
    "drop": "1",
    "displayName": "Your own HTTPS address",
    "copy": {
      "consent": "Validate this exact owner-managed HTTPS origin against this instance and requested protocols. The address remains under its owner\u2019s control.",
      "human": {
        "name": "own-address",
        "address": "supply your HTTPS address with --origin URL",
        "summary": "use your existing HTTPS proxy",
        "setup": "Use --origin https://your.domain and point your proxy at the local port Gozar prints after approval, not at {target}"
      }
    },
    "setup": {
      "requiresProxyTarget": true
    }
  }
}
```

## Current crates/gozar-core/src/lib.rs

```js
//! Deterministic transition machine. All environmental work is returned as effects.
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;
mod operational;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EffectKind {
    Spawn,
    ReadFile,
    HttpProbe,
    Interfaces,
    LocalForwarder,
    OwnedProcess,
    Persist,
    Timer,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub kind: EffectKind,
    #[serde(flatten)]
    pub fields: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
    pub id: String,
    pub audience: String,
    pub ownership: String,
    #[serde(default)]
    pub capabilities: BTreeMap<String, Value>,
    #[serde(default)]
    pub recipes: BTreeMap<String, Recipe>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub unknowns: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bindings: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admission: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_version: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint_template: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_policy: Option<String>,
    #[serde(default)]
    pub actions: Vec<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Requirements {
    #[serde(default = "unknown")]
    pub client_reach: String,
    #[serde(default)]
    pub https_required: bool,
    #[serde(default)]
    pub sse: bool,
    #[serde(default)]
    pub streamable_http: bool,
    #[serde(default)]
    pub oauth_dcr: bool,
}
fn unknown() -> String {
    "unknown".into()
}
impl Default for Requirements {
    fn default() -> Self {
        Self {
            client_reach: unknown(),
            https_required: false,
            sse: false,
            streamable_http: false,
            oauth_dcr: false,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub id: String,
    pub session_id: String,
    pub generation: u64,
    pub kind: EffectKind,
    pub operation: String,
    pub adapter_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(flatten)]
    pub fields: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub adapter_id: String,
    pub generation: u64,
    pub ownership: String,
    pub cleanup: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ledger: Option<operational::Ledger>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pending {
    effect: Effect,
    adapter_id: String,
    parser: Value,
    #[serde(default)]
    after: Option<Recipe>,
    #[serde(default)]
    resource_id: Option<String>,
    #[serde(default)]
    origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    plan_ticket: Option<operational::Ticket>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub session_id: String,
    pub generation: u64,
    pub sequence: u64,
    pub phase: String,
    pub stop_requested: bool,
    pub candidate: Option<String>,
    pub published: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_route_change: Option<Value>,
    pub adapters: Vec<Adapter>,
    pub requirements: Requirements,
    pub selected: Option<String>,
    pub resources: Vec<Resource>,
    pub observations: BTreeMap<String, String>,
    pub recommendations: Vec<String>,
    pub limitations: Vec<String>,
    pending: BTreeMap<String, Pending>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    execution: Option<operational::Execution>,
    #[serde(default)]
    host: operational::Host,
    #[serde(default)]
    used_nonces: Vec<String>,
    // Original authorization deadlines; absent entries are legacy and never retired.
    #[serde(default)]
    used_nonce_expiries: BTreeMap<String, u64>,
    #[serde(default)]
    pub plans: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    health_expiry: Option<u64>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            session_id: "session".into(),
            generation: 0,
            sequence: 0,
            phase: "idle".into(),
            stop_requested: false,
            candidate: None,
            published: None,
            last_route_change: None,
            adapters: vec![],
            requirements: Requirements::default(),
            selected: None,
            resources: vec![],
            observations: BTreeMap::new(),
            recommendations: vec![],
            limitations: vec![],
            pending: BTreeMap::new(),
            execution: None,
            host: operational::Host::default(),
            used_nonces: vec![],
            used_nonce_expiries: BTreeMap::new(),
            plans: vec![],
            health_expiry: None,
        }
    }
}
#[derive(Deserialize)]
struct Input {
    #[serde(default)]
    state: State,
    command: Value,
    adapters: Option<Vec<Adapter>>,
    requirements: Option<Requirements>,
    #[serde(default)]
    host: Option<operational::Host>,
}
#[derive(Serialize)]
pub struct Output {
    pub state: State,
    pub events: Vec<Value>,
    pub effects: Vec<Effect>,
    pub snapshot: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<Value>,
}

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn event(out: &mut Output, kind: &str) {
    out.events.push(
        json!({"type":kind,"sessionId":out.state.session_id,"generation":out.state.generation}),
    );
}
fn limit(out: &mut Output, text: &str) {
    if !out.state.limitations.iter().any(|x| x == text) {
        out.state.limitations.push(text.into());
    }
}
fn reach_allowed(audience: &str, reach: &str) -> bool {
    match audience {
        "public" => matches!(
            reach,
            "internet" | "unknown" | "tailnet" | "lan" | "this-device"
        ),
        "tailnet" => matches!(reach, "tailnet" | "this-device"),
        "lan" => matches!(reach, "lan" | "this-device"),
        "local" => reach == "this-device",
        _ => false,
    }
}
fn eligible(a: &Adapter, r: &Requirements) -> bool {
    reach_allowed(&a.audience, &r.client_reach)
        && [
            ("https", r.https_required || a.audience == "public"),
            ("sse", r.sse),
            ("streamableHttp", r.streamable_http),
            ("oauthDcr", r.oauth_dcr),
        ]
        .iter()
        .all(|(k, required)| !required || a.capabilities.get(*k) == Some(&Value::Bool(true)))
}
fn emit(
    out: &mut Output,
    adapter: &str,
    operation: &str,
    recipe: Recipe,
    after: Option<Recipe>,
    resource_id: Option<String>,
    origin: Option<String>,
) {
    out.state.sequence += 1;
    let mut fields = recipe.fields;
    let parser = fields
        .remove("parser")
        .unwrap_or(json!({"kind":"exit-code"}));
    // Scope fields always come from the machine, never from an adapter recipe.
    for key in [
        "id",
        "sessionId",
        "generation",
        "operation",
        "kind",
        "adapterId",
        "resourceId",
    ] {
        fields.remove(key);
    }
    let effect = Effect {
        id: format!(
            "{}:{}:{}",
            out.state.session_id, out.state.generation, out.state.sequence
        ),
        session_id: out.state.session_id.clone(),
        generation: out.state.generation,
        kind: recipe.kind,
        operation: operation.into(),
        adapter_id: adapter.into(),
        resource_id: resource_id.clone(),
        fields,
    };
    out.state.pending.insert(
        effect.id.clone(),
        Pending {
            effect: effect.clone(),
            adapter_id: adapter.into(),
            parser,
            after,
            resource_id,
            origin,
            plan_ticket: None,
        },
    );
    out.effects.push(effect);
}
fn persist(
    out: &mut Output,
    adapter: &str,
    operation: &str,
    recipe: Recipe,
    resource_id: Option<String>,
) {
    let record = json!({"operation":operation,"adapterId":adapter,"resourceId":resource_id,"sessionId":out.state.session_id,"generation":out.state.generation});
    let intent = Recipe {
        kind: EffectKind::Persist,
        fields: BTreeMap::from([("record".into(), record)]),
    };
    emit(
        out,
        adapter,
        operation,
        intent,
        Some(recipe),
        resource_id,
        None,
    );
}
fn origin(value: &str) -> Option<String> {
    // Only an origin, never paths, query strings, fragments or userinfo, survives.
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty()
        || authority.contains('@')
        || authority.chars().any(|c| {
            c.is_whitespace() || c.is_control() || matches!(c, '"' | '\'' | '<' | '>' | '\\')
        })
    {
        return None;
    }
    Some(format!(
        "{}://{}",
        if value.starts_with("https://") {
            "https"
        } else {
            "http"
        },
        authority
    ))
}
// JSON pointers support array indices, escaped keys, and a wildcard over arrays/objects.
fn values_at<'a>(document: &'a Value, pointer: &str) -> Vec<&'a Value> {
    if pointer.is_empty() {
        return vec![document];
    }
    if !pointer.starts_with('/') {
        return vec![];
    }
    let mut values = vec![document];
    for token in pointer[1..].split('/') {
        let key = token.replace("~1", "/").replace("~0", "~");
        values = values
            .into_iter()
            .flat_map(|value| {
                if key == "*" {
                    match value {
                        Value::Array(a) => a.iter().collect(),
                        Value::Object(o) => o.values().collect(),
                        _ => vec![],
                    }
                } else {
                    value
                        .get(&key)
                        .or_else(|| key.parse::<usize>().ok().and_then(|i| value.get(i)))
                        .into_iter()
                        .collect()
                }
            })
            .collect();
    }
    values
}
fn predicate(document: &Value, rule: &Value, depth: usize) -> bool {
    predicate_value(document, rule, depth) == Some(true)
}
fn predicate_value(document: &Value, rule: &Value, depth: usize) -> Option<bool> {
    if depth > 32 {
        return None;
    }
    if rule
        .get("source")
        .and_then(Value::as_str)
        .is_some_and(|s| s != "stdout")
    {
        return None;
    }
    match str_field(rule, "op") {
        "all" => {
            let rules = rule
                .get("rules")
                .or_else(|| rule.get("items"))
                .or_else(|| rule.get("predicates"))?
                .as_array()?;
            let mut all = true;
            for r in rules {
                all &= predicate_value(document, r, depth + 1)?;
            }
            Some(all)
        }
        "not" => Some(!predicate_value(
            document,
            rule.get("rule").or_else(|| rule.get("predicate"))?,
            depth + 1,
        )?),
        "exists" => Some(!values_at(document, rule.get("pointer")?.as_str()?).is_empty()),
        "equals" => {
            let expected = rule.get("value")?;
            Some(values_at(document, rule.get("pointer")?.as_str()?).contains(&expected))
        }
        _ => None,
    }
}
fn supported_mutation(recipe: &Recipe) -> bool {
    // Never interpret an advanced plan as its first executable command.
    ![
        "before",
        "after",
        "requires",
        "process",
        "bindings",
        "assertions",
    ]
    .iter()
    .any(|k| recipe.fields.contains_key(*k))
}
fn strip_ansi(input: &str) -> String {
    let mut chars = input.chars().peekable();
    let mut output = String::new();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for ch in chars.by_ref() {
                if ('@'..='~').contains(&ch) {
                    break;
                }
            }
        } else {
            output.push(c);
        }
    }
    output
}
fn parse_url(parser: &Value, stdout: &str, stderr: &str) -> Option<String> {
    let text = strip_ansi(&format!("{stdout}\n{stderr}"));
    let prefix = str_field(parser, "prefix");
    let constraints = &parser["constraints"];
    let pattern = constraints.get("hostnamePattern").and_then(Value::as_str);
    let regex = if let Some(pattern) = pattern {
        if pattern.len() > 2048 {
            return None;
        }
        Some(Regex::new(pattern).ok()?)
    } else {
        None
    };
    let mut origins = std::collections::BTreeSet::new();
    let candidates: Vec<String> = if let Some(event) = parser.get("jsonEvent") {
        text.lines()
            .filter_map(|line| {
                let doc: Value = serde_json::from_str(line).ok()?;
                let event_pointer = event.get("eventPointer")?.as_str()?;
                let origin_pointer = event.get("originPointer")?.as_str()?;
                if doc.pointer(event_pointer)? != event.get("eventValue")? {
                    return None;
                }
                doc.pointer(origin_pointer)?.as_str().map(str::to_owned)
            })
            .collect()
    } else {
        text.split_whitespace().map(str::to_owned).collect()
    };
    for token in &candidates {
        if !prefix.is_empty() && !token.starts_with(prefix) {
            continue;
        }
        if let Some(url) = origin(token) {
            if constraints.get("exactOriginToken") == Some(&Value::Bool(true)) && *token != url {
                continue;
            }
            let authority = url.split("://").nth(1)?;
            let hostname = authority.split(':').next()?;
            if regex.as_ref().is_some_and(|r| !r.is_match(hostname)) {
                continue;
            }
            origins.insert(url);
        }
    }
    if origins.len() == 1 {
        origins.into_iter().next()
    } else {
        None
    }
}
fn parse(p: &Value, result: &Value) -> Option<String> {
    let stdout = str_field(result, "stdout");
    let stderr = str_field(result, "stderr");
    if stdout.len() + stderr.len() > 1_048_576 {
        return None;
    }
    match str_field(p, "kind") {
        "contains" => {
            let text = match str_field(p, "stream") {
                "stdout" => stdout.to_owned(),
                "stderr" => stderr.to_owned(),
                _ => format!("{stdout}\n{stderr}"),
            };
            (!str_field(p, "value").is_empty() && text.contains(str_field(p, "value")))
                .then(|| "present".into())
        }
        "url" => parse_url(p, stdout, stderr),
        "json-document" => {
            let doc = if stdout.is_empty() {
                result.clone()
            } else {
                serde_json::from_str::<Value>(stdout).ok()?
            };
            let valid = p
                .get("predicate")
                .is_some_and(|rule| predicate(&doc, rule, 0));
            valid.then(|| "present".into())
        }
        "json" => (if stdout.is_empty() {
            Some(result.clone())
        } else {
            serde_json::from_str::<Value>(stdout).ok()
        })?
        .pointer(str_field(p, "pointer"))?
        .as_str()
        .map(str::to_owned),
        "exit-code" | "" => (result.get("exitCode").and_then(Value::as_i64).unwrap_or(0) == 0)
            .then(|| "present".into()),
        _ => None,
    }
}
fn probe(out: &mut Output, adapter: &str, url: String) {
    if (out.state.requirements.https_required
        || matches!(
            out.state.requirements.client_reach.as_str(),
            "internet" | "unknown"
        ))
        && !url.starts_with("https://")
    {
        out.state.phase = "failed".into();
        limit(
            out,
            "Required public HTTPS origin was not provided; no probe or publication",
        );
        return;
    }
    let vantage = match out.state.requirements.client_reach.as_str() {
        "tailnet" => "tailnet",
        "lan" => "lan",
        "this-device" => "local",
        _ => "public",
    };
    let recipe = Recipe {
        kind: EffectKind::HttpProbe,
        fields: BTreeMap::from([
            ("url".into(), json!(url)),
            ("vantage".into(), json!(vantage)),
            ("timeoutMs".into(), json!(5000)),
            ("maxOutputBytes".into(), json!(16384)),
            ("sse".into(), json!(out.state.requirements.sse)),
            (
                "streamableHttp".into(),
                json!(out.state.requirements.streamable_http),
            ),
            ("oauthDcr".into(), json!(out.state.requirements.oauth_dcr)),
        ]),
    };
    out.state.candidate = Some(url.clone());
    out.state.phase = "validating".into();
    emit(out, adapter, "probe", recipe, None, None, Some(url));
}
fn cleanup(out: &mut Output) {
    operational::cancel_readonly(out);
    let resources = out.state.resources.clone();
    let stopped = out.state.stop_requested;
    for r in resources.iter().filter(|r| {
        r.ownership == "owned" && r.cleanup != "removed" && (stopped || r.cleanup == "pending")
    }) {
        if r.ledger.is_some() {
            operational::begin_cleanup(out, r);
            continue;
        }
        if out
            .state
            .pending
            .values()
            .any(|p| p.resource_id.as_ref() == Some(&r.id))
        {
            continue;
        }
        let recipe = out
            .state
            .adapters
            .iter()
            .find(|a| a.id == r.adapter_id && a.bindings.is_none() && a.admission.is_none())
            .and_then(|a| a.recipes.get("remove"))
            .cloned();
        if let Some(mut recipe) = recipe.filter(supported_mutation) {
            if let Some(Value::Array(args)) = recipe.fields.get_mut("args") {
                for arg in args {
                    if let Some(s) = arg.as_str() {
                        *arg = json!(s.replace("{resourceId}", &r.id));
                    }
                }
            }
            persist(out, &r.adapter_id, "remove", recipe, Some(r.id.clone()));
        } else {
            limit(
                out,
                "Owned resource has no removal recipe; manual cleanup required",
            );
        }
    }
    stop_phase(out);
}
fn stop_phase(out: &mut Output) {
    if out.state.stop_requested {
        out.state.phase = if out
            .state
            .pending
            .values()
            .any(|p| p.effect.operation == "create")
        {
            "stopping"
        } else if out
            .state
            .resources
            .iter()
            .any(|r| r.ownership == "owned" && r.cleanup != "removed")
        {
            "cleanup-pending"
        } else {
            "stopped"
        }
        .into();
    }
}

pub fn transition(input: &str) -> Result<Output, String> {
    let input: Input = serde_json::from_str(input)
        .map_err(|_| "invalid input JSON or protocol shape".to_string())?;
    let mut out = Output {
        state: input.state,
        events: vec![],
        effects: vec![],
        snapshot: Value::Null,
        action: None,
    };
    if let Some(a) = input.adapters {
        if out.state.pending.is_empty() && out.state.selected.is_none() {
            out.state.adapters = a;
        }
    }
    if let Some(r) = input.requirements {
        if out.state.selected.is_none() {
            out.state.requirements = r;
        }
    }
    if let Some(host) = input.host {
        if !operational::validate_private_host(&host) {
            return Err("Private bindings accept opaque handles only".into());
        }
        if host.now_ms < out.state.host.now_ms {
            return Err("host clock moved backwards".into());
        }
        out.state.host = host;
    }
    if out
        .state
        .health_expiry
        .is_some_and(|expires| expires <= out.state.host.now_ms)
    {
        operational::expire(&mut out);
    }
    let cmd = input.command;
    if out.state.sequence == 0 {
        if let Some(id) = cmd.get("sessionId").and_then(Value::as_str) {
            out.state.session_id = id.into();
        }
    }
    match str_field(&cmd, "type") {
        "detect" | "recommend"
            if out.state.selected.is_some()
                && !matches!(out.state.phase.as_str(), "stopped" | "failed") =>
        {
            event(&mut out, "session-already-active")
        }
        "detect" => {
            out.state.phase = "detecting".into();
            for a in out.state.adapters.clone() {
                if let Some(recipe) = a.recipes.get("detect").filter(|r| supported_mutation(r)) {
                    emit(&mut out, &a.id, "detect", recipe.clone(), None, None, None);
                } else {
                    out.state.observations.insert(a.id, "unknown".into());
                }
            }
        }
        "recommend" => {
            let mut candidates = out
                .state
                .adapters
                .iter()
                .filter(|a| operational::potential(a, &out.state.requirements))
                .cloned()
                .collect::<Vec<_>>();
            candidates.sort_by_key(|a| {
                match out.state.observations.get(&a.id).map(String::as_str) {
                    Some("present") => 0,
                    Some("unknown") | None => 1,
                    Some("signed-out") => 2,
                    Some("absent") => 3,
                    _ => 4,
                }
            });
            out.state.recommendations = candidates.iter().map(|a| a.id.clone()).collect();
            out.state.plans=candidates.iter().map(|a|json!({"adapterId":a.id,"eligibility":"needs-validation","observation":out.state.observations.get(&a.id).map(String::as_str).unwrap_or("unknown"),"preconditionActions":a.actions,"capabilityValidationRequired":true})).collect();
            if out.state.requirements.client_reach == "unknown" {
                limit(
                    &mut out,
                    "Client reach unknown; public HTTPS first, client validation still required",
                );
            }
            for a in out.state.adapters.clone() {
                for u in a.unknowns {
                    limit(&mut out, &u);
                }
            }
            out.state.phase = "planned".into();
            out.action = Some(json!({"kind":"choose","choices":out.state.recommendations}));
        }
        "start"
            if out
                .state
                .adapters
                .iter()
                .any(|a| a.id == str_field(&cmd, "adapterId") && a.plan_version == Some(1)) =>
        {
            operational::start(&mut out, &cmd)
        }
        "start" => {
            let id = str_field(&cmd, "adapterId");
            let adapter = out.state.adapters.iter().find(|a| a.id == id).cloned();
            if out.state.selected.is_some()
                && !matches!(out.state.phase.as_str(), "stopped" | "failed")
            {
                event(&mut out, "already-started");
            } else if let Some(a) = adapter {
                if !eligible(&a, &out.state.requirements) {
                    event(&mut out, "requirements-not-met");
                } else if cmd.get("consent") != Some(&Value::Bool(true)) {
                    out.action = Some(json!({"kind":"confirm","adapterId":id}));
                } else if out
                    .state
                    .pending
                    .values()
                    .any(|p| p.effect.operation == "create" || p.effect.operation == "remove")
                    || out
                        .state
                        .resources
                        .iter()
                        .any(|r| r.ownership == "owned" && r.cleanup != "removed")
                {
                    event(&mut out, "cleanup-required");
                } else {
                    out.state.generation += 1;
                    out.state.stop_requested = false;
                    out.state.selected = Some(a.id.clone());
                    out.state.candidate = None;
                    out.state.published = None;
                    if a.bindings.is_some() || a.admission.is_some() {
                        event(&mut out, "adapter-features-not-admitted");
                        limit(&mut out,"Adapter bindings or admission requirements are unsupported; no operation executed");
                        out.state.phase = "failed".into();
                    } else if a.ownership == "external-owned" {
                        if let Some(url) = a.endpoint.as_deref().and_then(origin) {
                            probe(&mut out, &a.id, url);
                        } else {
                            limit(
                                &mut out,
                                "External route requires an existing valid endpoint",
                            );
                            out.state.phase = "failed".into();
                        }
                    } else if a.ownership != "owned" {
                        event(&mut out, "unknown-ownership");
                        out.state.phase = "failed".into();
                    } else if let Some(recipe) =
                        a.recipes.get("create").filter(|r| supported_mutation(r))
                    {
                        out.state.phase = "persisting".into();
                        persist(&mut out, &a.id, "create", recipe.clone(), None);
                    } else {
                        out.state.phase = "failed".into();
                        limit(&mut out, "Adapter has no admitted create recipe");
                    }
                }
            } else {
                event(&mut out, "adapter-unknown");
            }
        }
        "effect-result" => complete(&mut out, &cmd),
        "stop" => {
            if !out.state.stop_requested {
                out.state.stop_requested = true;
                out.state.generation += 1;
                out.state.published = None;
                out.state.candidate = None;
                for r in &mut out.state.resources {
                    if r.ownership == "owned" && r.cleanup != "removed" {
                        r.cleanup = "pending".into();
                    }
                }
                event(&mut out, "endpoint-withdrawn");
            }
            cleanup(&mut out);
        }
        "reconcile" => cleanup(&mut out),
        "reconcile-absent" => operational::reconcile_absent(&mut out, &cmd),
        "health" => operational::health(&mut out, false),
        "update-origin" => operational::health(&mut out, true),
        "owned-process-origin" => operational::owned_process_origin(&mut out, &cmd),
        "approve-origin" => {
            if !out.state.stop_requested
                && out.state.phase == "candidate-ready"
                && cmd.get("generation").and_then(Value::as_u64) == Some(out.state.generation)
                && cmd.get("origin").and_then(Value::as_str) == out.state.candidate.as_deref()
            {
                out.state.published = out.state.candidate.clone();
                out.state.phase = "published-ready".into();
                event(&mut out, "endpoint-published");
            } else {
                event(&mut out, "stale-origin-approval");
            }
        }
        "status" => {}
        _ => event(&mut out, "unsupported-command"),
    }
    out.snapshot = json!({"sessionId":out.state.session_id,"generation":out.state.generation,"phase":out.state.phase,"candidate":out.state.candidate,"published":out.state.published,"lastRouteChange":out.state.last_route_change,"observations":out.state.observations,"recommendations":out.state.recommendations,"plans":out.state.plans,"resources":out.state.resources,"limitations":out.state.limitations});
    Ok(out)
}
fn complete(out: &mut Output, cmd: &Value) {
    let id = str_field(cmd, "effectId");
    let Some(p) = out.state.pending.get(id).cloned() else {
        event(out, "unknown-or-duplicate-effect");
        return;
    };
    if str_field(cmd, "sessionId") != p.effect.session_id
        || cmd.get("generation").and_then(Value::as_u64) != Some(p.effect.generation)
    {
        event(out, "effect-scope-mismatch");
        return;
    }
    if p.plan_ticket.is_some() {
        operational::complete(out, &p, cmd);
        return;
    }
    out.state.pending.remove(id);
    let result = cmd.get("result").cloned().unwrap_or(json!({}));
    let ok = cmd.get("ok") == Some(&Value::Bool(true));
    let current = p.effect.generation == out.state.generation && !out.state.stop_requested;
    if p.effect.kind == EffectKind::Persist {
        if ok && result.get("durable") == Some(&Value::Bool(true)) {
            if p.effect.operation == "remove" || current {
                if let Some(recipe) = p.after {
                    emit(
                        out,
                        &p.adapter_id,
                        &p.effect.operation,
                        recipe,
                        None,
                        p.resource_id,
                        None,
                    );
                    if p.effect.operation == "create" {
                        out.state.phase = "starting".into();
                    }
                }
            }
        } else {
            event(out, "durability-not-acknowledged");
            if current {
                out.state.phase = "failed".into();
            }
        }
        if ok && result.get("durable") == Some(&Value::Bool(true)) && out.state.stop_requested {
            cleanup(out);
        }
        return;
    }
    match p.effect.operation.as_str() {
        "detect" => {
            let parsed = parse(&p.parser, &result);
            let found = ok
                && if str_field(&p.parser, "kind") == "json" {
                    p.parser.get("predicate").is_some_and(|rule| {
                        let doc = serde_json::from_str::<Value>(str_field(&result, "stdout"))
                            .unwrap_or(Value::Null);
                        predicate(&doc, rule, 0)
                    })
                } else {
                    parsed.is_some()
                };
            out.state.observations.insert(
                p.adapter_id,
                if found { "present" } else { "unknown" }.into(),
            );
            event(out, "detection-recorded");
        }
        "create" => {
            if ok {
                let resource_id = result
                    .get("resourceId")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty() && s.len() <= 512)
                    .map(str::to_owned)
                    .unwrap_or(p.effect.id.clone());
                out.state.resources.push(Resource {
                    id: resource_id,
                    adapter_id: p.adapter_id.clone(),
                    generation: p.effect.generation,
                    ownership: "owned".into(),
                    cleanup: if current { "active" } else { "pending" }.into(),
                    ledger: None,
                });
                if current {
                    let parsed = if result
                        .get("exitCode")
                        .and_then(Value::as_i64)
                        .is_some_and(|code| code != 0)
                    {
                        None
                    } else {
                        parse(&p.parser, &result).and_then(|s| origin(&s))
                    };
                    if let Some(url) = parsed {
                        if out.state.requirements.https_required && !url.starts_with("https://") {
                            out.state.phase = "failed".into();
                            limit(out, "Adapter returned an origin without required HTTPS");
                        } else {
                            probe(out, &p.adapter_id, url);
                        }
                    } else {
                        out.state.phase = "failed".into();
                        limit(out,"Adapter output did not provide a valid origin; cleanup remains tracked");
                    }
                } else {
                    event(out, "late-create-cleanup-debt");
                    cleanup(out);
                }
            } else {
                event(out, "create-failed-or-uncertain");
                // A timeout/cancel is not proof that the provider did not create a route.
                // Retain the scoped request until a late callback or explicit not-applied receipt.
                if result.get("notApplied") != Some(&Value::Bool(true)) {
                    out.state.pending.insert(p.effect.id.clone(), p.clone());
                    limit(out,"Create outcome uncertain; retain request for late completion or a not-applied receipt");
                }
                if current {
                    out.state.phase = "failed".into();
                } else if out.state.stop_requested {
                    cleanup(out);
                }
            }
        }
        "probe" => {
            let expected = p.effect.fields.get("vantage").and_then(Value::as_str);
            let status = result.get("status").and_then(Value::as_u64).unwrap_or(0);
            if current
                && out.state.phase == "validating"
                && out.state.candidate == p.origin
                && ok
                && (200..300).contains(&status)
                && result.get("vantage").and_then(Value::as_str) == expected
                && (!out.state.requirements.sse
                    || result.get("streaming") == Some(&Value::Bool(true)))
                && (!out.state.requirements.streamable_http
                    || result.get("streamableHttp") == Some(&Value::Bool(true)))
                && (!out.state.requirements.oauth_dcr
                    || result.get("oauthDcr") == Some(&Value::Bool(true)))
            {
                out.state.phase = "candidate-ready".into();
                event(out, "endpoint-proposed");
                out.action = Some(
                    json!({"kind":"confirm-origin","generation":out.state.generation,"origin":out.state.candidate}),
                );
            } else {
                event(out, "probe-rejected-or-stale");
            }
        }
        "remove" => {
            let confirmed = ok
                && (result.get("removed") == Some(&Value::Bool(true))
                    || result.get("exitCode").and_then(Value::as_i64) == Some(0))
                && result
                    .get("exitCode")
                    .and_then(Value::as_i64)
                    .is_none_or(|code| code == 0);
            if confirmed {
                if let Some(r) = out.state.resources.iter_mut().find(|r| {
                    Some(&r.id) == p.resource_id.as_ref()
                        && r.adapter_id == p.adapter_id
                        && r.ownership == "owned"
                }) {
                    r.cleanup = "removed".into();
                }
            } else {
                event(out, "cleanup-pending");
            }
            // A failed removal is retried only by an explicit reconcile command.
            if out.state.stop_requested {
                out.state.phase = if out
                    .state
                    .resources
                    .iter()
                    .any(|r| r.ownership == "owned" && r.cleanup != "removed")
                {
                    "cleanup-pending"
                } else if out
                    .state
                    .pending
                    .values()
                    .any(|p| p.effect.operation == "create")
                {
                    "stopping"
                } else {
                    "stopped"
                }
                .into();
            }
        }
        _ => event(out, "unsupported-completion"),
    }
}

#[wasm_bindgen]
pub fn step(input_json: &str) -> String {
    match transition(input_json) {
        Ok(output) => serde_json::to_string(&output).expect("serializable core state"),
        Err(error) => json!({"error":{"code":"invalid-input","message":error}}).to_string(),
    }
}

#[cfg(test)]
mod stable_json_origin_tests {
    use super::*;
    #[test]
    fn json_event_origin_ignores_other_fields_and_event_types() {
        let p = json!({"kind":"url","prefix":"https://","jsonEvent":{"eventPointer":"/event","eventValue":"tunnel","originPointer":"/url"},"constraints":{"hostnamePattern":"^[a-z0-9-]+\\.tunnl\\.gg$","exactOriginToken":true}});
        let valid = r#"{"event":"tunnel","url":"https://wild-fox-10bf6aa2.tunnl.gg","upgrade":"https://tunnl.gg/pricing"}"#;
        assert_eq!(
            parse_url(&p, valid, "").as_deref(),
            Some("https://wild-fox-10bf6aa2.tunnl.gg")
        );
        assert_eq!(
            parse_url(
                &p,
                r#"{"event":"request","url":"https://bad.tunnl.gg"}"#,
                ""
            ),
            None
        );
        assert_eq!(
            parse_url(
                &p,
                r#"{"event":"tunnel","url":"https://bad.tunnl.gg/path"}"#,
                ""
            ),
            None
        );
        assert_eq!(
            parse_url(&p, r#"{"event":"tunnel","url":"https://bad.example"}"#, ""),
            None
        );
        assert_eq!(
            parse_url(
                &p,
                &format!(
                    "{valid}\n{}",
                    r#"{"event":"tunnel","url":"https://other.tunnl.gg"}"#
                ),
                ""
            ),
            None
        );
    }
}
```

## Current crates/gozar-core/src/operational.rs

```js
//! Bounded operational plans. Adapter schema knowledge stays in data, outside this module.
use super::*;

pub const FEATURES: &[&str] = &[
    "recipe-sequence",
    "typed-bindings",
    "predicate-parser",
    "owned-resource-ledger",
    "owned-process",
    "interface-forwarder",
    "private-file-reference",
    "private-file-materialization",
    "transport-origin-mapping",
    "probe-assertions",
    "client-vantage-probe",
    "unused-port-selection",
    "install-ed25519",
    "json-event-origin",
    "immutable-origin",
];
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Host {
    #[serde(default)]
    pub now_ms: u64,
    #[serde(default)]
    pub features: Vec<String>,
    #[serde(default)]
    pub bindings: BTreeMap<String, Value>,
    #[serde(default)]
    pub facts: BTreeMap<String, Value>,
    #[serde(default)]
    pub probe: Option<Value>,
    #[serde(default)]
    pub cleanup_absent: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ledger {
    pub handle_ref: String,
    pub continuity_ref: String,
    pub kind: String,
    pub details: Value,
    pub baseline: Value,
    pub bindings: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub stage: String,
    pub step_id: String,
    pub execution_generation: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanStep {
    id: String,
    recipe: Recipe,
    #[serde(default)]
    captures: BTreeMap<String, Value>,
    #[serde(default)]
    assert: Option<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Execution {
    adapter_id: String,
    operation: String,
    resource_id: Option<String>,
    generation: u64,
    recipe: Recipe,
    before: Vec<PlanStep>,
    after: Vec<PlanStep>,
    requires: Vec<Value>,
    stage: String,
    index: usize,
    facts: BTreeMap<String, Value>,
    bindings: BTreeMap<String, Value>,
    started_at_ms: u64,
    valid_until_ms: u64,
    candidate: Option<String>,
    ledger: Option<Ledger>,
    ownership_receipt: Option<Value>,
}
fn fail(out: &mut Output, message: &str) {
    limit(out, message);
    event(out, "plan-blocked");
    out.state.phase = if out.state.stop_requested
        || out
            .state
            .resources
            .iter()
            .any(|r| r.ledger.is_some() && r.cleanup != "removed")
    {
        "cleanup-pending"
    } else {
        "failed"
    }
    .into();
    out.state.execution = None;
}
fn fresh(receipt: &Value, state: &State) -> bool {
    receipt.get("sessionId").and_then(Value::as_str) == Some(&state.session_id)
        && receipt
            .get("observedAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|t| t <= state.host.now_ms)
        && receipt
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|t| t > state.host.now_ms)
}
fn opaque(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 512
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.:/".contains(c))
}
fn dns(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && s.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
}
fn only_keys(value: &Value, allowed: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.keys().all(|key| allowed.contains(&key.as_str())))
}
fn scoped_generation(receipt: &Value, state: &State, generation: u64) -> bool {
    fresh(receipt, state)
        && receipt.get("generation").and_then(Value::as_u64) == Some(generation)
        && opaque(str_field(receipt, "authorityRef"))
}
pub fn validate_private_host(host: &Host) -> bool {
    host.bindings
        .values()
        .all(|binding| match str_field(binding, "type") {
            "credential-reference" => only_keys(
                binding,
                &[
                    "type",
                    "handleRef",
                    "authorityRef",
                    "sessionId",
                    "generation",
                    "observedAtMs",
                    "expiresAtMs",
                ],
            ),
            "session-private-path" => {
                (binding.get("materialization").is_none_or(|receipt| {
                    only_keys(receipt, &["credentialRefs"])
                        && receipt["credentialRefs"].as_object().is_some_and(|refs| {
                            refs.len() <= 16
                                && refs
                                    .values()
                                    .all(|handle| handle.as_str().is_some_and(opaque))
                        })
                })) && only_keys(
                    binding,
                    &[
                        "type",
                        "handleRef",
                        "authorityRef",
                        "sessionId",
                        "generation",
                        "observedAtMs",
                        "expiresAtMs",
                        "mode",
                        "parentMode",
                        "materialization",
                    ],
                )
            }
            _ => true,
        })
}
fn endpoint(value: &Value, upstream: bool) -> bool {
    only_keys(
        value,
        if upstream {
            &["scheme", "hostname", "port"]
        } else {
            &["scheme", "hostname", "port", "endpointName"]
        },
    ) && (["https", "tls", "tcp"].contains(&str_field(value, "scheme"))
        || upstream && str_field(value, "scheme") == "http")
}
fn valid_endpoint(value: &Value, upstream: bool) -> bool {
    endpoint(value, upstream)
        && dns(str_field(value, "hostname"))
        && typed("port", &value["port"])
        && (upstream || opaque(str_field(value, "endpointName")))
}
fn mapping_value(rule: &Value) -> Option<Value> {
    let endpoint = rule.get("endpoint")?;
    let upstream = rule.get("upstream")?;
    if !valid_endpoint(endpoint, false)
        || !valid_endpoint(upstream, true)
        || !opaque(str_field(rule, "policyRef"))
    {
        return None;
    }
    if let Some(http_origin) = rule.get("origin") {
        let port = endpoint["port"].as_u64()?;
        let expected = format!(
            "https://{}{}",
            str_field(endpoint, "hostname"),
            if port == 443 {
                String::new()
            } else {
                format!(":{port}")
            }
        );
        if str_field(endpoint, "scheme") != "https"
            || http_origin.as_str() != Some(expected.as_str())
            || origin(&expected).as_deref() != Some(expected.as_str())
        {
            return None;
        }
    }
    let mut result = json!({"endpoint":endpoint,"upstream":upstream,"policyRef":rule["policyRef"]});
    if let Some(value) = rule.get("origin") {
        result["origin"] = value.clone();
    }
    Some(result)
}
fn template_refs(value: &Value, refs: &[Value], depth: usize) -> bool {
    if depth > 16 {
        return false;
    }
    match value {
        Value::Object(_) if str_field(value, "kind") == "credential-ref" => {
            only_keys(value, &["kind", "binding"]) && refs.contains(&value["binding"])
        }
        Value::Object(object) => {
            object.len() <= 64
                && object
                    .values()
                    .all(|item| template_refs(item, refs, depth + 1))
        }
        Value::Array(array) => {
            array.len() <= 64
                && array
                    .iter()
                    .all(|item| template_refs(item, refs, depth + 1))
        }
        Value::String(text) => text.len() <= 8192,
        _ => true,
    }
}
fn template_uses(value: &Value, name: &Value) -> bool {
    match value {
        Value::Object(object) => {
            (str_field(value, "kind") == "credential-ref" && value.get("binding") == Some(name))
                || object.values().any(|item| template_uses(item, name))
        }
        Value::Array(array) => array.iter().any(|item| template_uses(item, name)),
        _ => false,
    }
}
fn valid_materialize(spec: &Value) -> bool {
    let Some(refs) = spec.get("credentialRefs").and_then(Value::as_array) else {
        return false;
    };
    only_keys(spec, &["format", "template", "credentialRefs", "requires"])
        && ["json", "text"].contains(&str_field(spec, "format"))
        && spec.get("template").is_some_and(|template| {
            template.to_string().len() <= 32768 && template_refs(template, refs, 0)
        })
        && (str_field(spec, "format") != "text"
            || spec["template"].is_string()
            || str_field(&spec["template"], "kind") == "credential-ref")
        && !refs.is_empty()
        && refs.len() <= 16
        && refs
            .iter()
            .all(|name| name.as_str().is_some_and(opaque) && template_uses(&spec["template"], name))
        && refs
            .iter()
            .enumerate()
            .all(|(index, name)| !refs[..index].contains(name))
        && spec
            .get("requires")
            .and_then(Value::as_array)
            .is_some_and(|rules| {
                !rules.is_empty()
                    && rules.len() <= 32
                    && rules.iter().all(|rule| {
                        str_field(rule, "op") == "verified"
                            && rule.get("value").is_some()
                            && valid_assertion(rule, 0)
                    })
            })
}
fn mapping_plan_valid(a: &Adapter, e: &Execution) -> bool {
    let mappings: Vec<Value> = e
        .requires
        .iter()
        .filter(|rule| str_field(rule, "op") == "transport-mapping")
        .filter_map(|rule| expand(rule, &e.bindings).ok())
        .collect();
    e.bindings
        .values()
        .filter(|binding| str_field(binding, "type") == "transport-endpoint")
        .all(|binding| {
            mappings
                .iter()
                .any(|mapping| mapping.get("endpoint") == binding.get("value"))
        })
        && mappings.iter().all(|rule| {
            let Some(mapping) = mapping_value(rule) else {
                return false;
            };
            let approved_ports: Vec<&Value> = e
                .bindings
                .values()
                .filter(|binding| str_field(binding, "type") == "loopback-port")
                .filter_map(|binding| binding.get("value"))
                .collect();
            if !approved_ports.is_empty()
                && (str_field(&mapping["upstream"], "hostname") != "127.0.0.1"
                    || !approved_ports.contains(&&mapping["upstream"]["port"]))
            {
                return false;
            }
            a.endpoint_template.as_ref().is_none_or(|template| {
                expand(&json!(template), &e.bindings).ok().as_ref() == mapping.get("origin")
            })
        })
}
fn contains_transport_mapping(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            str_field(value, "op") == "transport-mapping"
                || object.values().any(contains_transport_mapping)
        }
        Value::Array(values) => values.iter().any(contains_transport_mapping),
        _ => false,
    }
}
fn materializations_valid(a: &Adapter, e: &Execution, state: &State) -> bool {
    a.bindings
        .as_ref()
        .and_then(Value::as_object)
        .is_none_or(|specs| {
            specs.iter().all(|(name, spec)| {
                let Some(materialize) = spec.get("materialize") else {
                    return true;
                };
                let Some(binding) = e.bindings.get(name) else {
                    return false;
                };
                let Some(refs) = materialize["credentialRefs"].as_array() else {
                    return false;
                };
                let expected: serde_json::Map<String, Value> = refs
                    .iter()
                    .filter_map(|name| {
                        let name = name.as_str()?;
                        let credential = e.bindings.get(name)?;
                        if str_field(credential, "type") != "credential-reference" {
                            return None;
                        }
                        Some((name.to_owned(), credential["handleRef"].clone()))
                    })
                    .collect();
                let receipt = &binding["materialization"];
                expected.len() == refs.len()
                    && only_keys(receipt, &["credentialRefs"])
                    && receipt["credentialRefs"] == Value::Object(expected)
                    && materialize["requires"].as_array().is_some_and(|rules| {
                        rules
                            .iter()
                            .all(|rule| assertion(rule, &Value::Null, e, state, &Value::Null, 0))
                    })
            })
        })
}
fn typed(kind: &str, value: &Value) -> bool {
    match kind {
        "transport-endpoint" => valid_endpoint(value, false),
        "bool" => value.is_boolean(),
        "port" | "loopback-port" | "unused-port" => {
            value.as_u64().is_some_and(|n| n > 0 && n <= 65535)
        }
        "reserved-unused-port" => value.as_u64().is_some_and(|n| n <= 65535),
        "literal" => {
            value.is_boolean()
                || value.as_u64().is_some()
                || value.as_str().is_some_and(|s| {
                    s.len() <= 512
                        && !s.is_empty()
                        && s.chars()
                            .all(|c| c.is_ascii_alphanumeric() || "-_.:/".contains(c))
                })
        }
        "mount" => value.as_str().is_some_and(|s| {
            s.starts_with('/')
                && s.len() <= 128
                && !s.contains("..")
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_/".contains(c))
        }),
        "dns-name" => value.as_str().is_some_and(dns),
        "opaque-ref" | "opaque-private-reference" | "resource-handle" => {
            value.as_str().is_some_and(opaque)
        }
        "origin" => value
            .as_str()
            .is_some_and(|s| origin(s).as_deref() == Some(s)),
        "credential-free-https-origin" => value
            .as_str()
            .is_some_and(|s| s.starts_with("https://") && origin(s).as_deref() == Some(s)),
        "loopback-http-origin" => value.as_str().is_some_and(|s| {
            origin(s).as_deref() == Some(s)
                && s.strip_prefix("http://")
                    .is_some_and(|a| a.starts_with("127.0.0.1:") || a.starts_with("[::1]:"))
        }),
        "selected-interface-address" => value
            .as_str()
            .and_then(|s| s.parse::<std::net::IpAddr>().ok())
            .is_some_and(|a| {
                !a.is_loopback()
                    && !a.is_unspecified()
                    && !a.is_multicast()
                    && match a {
                        std::net::IpAddr::V4(v) => !v.is_link_local(),
                        std::net::IpAddr::V6(v) => !v.is_unicast_link_local(),
                    }
            }),
        _ => false,
    }
}
fn binding_value(binding: &Value) -> Option<&Value> {
    binding.get("value").or_else(|| binding.get("handleRef"))
}
fn expand(value: &Value, bindings: &BTreeMap<String, Value>) -> Result<Value, String> {
    match value {
        Value::String(s) => {
            if let Some(name) = s.strip_prefix('{').and_then(|s| s.strip_suffix('}')) {
                if !name.contains(['{', '}']) {
                    if bindings
                        .get(name)
                        .is_some_and(|b| str_field(b, "type") == "session-private-path")
                    {
                        return Ok(json!(s));
                    }
                    return bindings
                        .get(name)
                        .and_then(binding_value)
                        .cloned()
                        .ok_or_else(|| format!("Unresolved typed binding: {name}"));
                }
            }
            let mut text = s.clone();
            for (name, binding) in bindings {
                if str_field(binding, "type") == "session-private-path" {
                    continue;
                }
                let v = binding_value(binding).ok_or("Missing binding value")?;
                let replacement = v
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| v.to_string());
                text = text.replace(&format!("{{{name}}}"), &replacement);
            }
            // Private placeholders remain only in executable fields for driver resolution.
            let private_removed = bindings
                .iter()
                .filter(|(_, v)| str_field(v, "type") == "session-private-path")
                .fold(text.clone(), |s, (name, _)| {
                    s.replace(&format!("{{{name}}}"), "")
                });
            if private_removed.contains(['{', '}']) || text.contains('\0') {
                return Err("Unknown or malformed template binding".into());
            }
            Ok(json!(text))
        }
        Value::Array(values) => values
            .iter()
            .map(|v| expand(v, bindings))
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        Value::Object(values) => values
            .iter()
            .map(|(k, v)| Ok((k.clone(), expand(v, bindings)?)))
            .collect::<Result<serde_json::Map<_, _>, String>>()
            .map(Value::Object),
        _ => Ok(value.clone()),
    }
}
fn pointer_text(pointer: &str, bindings: &BTreeMap<String, Value>) -> Result<String, String> {
    let mut text = pointer.to_owned();
    for (name, value) in bindings {
        if let Some(value) = binding_value(value) {
            let s = value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string());
            text = text.replace(
                &format!("{{{name}}}"),
                &s.replace('~', "~0").replace('/', "~1"),
            );
        }
    }
    if text.contains(['{', '}']) {
        return Err("Unresolved pointer binding".into());
    }
    Ok(text)
}
fn source<'a>(facts: &'a BTreeMap<String, Value>, name: &str) -> Option<&'a Value> {
    facts.get(name)
}
fn resolve_bindings(
    a: &Adapter,
    e: &mut Execution,
    state: &State,
    all: bool,
) -> Result<(), String> {
    let Some(specs) = a.bindings.as_ref().and_then(Value::as_object) else {
        return Ok(());
    };
    if specs.len() > 32 {
        return Err("Too many typed bindings".into());
    }
    for (name, spec) in specs {
        if !opaque(name) {
            return Err("Invalid binding name".into());
        }
        if e.bindings.contains_key(name) {
            continue;
        }
        let kind = str_field(spec, "type");
        let mut authority = format!("plan:{}:{name}", e.generation);
        let value = if kind == "literal" {
            spec.get("value").cloned()
        } else if kind == "unused-port" {
            let values = source(&e.facts, str_field(spec, "source"))
                .and_then(|v| v.pointer(str_field(spec, "pointer")))
                .and_then(Value::as_array);
            if let Some(occupied) = values {
                let candidates = spec
                    .get("candidates")
                    .and_then(Value::as_array)
                    .ok_or("Unused port needs explicit candidates")?;
                let protected = spec
                    .get("protectedPorts")
                    .and_then(Value::as_array)
                    .ok_or("Unused port needs protected list")?;
                if candidates.len() > 128 || occupied.iter().any(|p| !typed("port", p)) {
                    return Err("Invalid occupied port facts".into());
                }
                Some(
                    candidates
                        .iter()
                        .find(|p| {
                            typed("port", p) && !protected.contains(p) && !occupied.contains(p)
                        })
                        .cloned()
                        .ok_or("All explicit listener candidates are occupied or protected")?,
                )
            } else {
                None
            }
        } else if let Some(v) = spec.get("value") {
            Some(v.clone())
        } else if let Some(step) = spec
            .get("source")
            .and_then(Value::as_str)
            .filter(|_| spec.get("pointer").is_some())
        {
            source(&e.facts, step)
                .and_then(|v| v.pointer(str_field(spec, "pointer")))
                .cloned()
        } else if let Some(binding) = state.host.bindings.get(name) {
            if str_field(binding, "type") != kind
                || !fresh(binding, state)
                || !opaque(str_field(binding, "authorityRef"))
            {
                return Err("Binding authority missing, stale, or wrong type".into());
            }
            if ["credential-reference", "transport-endpoint"].contains(&kind) {
                if !scoped_generation(binding, state, e.generation)
                    || (kind == "credential-reference"
                        && (!opaque(str_field(binding, "handleRef"))
                            || binding.get("value").is_some()))
                    || (kind == "transport-endpoint" && !typed(kind, &binding["value"]))
                {
                    return Err("Scoped private/transport authority is invalid".into());
                }
                let mut saved = binding.clone();
                saved["hostAuthority"] = binding["authorityRef"].clone();
                e.valid_until_ms = e
                    .valid_until_ms
                    .min(binding["expiresAtMs"].as_u64().unwrap_or(0));
                e.bindings.insert(name.clone(), saved);
                continue;
            }
            if kind == "session-private-path" {
                if (spec.get("materialize").is_some()
                    && !scoped_generation(binding, state, e.generation))
                    || !opaque(str_field(binding, "handleRef"))
                    || str_field(binding, "mode") != "0600"
                    || str_field(binding, "parentMode") != "0700"
                {
                    return Err("Private handle lacks session-only permissions".into());
                }
                e.valid_until_ms = e
                    .valid_until_ms
                    .min(binding["expiresAtMs"].as_u64().unwrap_or(0));
                let mut saved = binding.clone();
                saved["hostAuthority"] = binding["authorityRef"].clone();
                e.bindings.insert(name.clone(), saved);
                continue;
            }
            authority = str_field(binding, "authorityRef").into();
            e.valid_until_ms = e
                .valid_until_ms
                .min(binding["expiresAtMs"].as_u64().unwrap_or(0));
            binding.get("value").cloned()
        } else {
            None
        };
        if let Some(mut value) = value {
            if kind == "dns-name" && spec.get("trimTrailingDot") == Some(&Value::Bool(true)) {
                if let Some(s) = value.as_str() {
                    value = json!(s.trim_end_matches('.'));
                }
            }
            if !typed(kind, &value) {
                return Err(format!("Invalid typed binding {name}"));
            }
            let mut binding = json!({"type":kind,"value":value,"authorityRef":authority});
            if state
                .host
                .bindings
                .get(name)
                .is_some_and(|b| str_field(b, "authorityRef") == authority)
            {
                binding["hostAuthority"] = json!(authority);
                if let Some(generation) = state
                    .host
                    .bindings
                    .get(name)
                    .and_then(|receipt| receipt.get("generation"))
                {
                    binding["generation"] = generation.clone();
                }
            }
            e.bindings.insert(name.clone(), binding);
        } else if all {
            return Err(format!("Missing typed binding {name}"));
        }
    }
    Ok(())
}
fn port_maps_at<'a>(document: &'a Value, pointer: &str) -> Result<Vec<&'a Value>, String> {
    if pointer.is_empty() {
        return Ok(vec![document]);
    }
    if !pointer.starts_with('/') {
        return Err("Port map pointer must be absolute".into());
    }
    let mut values = vec![document];
    for token in pointer[1..].split('/') {
        let key = token.replace("~1", "/").replace("~0", "~");
        let mut next = vec![];
        for value in values {
            match value {
                Value::Object(o) => {
                    if key == "*" {
                        next.extend(o.values());
                    } else if let Some(v) = o.get(&key) {
                        next.push(v);
                    }
                }
                Value::Array(a) => {
                    if key == "*" {
                        next.extend(a);
                    } else if let Some(v) = key.parse::<usize>().ok().and_then(|i| a.get(i)) {
                        next.push(v);
                    }
                }
                _ => return Err("Unknown intermediate listener map schema".into()),
            }
        }
        values = next;
    }
    Ok(values)
}
fn port_key(key: &str) -> Option<u64> {
    key.parse()
        .ok()
        .or_else(|| key.rsplit_once(':').and_then(|(_, p)| p.parse().ok()))
        .filter(|n| *n > 0 && *n <= 65535)
}
fn capture(
    doc: &Value,
    spec: &Value,
    bindings: &BTreeMap<String, Value>,
    depth: usize,
) -> Result<Value, String> {
    if depth > 12 {
        return Err("Capture nesting exceeded".into());
    }
    let kind = str_field(spec, "type");
    if kind == "port-set" {
        let paths = spec
            .get("paths")
            .and_then(Value::as_array)
            .ok_or("Port capture needs map paths")?;
        if !doc.is_object() || paths.is_empty() || paths.len() > 32 {
            return Err("Invalid port map capture".into());
        }
        let mut ports = std::collections::BTreeSet::new();
        for path in paths {
            let path = pointer_text(path.as_str().ok_or("Invalid map pointer")?, bindings)?;
            for map in port_maps_at(doc, &path)? {
                let map = map.as_object().ok_or("Port map has unknown schema")?;
                for key in map.keys() {
                    ports.insert(port_key(key).ok_or("Unknown listener key format")?);
                }
            }
        }
        return Ok(json!(ports));
    }
    let pointer = pointer_text(str_field(spec, "pointer"), bindings)?;
    let values = values_at(doc, &pointer);
    if values.is_empty() && spec.get("optional") == Some(&Value::Bool(true)) {
        return Ok(Value::Null);
    }
    if values.len() != 1 {
        return Err("Typed capture needs exactly one matching value".into());
    }
    let selected = values[0];
    if kind == "record" {
        let fields = spec
            .get("fields")
            .and_then(Value::as_object)
            .ok_or("Record capture needs explicit fields")?;
        if fields.len() > 32 {
            return Err("Capture record too wide".into());
        }
        let mut result = serde_json::Map::new();
        for (name, field) in fields {
            result.insert(name.clone(), capture(selected, field, bindings, depth + 1)?);
        }
        return Ok(Value::Object(result));
    }
    let mut value = selected.clone();
    if kind == "dns-name" && spec.get("trimTrailingDot") == Some(&Value::Bool(true)) {
        if let Some(s) = value.as_str() {
            value = json!(s.trim_end_matches('.'));
        }
    }
    if !typed(kind, &value) {
        return Err("Captured value does not match nonsecret type".into());
    }
    Ok(value)
}
fn continuity(receipt: &Value, ledger: &Ledger, state: &State) -> bool {
    fresh(receipt, state)
        && receipt.get("continuous") == Some(&Value::Bool(true))
        && str_field(receipt, "handleRef") == ledger.handle_ref
        && str_field(receipt, "continuityRef") == ledger.continuity_ref
}
fn assertion(
    rule: &Value,
    doc: &Value,
    e: &Execution,
    state: &State,
    result: &Value,
    depth: usize,
) -> bool {
    if depth > 32 {
        return false;
    }
    let raw_op = str_field(rule, "op");
    if raw_op == "all" {
        return rule
            .get("rules")
            .or_else(|| rule.get("items"))
            .and_then(Value::as_array)
            .is_some_and(|r| {
                r.iter()
                    .all(|r| assertion(r, doc, e, state, result, depth + 1))
            });
    }
    if raw_op == "not" {
        return rule
            .get("rule")
            .or_else(|| rule.get("predicate"))
            .is_some_and(|r| {
                valid_assertion(r, depth + 1) && !assertion(r, doc, e, state, result, depth + 1)
            });
    }
    let mut without_pointer = rule.clone();
    if let Some(o) = without_pointer.as_object_mut() {
        o.remove("pointer");
    }
    let expanded = match expand(&without_pointer, &e.bindings) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let op = str_field(&expanded, "op");
    let selected = match expanded.get("source").and_then(Value::as_str) {
        None | Some("stdout") => doc,
        Some(source) => match e.facts.get(source) {
            Some(v) => v,
            None => return false,
        },
    };
    // Escape dynamic pointer tokens separately; never interpolate a mount '/' as a separator.
    let pointer = match rule.get("pointer").and_then(Value::as_str) {
        Some(p) => match pointer_text(p, &e.bindings) {
            Ok(p) => p,
            Err(_) => return false,
        },
        None => String::new(),
    };
    match op {
        "equals" => expanded
            .get("value")
            .is_some_and(|expected| values_at(selected, &pointer).contains(&expected)),
        "exists" => !values_at(selected, &pointer).is_empty(),
        "verified" => state
            .host
            .facts
            .get(str_field(&expanded, "fact"))
            .is_some_and(|r| {
                fresh(r, state)
                    && r.get("value") == Some(expanded.get("value").unwrap_or(&Value::Bool(true)))
                    && (expanded.get("value").is_none()
                        || scoped_generation(r, state, e.generation))
                    && opaque(str_field(r, "authorityRef"))
            }),
        "transport-mapping" => mapping_value(&expanded).is_some_and(|expected| {
            state
                .host
                .facts
                .get(str_field(&expanded, "fact"))
                .is_some_and(|receipt| {
                    scoped_generation(receipt, state, e.generation)
                        && receipt.get("value") == Some(&expected)
                })
        }),
        "private-file" => e
            .bindings
            .get(str_field(&expanded, "binding"))
            .is_some_and(|b| {
                str_field(b, "type") == "session-private-path"
                    && fresh(b, state)
                    && str_field(b, "mode") == str_field(&expanded, "mode")
                    && str_field(b, "parentMode") == str_field(&expanded, "parentMode")
            }),
        "port-unoccupied" => selected
            .pointer(&pointer)
            .and_then(Value::as_array)
            .is_some_and(|ports| {
                typed("port", &expanded["port"])
                    && ports.iter().all(|p| typed("port", p))
                    && !ports.contains(&expanded["port"])
            }),
        "exact-route" => expanded
            .get("expected")
            .is_some_and(|v| selected.pointer(&pointer) == Some(v)),
        "owned-ledger-match" => e.ledger.as_ref().is_some_and(|l| {
            selected.pointer(&pointer) == Some(&l.details)
                && result
                    .get("ownershipReceipt")
                    .or(e.ownership_receipt.as_ref())
                    .is_some_and(|r| continuity(r, l, state))
        }),
        "owned-route-absent" => selected.pointer(&pointer).is_none_or(Value::is_null),
        _ => false,
    }
}
fn valid_assertion(rule: &Value, depth: usize) -> bool {
    if depth > 32 || !rule.is_object() {
        return false;
    }
    let allowed: &[&str] = match str_field(rule, "op") {
        "all" => {
            let Some(items) = rule
                .get("rules")
                .or_else(|| rule.get("items"))
                .and_then(Value::as_array)
            else {
                return false;
            };
            if items.len() > 64 || !items.iter().all(|r| valid_assertion(r, depth + 1)) {
                return false;
            }
            &["op", "rules", "items"]
        }
        "not" => {
            if !rule
                .get("rule")
                .or_else(|| rule.get("predicate"))
                .is_some_and(|r| valid_assertion(r, depth + 1))
            {
                return false;
            }
            &["op", "rule", "predicate"]
        }
        "equals" => {
            if rule.get("value").is_none() || !rule.get("pointer").is_some_and(Value::is_string) {
                return false;
            }
            &["op", "source", "pointer", "value"]
        }
        "exists" => {
            if !rule.get("pointer").is_some_and(Value::is_string) {
                return false;
            }
            &["op", "source", "pointer"]
        }
        "verified" => {
            if !rule.get("fact").is_some_and(Value::is_string) {
                return false;
            }
            &["op", "fact", "value"]
        }
        "transport-mapping" => {
            if !rule.get("fact").is_some_and(Value::is_string)
                || rule.get("endpoint").is_none()
                || rule.get("upstream").is_none()
                || rule.get("policyRef").is_none()
            {
                return false;
            }
            &["op", "fact", "endpoint", "upstream", "policyRef", "origin"]
        }
        "private-file" => &["op", "binding", "mode", "parentMode", "owner"],
        "port-unoccupied" => {
            if rule.get("source").is_none()
                || rule.get("pointer").is_none()
                || rule.get("port").is_none()
            {
                return false;
            }
            &["op", "source", "pointer", "port"]
        }
        "exact-route" => {
            if rule.get("expected").is_none() || rule.get("pointer").is_none() {
                return false;
            }
            &["op", "source", "pointer", "expected"]
        }
        "owned-ledger-match" | "owned-route-absent" => {
            if rule.get("source").is_none() || rule.get("pointer").is_none() {
                return false;
            }
            &["op", "source", "pointer"]
        }
        _ => return false,
    };
    rule.as_object()
        .is_some_and(|o| o.keys().all(|k| allowed.contains(&k.as_str())))
}
fn valid_capture(spec: &Value, depth: usize) -> bool {
    if depth > 12 || !spec.is_object() {
        return false;
    }
    let kind = str_field(spec, "type");
    let allowed = &[
        "type",
        "pointer",
        "optional",
        "trimTrailingDot",
        "fields",
        "paths",
    ];
    if spec
        .as_object()
        .is_none_or(|o| o.keys().any(|k| !allowed.contains(&k.as_str())))
    {
        return false;
    }
    match kind {
        "record" => spec
            .get("fields")
            .and_then(Value::as_object)
            .is_some_and(|o| o.len() <= 32 && o.values().all(|v| valid_capture(v, depth + 1))),
        "port-set" => spec
            .get("paths")
            .and_then(Value::as_array)
            .is_some_and(|a| !a.is_empty() && a.len() <= 32 && a.iter().all(Value::is_string)),
        "bool" | "port" | "dns-name" | "opaque-ref" | "origin" | "mount" => {
            spec.get("pointer").is_some_and(Value::is_string)
        }
        _ => false,
    }
}
fn executable(recipe: &Recipe) -> Result<Recipe, String> {
    let mut recipe = recipe.clone();
    for key in ["before", "requires", "after", "ledger", "process"] {
        recipe.fields.remove(key);
    }
    Ok(recipe)
}
fn parse_steps(recipe: &Recipe, key: &str) -> Result<Vec<PlanStep>, String> {
    match recipe.fields.get(key) {
        None => Ok(vec![]),
        Some(v) => {
            let steps: Vec<PlanStep> =
                serde_json::from_value(v.clone()).map_err(|_| "Invalid bounded plan steps")?;
            if steps.len() > 16 {
                return Err("Plan step bound exceeded".into());
            }
            let mut ids = std::collections::BTreeSet::new();
            for step in &steps {
                if !opaque(&step.id)
                    || !ids.insert(&step.id)
                    || !valid_recipe(&step.recipe, true)
                    || step.assert.as_ref().is_some_and(|a| !valid_assertion(a, 0))
                    || step.captures.len() > 32
                    || step.captures.values().any(|v| !valid_capture(v, 0))
                {
                    return Err("Unsupported or duplicate observation step/guard/capture".into());
                }
            }
            Ok(steps)
        }
    }
}
fn valid_recipe(recipe: &Recipe, observation: bool) -> bool {
    let mut allowed = vec!["parser", "timeoutMs", "maxOutputBytes"];
    match recipe.kind {
        EffectKind::Spawn => allowed.extend(["program", "args", "longRunning", "collectMs"]),
        EffectKind::ReadFile => allowed.extend(["handleRef"]),
        EffectKind::Interfaces => {}
        EffectKind::HttpProbe => {
            allowed.extend(["url", "vantage", "sse", "streamableHttp", "oauthDcr"])
        }
        EffectKind::LocalForwarder if !observation => {
            allowed.extend(["bindAddress", "port", "targetHost", "targetPort"])
        }
        EffectKind::OwnedProcess if !observation => allowed.extend([
            "resourceId",
            "signal",
            "graceMs",
            "thenSignal",
            "confirmExit",
            "cleanupPrivateArtifacts",
        ]),
        _ => return false,
    }
    if !observation {
        allowed.extend([
            "before",
            "requires",
            "after",
            "ledger",
            "process",
            "resourceId",
        ]);
    }
    if recipe.fields.keys().any(|k| !allowed.contains(&k.as_str())) {
        return false;
    }
    if observation && recipe.fields.get("longRunning") == Some(&Value::Bool(true)) {
        return false;
    }
    if recipe.kind == EffectKind::OwnedProcess
        && !observation
        && (recipe.fields.get("confirmExit") != Some(&Value::Bool(true))
            || recipe.fields.get("signal").and_then(Value::as_str) != Some("SIGTERM")
            || recipe.fields.get("thenSignal").and_then(Value::as_str) != Some("SIGKILL")
            || recipe
                .fields
                .get("graceMs")
                .and_then(Value::as_u64)
                .is_none_or(|n| n > 10_000))
    {
        return false;
    }
    if recipe.kind == EffectKind::Spawn
        && (!recipe.fields.get("program").is_some_and(|v| {
            v.as_str()
                .is_some_and(|s| !s.is_empty() && !s.contains(['{', '}', '\0']))
        }) || !recipe.fields.get("args").is_some_and(Value::is_array))
    {
        return false;
    }
    if let Some(parser) = recipe.fields.get("parser") {
        match str_field(parser, "kind") {
            "contains" | "json" | "exit-code" => {}
            "url" => {
                if let Some(event) = parser.get("jsonEvent") {
                    if !only_keys(event, &["eventPointer", "eventValue", "originPointer"])
                        || !["eventPointer", "originPointer"].iter().all(|key| {
                            event.get(key).and_then(Value::as_str).is_some_and(|v| {
                                v.starts_with('/') && v.len() > 1 && v.len() <= 256
                            })
                        })
                        || event
                            .get("eventValue")
                            .and_then(Value::as_str)
                            .is_none_or(|v| v.is_empty() || v.len() > 256)
                        || parser["constraints"]["exactOriginToken"] != json!(true)
                        || parser["constraints"]["rejectMultipleDistinct"] != json!(true)
                        || str_field(parser, "prefix") != "https://"
                        || parser["constraints"]
                            .get("hostnamePattern")
                            .and_then(Value::as_str)
                            .is_none_or(|v| {
                                v.len() > 2048
                                    || !v.starts_with('^')
                                    || !v.ends_with('$')
                                    || Regex::new(v).is_err()
                            })
                    {
                        return false;
                    }
                }
            }
            "json-document" => {
                if !parser
                    .get("predicate")
                    .is_some_and(|p| valid_assertion(p, 0))
                {
                    return false;
                }
            }
            _ => return false,
        }
    }
    if let Some(p) = recipe.fields.get("process") {
        let Some(object) = p.as_object() else {
            return false;
        };
        if object
            .keys()
            .any(|k| !["mode", "stdin", "lifetimeMs", "collectMs"].contains(&k.as_str()))
            || str_field(p, "stdin") != "closed"
            || !["owned-long-running", "bounded-command", "owned-listener"]
                .contains(&str_field(p, "mode"))
        {
            return false;
        }
        if str_field(p, "mode") == "owned-long-running"
            && !p
                .get("lifetimeMs")
                .and_then(Value::as_u64)
                .is_some_and(|n| n > 0 && n <= 86_400_000)
        {
            return false;
        }
    }
    true
}
fn admissible(a: &Adapter, state: &State) -> Result<(), String> {
    let admission = a
        .admission
        .as_ref()
        .ok_or("Operational plan needs explicit admission")?;
    if a.plan_version != Some(1) || str_field(admission, "state") != "admitted" {
        return Err("Operational plan not admitted".into());
    }
    let features = admission
        .get("requiredFeatures")
        .and_then(Value::as_array)
        .ok_or("Plan needs required feature set")?;
    for feature in features {
        let feature = feature.as_str().ok_or("Invalid required feature")?;
        if !FEATURES.contains(&feature) || !state.host.features.iter().any(|f| f == feature) {
            return Err(format!("Unsupported core/host plan feature: {feature}"));
        }
    }
    if let Some(bindings) = &a.bindings {
        let specs = bindings.as_object().ok_or("Invalid binding specs")?;
        for spec in specs.values() {
            if ![
                "literal",
                "loopback-port",
                "port",
                "unused-port",
                "mount",
                "dns-name",
                "loopback-http-origin",
                "credential-free-https-origin",
                "selected-interface-address",
                "opaque-private-reference",
                "session-private-path",
                "credential-reference",
                "transport-endpoint",
                "reserved-unused-port",
            ]
            .contains(&str_field(spec, "type"))
            {
                return Err("Unsupported typed binding".into());
            }
            if spec.get("provision").is_some()
                && (str_field(spec, "provision") != "install-ed25519"
                    || str_field(spec, "type") != "session-private-path"
                    || !features
                        .iter()
                        .any(|v| v.as_str() == Some("install-ed25519")))
            {
                return Err("Unsupported identity provisioning".into());
            }
            let required = match str_field(spec, "type") {
                "credential-reference" => Some("private-file-reference"),
                "transport-endpoint" => Some("transport-origin-mapping"),
                _ if spec.get("materialize").is_some() => Some("private-file-materialization"),
                _ => None,
            };
            if required.is_some_and(|feature| {
                !features.iter().any(|value| value.as_str() == Some(feature))
            }) || (spec.get("materialize").is_some()
                && (str_field(spec, "type") != "session-private-path"
                    || !valid_materialize(&spec["materialize"])))
                || (a.ownership == "external-owned"
                    && str_field(spec, "type") == "transport-endpoint")
                || (["credential-reference", "transport-endpoint"]
                    .contains(&str_field(spec, "type"))
                    && spec
                        .as_object()
                        .is_none_or(|object| object.keys().any(|key| key != "type")))
            {
                return Err("Private/transport binding requires its exact implemented feature and authority".into());
            }
            if spec.as_object().is_none_or(|o| {
                o.keys().any(|k| {
                    ![
                        "type",
                        "value",
                        "source",
                        "pointer",
                        "trimTrailingDot",
                        "candidates",
                        "protectedPorts",
                        "materialize",
                        "provision",
                    ]
                    .contains(&k.as_str())
                })
            }) {
                return Err("Unsupported binding guard; normalize the entire binding".into());
            }
        }
    }
    if a.origin_policy
        .as_deref()
        .is_some_and(|policy| policy != "immutable")
        || (a.origin_policy.is_some()
            && !features
                .iter()
                .any(|v| v.as_str() == Some("immutable-origin")))
    {
        return Err("Unsupported origin policy".into());
    }
    for (operation, recipe) in &a.recipes {
        if operation == "detect" {
            continue;
        }
        if !["create", "remove"].contains(&operation.as_str()) || !valid_recipe(recipe, false) {
            return Err("Unsupported executable plan field or operation".into());
        }
        if recipe
            .fields
            .get("parser")
            .is_some_and(|p| p.get("jsonEvent").is_some())
            && !features
                .iter()
                .any(|v| v.as_str() == Some("json-event-origin"))
        {
            return Err("JSON event origin requires negotiated feature".into());
        }
        if contains_transport_mapping(&json!(recipe.fields))
            && !features
                .iter()
                .any(|feature| feature.as_str() == Some("transport-origin-mapping"))
        {
            return Err("Transport mapping requires negotiated feature".into());
        }
        if recipe
            .fields
            .iter()
            .any(|(key, value)| contains_transport_mapping(value) && key != "requires")
            || recipe
                .fields
                .get("requires")
                .and_then(Value::as_array)
                .is_some_and(|rules| {
                    rules.iter().any(|rule| {
                        contains_transport_mapping(rule)
                            && str_field(rule, "op") != "transport-mapping"
                    })
                })
        {
            return Err("Transport mapping must be a direct mutation prerequisite".into());
        }
        parse_steps(recipe, "before")?;
        parse_steps(recipe, "after")?;
        if let Some(requires) = recipe.fields.get("requires") {
            if !requires
                .as_array()
                .is_some_and(|a| a.len() <= 64 && a.iter().all(|r| valid_assertion(r, 0)))
            {
                return Err("Unsupported plan prerequisite".into());
            }
        }
    }
    if a.ownership == "external-owned" && a.recipes.keys().any(|k| k != "detect") {
        return Err("External ownership permits validation only".into());
    }
    Ok(())
}
fn immutable_cleanup_binding(binding: &Value) -> bool {
    ["credential-reference", "transport-endpoint"].contains(&str_field(binding, "type"))
        || (str_field(binding, "type") == "session-private-path"
            && binding.get("materialization").is_some())
}
fn make_execution(
    a: &Adapter,
    operation: &str,
    resource: Option<&Resource>,
    state: &State,
) -> Result<Execution, String> {
    admissible(a, state)?;
    let recipe = a
        .recipes
        .get(operation)
        .cloned()
        .ok_or("No operational recipe")?;
    let before = parse_steps(&recipe, "before")?;
    let after = parse_steps(&recipe, "after")?;
    let requires = recipe
        .fields
        .get("requires")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let ledger = resource.and_then(|r| r.ledger.clone());
    let mut bindings = ledger
        .as_ref()
        .map(|l| l.bindings.clone())
        .unwrap_or_default();
    if operation == "remove" {
        for (name, saved) in &bindings {
            // Create credentials and mappings are not authority to stop an owned birth.
            if recipe.kind == EffectKind::OwnedProcess || immutable_cleanup_binding(saved) {
                continue;
            }
            if let Some(authority) = saved.get("hostAuthority") {
                let current = state
                    .host
                    .bindings
                    .get(name)
                    .ok_or("Saved host identity binding is unavailable")?;
                if !fresh(current, state)
                    || current.get("value") != saved.get("value")
                    || current.get("handleRef") != saved.get("handleRef")
                    || current.get("authorityRef") != Some(authority)
                {
                    return Err("Current host identity binding differs from owned baseline".into());
                }
            }
        }
    }
    if let Some(r) = resource {
        bindings.insert("resourceId".into(),json!({"type":"resource-handle","value":r.id,"authorityRef":ledger.as_ref().map(|l|l.continuity_ref.as_str()).unwrap_or("")}));
    }
    Ok(Execution {
        adapter_id: a.id.clone(),
        operation: operation.into(),
        resource_id: resource.map(|r| r.id.clone()),
        generation: state.generation,
        recipe,
        before,
        after,
        requires,
        stage: "before".into(),
        index: 0,
        facts: BTreeMap::new(),
        bindings,
        started_at_ms: state.host.now_ms,
        valid_until_ms: 9_007_199_254_740_991,
        candidate: None,
        ledger,
        ownership_receipt: None,
    })
}
fn emit_scoped(out: &mut Output, e: &Execution, recipe: Recipe, stage: &str, step: &str) {
    let operation = if stage == "before" || stage == "after" {
        "observe"
    } else {
        &e.operation
    };
    let recipe_ref = if stage == "before"
        && step == "ownership"
        && recipe.fields.get("action") == Some(&json!("inspect"))
    {
        "remove/ownership".into()
    } else if ["before", "after"].contains(&stage) {
        format!("{}/{}/{}", e.operation, stage, step)
    } else {
        format!("{}/execute", e.operation)
    };
    let mut recipe = recipe;
    recipe.fields.insert("recipeRef".into(), json!(recipe_ref));
    recipe.fields.insert("stepId".into(), json!(step));
    recipe.fields.insert("stage".into(), json!(stage));
    recipe.fields.insert("bindings".into(), json!(e.bindings));
    recipe.fields.insert(
        "bindingRefs".into(),
        json!(e
            .bindings
            .iter()
            .map(|(k, v)| (k.clone(), v["authorityRef"].clone()))
            .collect::<BTreeMap<_, _>>()),
    );
    emit(
        out,
        &e.adapter_id,
        operation,
        recipe,
        None,
        e.resource_id.clone(),
        None,
    );
    let id = out.effects.last().expect("emitted effect").id.clone();
    out.state
        .pending
        .get_mut(&id)
        .expect("pending effect")
        .plan_ticket = Some(Ticket {
        stage: stage.into(),
        step_id: step.into(),
        execution_generation: e.generation,
    });
}
fn prepare_recipe(e: &Execution) -> Result<Recipe, String> {
    let mut recipe = executable(&e.recipe)?;
    if let Some(process) = e.recipe.fields.get("process") {
        if str_field(process, "mode") == "owned-long-running" {
            recipe.fields.insert("longRunning".into(), json!(true));
            recipe
                .fields
                .insert("lifetimeMs".into(), process["lifetimeMs"].clone());
            if let Some(collect) = process.get("collectMs") {
                recipe.fields.insert("collectMs".into(), collect.clone());
            }
        }
    }
    let parser = recipe.fields.remove("parser");
    recipe.fields = serde_json::from_value(expand(&json!(recipe.fields), &e.bindings)?)
        .map_err(|_| "Invalid expanded execution")?;
    if let Some(parser) = parser {
        recipe.fields.insert("parser".into(), parser);
    }
    Ok(recipe)
}
fn drive(out: &mut Output, mut e: Execution) -> Result<(), String> {
    let a = out
        .state
        .adapters
        .iter()
        .find(|a| a.id == e.adapter_id)
        .cloned()
        .ok_or("Lost adapter identity")?;
    resolve_bindings(&a, &mut e, &out.state, false)?;
    if e.stage == "before" {
        if let Some(step) = e.before.get(e.index) {
            let mut recipe = step.recipe.clone();
            recipe.fields = serde_json::from_value(expand(&json!(recipe.fields), &e.bindings)?)
                .map_err(|_| "Invalid expanded observation")?;
            emit_scoped(out, &e, recipe, "before", &step.id);
            out.state.execution = Some(e);
            return Ok(());
        }
        resolve_bindings(&a, &mut e, &out.state, true)?;
        if e.valid_until_ms <= out.state.host.now_ms {
            return Err("Preflight expired before durable intent".into());
        }
        if !e
            .requires
            .iter()
            .all(|r| assertion(r, &Value::Null, &e, &out.state, &Value::Null, 0))
        {
            return Err("Fresh preflight prerequisite failed".into());
        }
        if e.operation == "remove"
            && (e.ledger.is_none()
                || !e
                    .requires
                    .iter()
                    .any(|r| str_field(r, "op") == "owned-ledger-match"))
        {
            return Err("Removal lacks exact owned ledger/continuity guard".into());
        }
        if e.operation == "create"
            && (!materializations_valid(&a, &e, &out.state) || !mapping_plan_valid(&a, &e))
        {
            return Err("Private materialization authority mismatch".into());
        }
        let execute = prepare_recipe(&e)?;
        let record = json!({"operation":e.operation,"adapterId":e.adapter_id,"resourceId":e.resource_id,"sessionId":out.state.session_id,"generation":out.state.generation,"recipeRef":format!("{}/execute",e.operation),"execute":execute,"bindings":e.bindings,"baseline":e.facts,"ledger":e.ledger});
        let recipe = Recipe {
            kind: EffectKind::Persist,
            fields: BTreeMap::from([("record".into(), record)]),
        };
        e.stage = "persist".into();
        out.state.phase = "persisting".into();
        emit_scoped(out, &e, recipe, "persist", "intent");
        out.state.execution = Some(e);
        return Ok(());
    }
    if e.stage == "after" {
        if let Some(step) = e.after.get(e.index) {
            let mut recipe = step.recipe.clone();
            recipe.fields = serde_json::from_value(expand(&json!(recipe.fields), &e.bindings)?)
                .map_err(|_| "Invalid expanded readback")?;
            emit_scoped(out, &e, recipe, "after", &step.id);
            out.state.execution = Some(e);
            return Ok(());
        }
        if e.operation == "remove" {
            if let Some(r) = out
                .state
                .resources
                .iter_mut()
                .find(|r| Some(&r.id) == e.resource_id.as_ref() && r.ownership == "owned")
            {
                r.cleanup = "removed".into();
            }
            out.state.execution = None;
            cleanup(out);
            return Ok(());
        }
        out.state.execution = None;
        if out.state.stop_requested {
            cleanup(out);
            return Ok(());
        }
        let mappings: Vec<Value> = e
            .requires
            .iter()
            .filter(|rule| str_field(rule, "op") == "transport-mapping")
            .filter_map(|rule| expand(rule, &e.bindings).ok())
            .collect();
        if !mappings.is_empty() && mappings.iter().any(|rule| rule.get("origin").is_none()) {
            out.state.candidate = None;
            out.state.published = None;
            out.state.phase = "transport-ready".into();
            event(out, "transport-endpoint-ready");
            return Ok(());
        }
        let candidate = e
            .candidate
            .or_else(|| {
                a.endpoint_template
                    .as_ref()
                    .and_then(|s| expand(&json!(s), &e.bindings).ok())
                    .and_then(|s| s.as_str().and_then(origin))
            })
            .ok_or("No verified plan candidate origin")?;
        if mappings
            .iter()
            .any(|rule| rule.get("origin").and_then(Value::as_str) != Some(candidate.as_str()))
        {
            return Err("Transport mapping does not authorize candidate origin".into());
        }
        request_probe(out, &a, candidate)?;
        return Ok(());
    }
    Err("Invalid plan stage".into())
}
fn request_probe(out: &mut Output, a: &Adapter, url: String) -> Result<(), String> {
    let mut proof = out
        .state
        .host
        .probe
        .clone()
        .ok_or("Trusted instance probe challenge unavailable")?;
    if !opaque(str_field(&proof, "nonceRef"))
        || !opaque(str_field(&proof, "verifierRef"))
        || proof
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .is_none_or(|t| t <= out.state.host.now_ms)
    {
        return Err("Probe challenge missing authority or expired".into());
    }
    // Retire only the original authorization, never a caller's replacement deadline.
    // Legacy persisted nonces without metadata remain reserved for this session.
    let now = out.state.host.now_ms;
    let expiries = &out.state.used_nonce_expiries;
    out.state
        .used_nonces
        .retain(|nonce| expiries.get(nonce).is_none_or(|expires| *expires > now));
    let retained = &out.state.used_nonces;
    out.state
        .used_nonce_expiries
        .retain(|nonce, _| retained.contains(nonce));
    let nonce = str_field(&proof, "nonceRef").to_owned();
    if out.state.used_nonces.contains(&nonce) {
        return Err("Probe nonce was already used; a fresh challenge is required".into());
    }
    if out.state.used_nonces.len() >= 128 {
        return Err("Concurrent live probe challenge budget exhausted".into());
    }
    out.state.used_nonce_expiries.insert(
        nonce.clone(),
        proof["expiresAtMs"]
            .as_u64()
            .expect("validated challenge expiry"),
    );
    out.state.used_nonces.push(nonce);
    // Core-owned issuance time prevents an old receipt surviving nonce retirement.
    // Override any host-supplied timestamp rather than trusting it.
    proof["issuedAtMs"] = json!(now);
    out.state.health_expiry = None;
    probe(out, &a.id, url.clone());
    let Some(effect) = out
        .effects
        .last_mut()
        .filter(|e| e.kind == EffectKind::HttpProbe)
    else {
        return Err("Probe origin does not meet requirements".into());
    };
    effect.fields.insert("recipeRef".into(), json!("probe"));
    effect.fields.insert("stepId".into(), json!("probe"));
    effect.fields.insert("stage".into(), json!("probe"));
    effect.fields.insert("probe".into(), proof.clone());
    effect
        .fields
        .insert("tls".into(), json!(url.starts_with("https://")));
    let effect = effect.clone();
    let pending = out
        .state
        .pending
        .get_mut(&effect.id)
        .ok_or("Missing probe")?;
    pending.effect = effect;
    pending.plan_ticket = Some(Ticket {
        stage: "probe".into(),
        step_id: "probe".into(),
        execution_generation: out.state.generation,
    });
    Ok(())
}
pub fn start(out: &mut Output, cmd: &Value) {
    let result = (|| -> Result<(), String> {
        if out.state.execution.is_some()
            || out
                .state
                .pending
                .values()
                .any(|p| matches!(p.effect.operation.as_str(), "create" | "remove"))
            || out
                .state
                .resources
                .iter()
                .any(|r| r.ownership == "owned" && r.cleanup != "removed")
        {
            return Err("Session still owns resources or unresolved work".into());
        }
        let a = out
            .state
            .adapters
            .iter()
            .find(|a| a.id == str_field(cmd, "adapterId"))
            .cloned()
            .ok_or("Unknown adapter")?;
        admissible(&a, &out.state)?;
        if !potential(&a, &out.state.requirements) {
            return Err(
                "Audience or explicitly unsupported capability does not meet requirements".into(),
            );
        }
        if cmd.get("consent") != Some(&Value::Bool(true)) {
            out.action = Some(json!({"kind":"confirm","adapterId":a.id}));
            return Ok(());
        }
        out.state.generation += 1;
        out.state.stop_requested = false;
        out.state.selected = Some(a.id.clone());
        out.state.candidate = None;
        out.state.published = None;
        if a.ownership == "external-owned" {
            let mut e = Execution {
                adapter_id: a.id.clone(),
                operation: "validate".into(),
                resource_id: None,
                generation: out.state.generation,
                recipe: Recipe {
                    kind: EffectKind::HttpProbe,
                    fields: BTreeMap::new(),
                },
                before: vec![],
                after: vec![],
                requires: vec![],
                stage: "probe".into(),
                index: 0,
                facts: BTreeMap::new(),
                bindings: BTreeMap::new(),
                started_at_ms: out.state.host.now_ms,
                valid_until_ms: 9_007_199_254_740_991,
                candidate: None,
                ledger: None,
                ownership_receipt: None,
            };
            resolve_bindings(&a, &mut e, &out.state, true)?;
            let url = a
                .endpoint_template
                .as_ref()
                .and_then(|s| expand(&json!(s), &e.bindings).ok())
                .and_then(|s| s.as_str().and_then(origin))
                .or_else(|| a.endpoint.as_deref().and_then(origin))
                .ok_or("Existing external origin not provided by typed authority")?;
            request_probe(out, &a, url)?;
            return Ok(());
        }
        if a.ownership != "owned" {
            return Err("Unknown resource ownership".into());
        }
        let e = make_execution(&a, "create", None, &out.state)?;
        out.state.phase = "preflight".into();
        drive(out, e)
    })();
    if let Err(error) = result {
        fail(out, &error);
    }
}
pub fn cancel_readonly(out: &mut Output) {
    if !out.state.stop_requested {
        return;
    }
    if out.state.execution.as_ref().is_some_and(|e| {
        e.operation == "create" && matches!(e.stage.as_str(), "before" | "persist")
    }) {
        out.state.execution = None;
    }
}
pub fn reconcile_absent(out: &mut Output, cmd: &Value) {
    let id = str_field(cmd, "resourceId");
    let valid = out.state.resources.iter().any(|resource| {
        let Some(ledger) = resource.ledger.as_ref() else {
            return false;
        };
        let Some(receipt) = out.state.host.cleanup_absent.get(id) else {
            return false;
        };
        out.state.stop_requested
            && resource.id == id
            && resource.ownership == "owned"
            && resource.cleanup != "removed"
            && ledger.kind == "process"
            && ledger.handle_ref == id
            && !ledger.continuity_ref.is_empty()
            && receipt.as_object().is_some_and(|fields| {
                fields.keys().all(|key| {
                    [
                        "sessionId",
                        "handleRef",
                        "continuityRef",
                        "processGone",
                        "providerAbsent",
                        "observedAtMs",
                        "expiresAtMs",
                    ]
                    .contains(&key.as_str())
                })
            })
            && fresh(receipt, &out.state)
            && receipt.get("handleRef").and_then(Value::as_str) == Some(ledger.handle_ref.as_str())
            && receipt.get("continuityRef").and_then(Value::as_str)
                == Some(ledger.continuity_ref.as_str())
            && receipt.get("processGone") == Some(&Value::Bool(true))
            && receipt.get("providerAbsent") == Some(&Value::Bool(true))
    });
    if !valid {
        event(out, "cleanup-absence-unproven");
        return;
    }
    for resource in &mut out.state.resources {
        if resource.id == id {
            resource.cleanup = "removed".into();
        }
    }
    // A known absent allocation cannot finish an uncertain create or another removal.
    out.state.pending.retain(|_, pending| {
        !(pending.resource_id.as_deref() == Some(id)
            && (pending.effect.operation == "remove"
                || (pending.effect.operation == "observe"
                    && pending
                        .effect
                        .fields
                        .get("recipeRef")
                        .and_then(Value::as_str)
                        .is_some_and(|reference| reference.starts_with("remove/")))))
    });
    if out.state.execution.as_ref().is_some_and(|execution| {
        execution.operation == "remove" && execution.resource_id.as_deref() == Some(id)
    }) {
        out.state.execution = None;
    }
    event(out, "cleanup-absence-reconciled");
    stop_phase(out);
}
pub fn begin_cleanup(out: &mut Output, r: &Resource) {
    if out.state.execution.is_some()
        || out
            .state
            .pending
            .values()
            .any(|p| p.resource_id.as_ref() == Some(&r.id))
    {
        return;
    }
    let result = (|| -> Result<(), String> {
        let a = out
            .state
            .adapters
            .iter()
            .find(|a| a.id == r.adapter_id)
            .cloned()
            .ok_or("Removal adapter unavailable")?;
        let mut e = make_execution(&a, "remove", Some(r), &out.state)?;
        if e.recipe.kind == EffectKind::OwnedProcess || e.recipe.kind == EffectKind::LocalForwarder
        {
            // Intrinsic handle inspection: no synthetic provider schema or recursive command search.
            let kind = e.recipe.kind.clone();
            let ledger = e
                .ledger
                .clone()
                .ok_or("Immutable local ownership handle unavailable")?;
            e.before.insert(
                0,
                PlanStep {
                    id: "ownership".into(),
                    recipe: Recipe {
                        kind,
                        fields: BTreeMap::from([
                            ("action".into(), json!("inspect")),
                            ("ownership".into(), json!(ledger)),
                        ]),
                    },
                    captures: BTreeMap::new(),
                    assert: None,
                },
            );
            e.requires
                .push(json!({"op":"owned-ledger-match","source":"ownership","pointer":"/route"}));
        }
        out.state.phase = "cleanup-pending".into();
        drive(out, e)
    })();
    if let Err(error) = result {
        fail(out, &error);
    }
}
fn owned(result: &Value, e: &Execution, state: &State) -> Result<Ledger, String> {
    let value = result
        .get("ownership")
        .ok_or("Create has no immutable ownership receipt; outcome unresolved")?;
    let kind = str_field(value, "kind");
    let handle = str_field(value, "handleRef");
    let continuity = str_field(value, "continuityRef");
    if !opaque(handle)
        || !opaque(continuity)
        || !["process", "forwarder", "route"].contains(&kind)
        || str_field(value, "sessionId") != state.session_id
        || value.get("generation").and_then(Value::as_u64) != Some(e.generation)
    {
        return Err("Create ownership receipt is invalid or wrong scope".into());
    }
    let expected_kind = if e.recipe.kind == EffectKind::LocalForwarder {
        "forwarder"
    } else if e
        .recipe
        .fields
        .get("process")
        .is_some_and(|p| str_field(p, "mode") == "owned-long-running")
        || e.recipe.fields.get("longRunning") == Some(&Value::Bool(true))
    {
        "process"
    } else {
        "route"
    };
    if kind != expected_kind {
        return Err("Allocation receipt has wrong resource kind".into());
    }
    let details = value
        .get("details")
        .cloned()
        .ok_or("Ownership details absent")?;
    let expected = e
        .recipe
        .fields
        .get("ledger")
        .map(|v| expand(v, &e.bindings))
        .transpose()?;
    if !details.is_object() || details.to_string().len() > 8192 {
        return Err("Owned ledger details invalid or too large".into());
    }
    if kind == "route" && (expected.is_none() || e.after.is_empty()) {
        return Err("Mapping allocation requires exact ledger and readback".into());
    }
    Ok(Ledger {
        handle_ref: handle.into(),
        continuity_ref: continuity.into(),
        kind: kind.into(),
        details,
        baseline: json!(e.facts),
        bindings: e.bindings.clone(),
    })
}
fn record_allocation(out: &mut Output, e: &mut Execution, result: &Value) -> Result<(), String> {
    let ledger = owned(result, e, &out.state)?;
    if out
        .state
        .resources
        .iter()
        .any(|r| r.id == ledger.handle_ref)
    {
        return Err("Duplicate owned resource handle".into());
    }
    let current = e.generation == out.state.generation && !out.state.stop_requested;
    out.state.resources.push(Resource {
        id: ledger.handle_ref.clone(),
        adapter_id: e.adapter_id.clone(),
        generation: e.generation,
        ownership: "owned".into(),
        cleanup: if current { "active" } else { "pending" }.into(),
        ledger: Some(ledger.clone()),
    });
    e.resource_id = Some(ledger.handle_ref.clone());
    e.ledger = Some(ledger);
    Ok(())
}
pub fn expire(out: &mut Output) {
    withdraw(
        out,
        "Origin health receipt expired; a fresh intended-vantage check is required",
    );
}
fn withdraw(out: &mut Output, message: &str) {
    out.state.health_expiry = None;
    out.state.published = None;
    out.state.phase = "degraded".into();
    event(out, "endpoint-withdrawn");
    limit(out, message);
    out.action = Some(
        json!({"kind":"external","instruction":"The current address could not be verified. Check the owner-managed route and supply a fresh health receipt.","recheckCommand":"health"}),
    );
}
// Conservative public-unicast classification, using address values only (no DNS or IO).
fn public_relay_ip(value: &str) -> bool {
    match value.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192
                    && (b == 168 || (b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        Ok(std::net::IpAddr::V6(ip)) => {
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && (s[1] & 0xf000) == 0)
        }
        Err(_) => false,
    }
}
fn valid_network_path(vantage: &str, receipt: &Value, challenge: &Value) -> bool {
    vantage == "local"
        || receipt.get("remote") == Some(&Value::Bool(true))
        || (vantage == "public"
            && str_field(receipt, "vantage") == "public"
            && challenge.get("allowPublicRelay") == Some(&Value::Bool(true))
            && receipt.get("remote") == Some(&Value::Bool(false))
            && str_field(receipt, "networkPath") == "public-relay"
            && receipt.get("publicDns") == Some(&Value::Bool(true))
            && public_relay_ip(str_field(receipt, "resolvedIp")))
}
fn finish_probe(out: &mut Output, p: &Pending, cmd: &Value) {
    let result = &cmd["result"];
    let receipt = &result["probeReceipt"];
    let challenge = &p.effect.fields["probe"];
    let url = p.origin.as_deref().unwrap_or("");
    let vantage = str_field(&json!(p.effect.fields), "vantage").to_owned();
    let required = &out.state.requirements;
    let now = out.state.host.now_ms;
    let valid = cmd.get("ok") == Some(&Value::Bool(true))
        && p.effect.generation == out.state.generation
        && !out.state.stop_requested
        && out.state.candidate.as_deref() == Some(url)
        && str_field(receipt, "nonceRef") == str_field(challenge, "nonceRef")
        && str_field(receipt, "verifierRef") == str_field(challenge, "verifierRef")
        && str_field(receipt, "origin") == url
        && str_field(receipt, "vantage") == vantage
        && receipt
            .get("observedAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|t| {
                t <= now
                    && challenge
                        .get("issuedAtMs")
                        .and_then(Value::as_u64)
                        .is_none_or(|issued| t >= issued)
            })
        && receipt
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|t| t > now)
        && challenge
            .get("expiresAtMs")
            .and_then(Value::as_u64)
            .is_some_and(|t| t > now)
        && receipt.get("instanceMatched") == Some(&Value::Bool(true))
        && valid_network_path(&vantage, receipt, challenge)
        && (!url.starts_with("https://") || receipt.get("tls") == Some(&Value::Bool(true)))
        && (!required.sse || receipt.get("sse") == Some(&Value::Bool(true)))
        && (!required.streamable_http || receipt.get("streamableHttp") == Some(&Value::Bool(true)))
        && (!required.oauth_dcr || receipt.get("oauthDcr") == Some(&Value::Bool(true)));
    out.state.pending.remove(&p.effect.id);
    if !valid {
        if p.effect.generation == out.state.generation && !out.state.stop_requested {
            withdraw(
                out,
                "Current origin health proof failed or expired; external owner action required",
            );
        } else {
            event(out, "stale-plan-probe");
        }
        return;
    }
    out.state.phase = "candidate-ready".into();
    event(out, "endpoint-proposed");
    out.action =
        Some(json!({"kind":"confirm-origin","origin":url,"generation":out.state.generation}));
    let expires = receipt["expiresAtMs"]
        .as_u64()
        .unwrap_or(now)
        .min(challenge["expiresAtMs"].as_u64().unwrap_or(now));
    out.state.health_expiry = Some(expires);
    let recipe = Recipe {
        kind: EffectKind::Timer,
        fields: BTreeMap::from([
            ("delayMs".into(), json!(expires - now)),
            ("expiresAtMs".into(), json!(expires)),
            ("recipeRef".into(), json!("health/expiry")),
            ("stepId".into(), json!("expiry")),
            ("stage".into(), json!("health")),
        ]),
    };
    emit(
        out,
        &p.adapter_id,
        "health",
        recipe,
        None,
        None,
        Some(url.into()),
    );
    let id = out.effects.last().expect("health timer").id.clone();
    out.state
        .pending
        .get_mut(&id)
        .expect("pending timer")
        .plan_ticket = Some(Ticket {
        stage: "health".into(),
        step_id: "expiry".into(),
        execution_generation: out.state.generation,
    });
}
pub fn complete(out: &mut Output, p: &Pending, cmd: &Value) {
    let ticket = p.plan_ticket.as_ref().expect("operational ticket");
    if ticket.stage == "probe" {
        finish_probe(out, p, cmd);
        return;
    }
    if ticket.stage == "health" {
        out.state.pending.remove(&p.effect.id);
        if p.effect.generation == out.state.generation
            && !out.state.stop_requested
            && out.state.candidate == p.origin
        {
            withdraw(
                out,
                "Origin health receipt expired; a fresh intended-vantage check is required",
            );
        }
        return;
    }
    let Some(mut e) = out.state.execution.take() else {
        out.state.pending.remove(&p.effect.id);
        event(out, "cancelled-plan-callback");
        if out.state.stop_requested {
            cleanup(out);
        }
        return;
    };
    if e.generation != ticket.execution_generation || e.stage != ticket.stage {
        out.state.execution = Some(e);
        event(out, "out-of-order-plan-callback");
        return;
    }
    let result = &cmd["result"];
    let ok = cmd.get("ok") == Some(&Value::Bool(true));
    let current = e.generation == out.state.generation && !out.state.stop_requested;
    let completed = (|| -> Result<(), String> {
        if e.stage == "persist" {
            out.state.pending.remove(&p.effect.id);
            if !ok || result.get("durable") != Some(&Value::Bool(true)) {
                return Err("Operational mutation intent was not durably acknowledged".into());
            }
            if e.operation == "create" && !current {
                return Ok(());
            }
            if e.valid_until_ms <= out.state.host.now_ms {
                return Err("Fresh preflight expired while intent was being persisted".into());
            }
            if !e
                .requires
                .iter()
                .all(|r| assertion(r, &Value::Null, &e, &out.state, &Value::Null, 0))
            {
                return Err("Preflight authority changed before mutation".into());
            }
            let adapter = out
                .state
                .adapters
                .iter()
                .find(|adapter| adapter.id == e.adapter_id)
                .ok_or("Adapter unavailable")?;
            admissible(adapter, &out.state)?;
            if e.operation == "create"
                && (!materializations_valid(adapter, &e, &out.state)
                    || !mapping_plan_valid(adapter, &e))
            {
                return Err("Private materialization scope changed before mutation".into());
            }
            for (name, saved) in &e.bindings {
                if e.operation == "remove"
                    && (e.recipe.kind == EffectKind::OwnedProcess
                        || immutable_cleanup_binding(saved))
                {
                    continue;
                }
                if let Some(authority) = saved.get("hostAuthority") {
                    let current = out
                        .state
                        .host
                        .bindings
                        .get(name)
                        .ok_or("Host binding disappeared before mutation")?;
                    if !fresh(current, &out.state)
                        || current.get("value") != saved.get("value")
                        || current.get("handleRef") != saved.get("handleRef")
                        || current.get("authorityRef") != Some(authority)
                        || (immutable_cleanup_binding(saved)
                            && current.get("generation") != saved.get("generation"))
                        || current.get("materialization") != saved.get("materialization")
                        || current.get("mode") != saved.get("mode")
                        || current.get("parentMode") != saved.get("parentMode")
                    {
                        return Err("Host binding identity changed before mutation".into());
                    }
                }
            }
            let recipe = prepare_recipe(&e)?;
            e.stage = "execute".into();
            emit_scoped(out, &e, recipe, "execute", "execute");
            out.state.execution = Some(e);
            return Ok(());
        }
        if e.stage == "execute" {
            let exit_ok = result
                .get("exitCode")
                .and_then(Value::as_i64)
                .is_none_or(|n| n == 0);
            if e.operation == "create" {
                if let Err(error) = record_allocation(out, &mut e, result) {
                    if !ok && result.get("notApplied") == Some(&Value::Bool(true)) {
                        out.state.pending.remove(&p.effect.id);
                        return Err("Create confirmed not applied".into());
                    }
                    // No safe attribution yet: retain request and never issue another create.
                    out.state.execution = Some(e);
                    limit(out, &error);
                    out.state.phase = if out.state.stop_requested {
                        "stopping"
                    } else {
                        "failed"
                    }
                    .into();
                    return Ok(());
                }
                out.state.pending.remove(&p.effect.id);
                if e.recipe
                    .fields
                    .get("ledger")
                    .map(|v| expand(v, &e.bindings))
                    .transpose()?
                    .as_ref()
                    .is_some_and(|expected| {
                        e.ledger.as_ref().is_none_or(|l| &l.details != expected)
                    })
                {
                    return Err("Created allocation differs from consented ledger; owned cleanup debt retained".into());
                }
                if !current {
                    if let Some(r) = out
                        .state
                        .resources
                        .iter_mut()
                        .find(|r| Some(&r.id) == e.resource_id.as_ref())
                    {
                        r.cleanup = "pending".into();
                    }
                    out.state.execution = None;
                    cleanup(out);
                    return Ok(());
                }
                if !ok || !exit_ok {
                    return Err("Create returned an owned allocation but completion failed; cleanup debt retained".into());
                }
                e.candidate = parse(&p.parser, result).and_then(|s| origin(&s));
            } else {
                out.state.pending.remove(&p.effect.id);
                if !ok || !exit_ok || result.get("removed") != Some(&Value::Bool(true)) {
                    return Err("Owned removal is unconfirmed; do not blindly reissue".into());
                }
            }
            e.stage = "after".into();
            e.index = 0;
            return drive(out, e);
        }
        if e.operation == "create" && !current {
            out.state.pending.remove(&p.effect.id);
            cleanup(out);
            return Ok(());
        }
        let steps = if e.stage == "before" {
            &e.before
        } else {
            &e.after
        };
        let step = steps
            .get(e.index)
            .cloned()
            .ok_or("Plan step cursor out of bounds")?;
        out.state.pending.remove(&p.effect.id);
        if step.id != ticket.step_id || !ok {
            return Err("Ordered observation failed".into());
        }
        let observation = &result["observation"];
        if !fresh(observation, &out.state)
            || !opaque(str_field(observation, "authorityRef"))
            || observation
                .get("observedAtMs")
                .and_then(Value::as_u64)
                .is_none_or(|t| t < e.started_at_ms)
        {
            return Err("Observation missing scoped fresh authority/time receipt".into());
        }
        e.valid_until_ms = e
            .valid_until_ms
            .min(observation["expiresAtMs"].as_u64().unwrap_or(0));
        let raw = str_field(result, "stdout");
        if raw.len() > 1_048_576 {
            return Err("Observation exceeds core byte limit".into());
        }
        let doc = if raw.is_empty() {
            result.clone()
        } else {
            serde_json::from_str(raw).map_err(|_| "Observation is not a JSON document")?
        };
        if step.id == "ownership" && step.recipe.fields.get("action") == Some(&json!("inspect")) {
            let ledger = e.ledger.as_ref().ok_or("Missing ownership ledger")?;
            let receipt = &result["ownershipReceipt"];
            if !continuity(receipt, ledger, &out.state)
                || doc.get("details") != Some(&ledger.details)
            {
                return Err("Local immutable handle continuity or exact details changed".into());
            }
            e.facts
                .insert(step.id.clone(), json!({"route":ledger.details}));
        } else {
            if step
                .assert
                .as_ref()
                .is_some_and(|rule| !assertion(rule, &doc, &e, &out.state, result, 0))
            {
                return Err(
                    "Raw current record assertion failed; preserve administrator changes".into(),
                );
            }
            if parse(&p.parser, result).is_none() {
                return Err("Observation parser failed".into());
            }
            let mut facts = serde_json::Map::new();
            for (name, spec) in &step.captures {
                facts.insert(name.clone(), capture(&doc, spec, &e.bindings, 0)?);
            }
            e.facts.insert(step.id.clone(), Value::Object(facts));
        }
        if let (Some(receipt), Some(ledger)) = (result.get("ownershipReceipt"), e.ledger.as_ref()) {
            if !continuity(receipt, ledger, &out.state) {
                return Err("Ownership continuity unknown or changed".into());
            }
            e.ownership_receipt = Some(
                json!({"handleRef":receipt["handleRef"],"continuityRef":receipt["continuityRef"],"sessionId":receipt["sessionId"],"observedAtMs":receipt["observedAtMs"],"expiresAtMs":receipt["expiresAtMs"],"continuous":true}),
            );
            e.valid_until_ms = e
                .valid_until_ms
                .min(receipt["expiresAtMs"].as_u64().unwrap_or(0));
        }
        e.index += 1;
        drive(out, e)
    })();
    if let Err(error) = completed {
        for r in &mut out.state.resources {
            if r.ledger.is_some() && r.cleanup != "removed" {
                r.cleanup = "pending".into();
            }
        }
        fail(out, &error);
    }
}
pub fn health(out: &mut Output, rotate: bool) {
    let result = (|| -> Result<(), String> {
        if out.state.stop_requested {
            return Err("Stopped session cannot refresh health".into());
        }
        let a = out
            .state
            .adapters
            .iter()
            .find(|a| Some(&a.id) == out.state.selected.as_ref() && a.plan_version == Some(1))
            .cloned()
            .ok_or("No operational session selected")?;
        let mut url = out.state.candidate.clone().ok_or("No current candidate")?;
        if rotate {
            if a.ownership != "external-owned" {
                return Err("Host origin updates apply only to external-owned routes".into());
            }
            let b = out
                .state
                .host
                .bindings
                .get("externalOrigin")
                .ok_or("Missing explicit origin authority")?;
            if !fresh(b, &out.state)
                || str_field(b, "type") != "credential-free-https-origin"
                || !typed("credential-free-https-origin", &b["value"])
            {
                return Err("Updated origin authority invalid or expired".into());
            }
            url = b["value"].as_str().ok_or("Invalid external origin")?.into();
        }
        out.state.generation += 1;
        out.state.published = None;
        out.state.candidate = None;
        event(out, "endpoint-withdrawn");
        request_probe(out, &a, url)
    })();
    if let Err(error) = result {
        withdraw(out, &error);
    }
}

pub fn owned_process_origin(out: &mut Output, cmd: &Value) {
    let mut route_withdrawn = false;
    let result = (|| -> Result<(), String> {
        if out.state.stop_requested {
            return Err("Stopped session cannot rotate an owned route".into());
        }
        if str_field(cmd, "sessionId") != out.state.session_id {
            return Err("Owned route session mismatch".into());
        }
        let adapter_id = str_field(cmd, "adapterId");
        let resource_id = str_field(cmd, "resourceId");
        let continuity = str_field(cmd, "continuityRef");
        let allocation_generation = cmd
            .get("allocationGeneration")
            .and_then(Value::as_u64)
            .ok_or("Missing allocation generation")?;
        let adapter = out
            .state
            .adapters
            .iter()
            .find(|a| a.id == adapter_id && a.ownership == "owned" && a.plan_version == Some(1))
            .cloned()
            .ok_or("Owned route adapter mismatch")?;
        if out.state.selected.as_deref() != Some(adapter_id) {
            return Err("Owned route adapter is not selected".into());
        }
        let resource = out
            .state
            .resources
            .iter()
            .find(|r| r.id == resource_id)
            .ok_or("Owned route resource is unknown")?;
        let ledger = resource
            .ledger
            .as_ref()
            .ok_or("Owned route lacks immutable cleanup ledger")?;
        if resource.ownership != "owned"
            || resource.cleanup != "active"
            || resource.adapter_id != adapter_id
            || resource.generation != allocation_generation
            || ledger.handle_ref != resource_id
            || ledger.continuity_ref != continuity
            || ledger.kind != "process"
        {
            return Err("Owned route resource identity mismatch".into());
        }
        let recipe = adapter
            .recipes
            .get("create")
            .ok_or("Create recipe unavailable")?;
        if recipe.kind != EffectKind::Spawn
            || recipe
                .fields
                .get("process")
                .is_none_or(|p| str_field(p, "mode") != "owned-long-running")
        {
            return Err("Route rotation requires an admitted long-running owned process".into());
        }
        let parser = recipe
            .fields
            .get("parser")
            .ok_or("Create URL parser unavailable")?;
        if str_field(parser, "kind") != "url" {
            return Err("Route rotation requires the admitted create URL parser".into());
        }
        let url = str_field(cmd, "origin");
        let line = str_field(cmd, "line");
        if super::parse_url(parser, line, "").as_deref() != Some(url) {
            return Err("Replacement origin violates the admitted URL parser".into());
        }
        let old = out
            .state
            .published
            .clone()
            .or_else(|| out.state.candidate.clone())
            .ok_or("No active route to rotate")?;
        if old == url {
            return Ok(());
        }
        out.state.generation += 1;
        out.state.published = None;
        out.state.candidate = None;
        route_withdrawn = true;
        if adapter.origin_policy.as_deref() == Some("immutable") {
            out.state.last_route_change =
                Some(json!({"oldOrigin":old,"newOrigin":url,"generation":out.state.generation}));
            out.events.push(json!({"type":"route-lost","sessionId":out.state.session_id,"generation":out.state.generation,"oldOrigin":old,"newOrigin":url}));
            withdraw(
                out,
                "Owned route changed its fixed address; stop and start a new session",
            );
            out.action = Some(
                json!({"kind":"external", "instruction":"Stop the current session and start a new route.", "recheckCommand":"stop"}),
            );
            return Ok(());
        }
        out.state.last_route_change =
            Some(json!({"oldOrigin":old,"newOrigin":url,"generation":out.state.generation}));
        out.events.push(json!({"type":"route-change","sessionId":out.state.session_id,"generation":out.state.generation,"oldOrigin":old,"newOrigin":url}));
        event(out, "endpoint-withdrawn");
        request_probe(out, &adapter, url.to_owned())
    })();
    if let Err(error) = result {
        if route_withdrawn {
            withdraw(out, &error);
        } else {
            limit(out, &error);
            event(out, "owned-route-rotation-rejected");
        }
    }
}
pub fn potential(a: &Adapter, r: &Requirements) -> bool {
    if !super::reach_allowed(&a.audience, &r.client_reach) {
        return false;
    }
    [
        ("https", r.https_required || a.audience == "public"),
        ("sse", r.sse),
        ("streamableHttp", r.streamable_http),
        ("oauthDcr", r.oauth_dcr),
    ]
    .iter()
    .all(|(k, required)| !required || a.capabilities.get(*k) != Some(&Value::Bool(false)))
}
```

## Exact public applied/rotation/clear/locked and enumeration/rejection reproduction
```js
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createGozar,createServiceVerifier} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {createEffectFixtureHost} from './testing-effects.mjs';
import {SecretBackend} from './public-journey.mjs';
import http from 'node:http';
import {once} from 'node:events';
const mode=process.argv[2],parent=join(homedir(),'.tmp','ra');await mkdir(parent,{recursive:true,mode:0o700});const root=await mkdtemp(join(parent,'boundary-')),home=join(root,'h'),owner='fixture-owner',report={mode,calls:[]};
const registry=await fakeRegistry({id:'fixture-saffron',proofProtocol:'http',transport:'http',kinds:['attached'],reach:'this-device',dir:join(root,'registry'),...(mode==='locked'?{setupActions:[{id:'saffron.credential',kind:'provide-secret',label:'Credential',secretLabel:'Credential',required:true,digest:'fixture-v1',disclosure:{revision:'fixture-v1',text:'Fixture custody',links:[]}}]}:{})});
class LockedBackend extends SecretBackend {locked=false;async withSecret(input,use){if(this.locked)throw Object.assign(new Error("backend locked"),{code:"secret_backend_locked"});return super.withSecret(input,use)}async presence(input){return this.locked?{known:false,reason:'secret_backend_locked'}:super.presence(input)}}
const backend=new LockedBackend(),harness=await createEffectFixtureHost({manifest:registry.manifest,root:registry.root,secretBackend:backend,hostCapabilities:{'secrets.backend':{known:true,value:true},'runtime.attached':{known:true,value:true}}},[]),gozar=mode==='enumeration'?createGozar({manifest:registry.manifest,root:registry.root,secretBackend:backend,identity:{instanceId:crypto.randomUUID(),bootId:crypto.randomUUID()},hostCapabilities:{'secrets.backend':{known:true,value:true},'runtime.attached':{known:true,value:true}}}):harness.gozar;
let app;
try{
 const provider=(await gozar.listProviders({home,owner})).providers[0];
 if(mode==='locked'){
  let draft=await gozar.beginConfigurationDraft({home,owner,providerId:provider.providerId,expectedConfigurationRevision:provider.configuration.revision});const c=draft.configuration,a=c.actions.find(a=>a.kind==='provide-secret'),f=c.inputRequirements.find(f=>f.actionId===a.id);
  const {handle}=await gozar.storeSecret({home,owner,providerId:provider.providerId,draftId:draft.draftId,expectedConfigurationRevision:c.revision,scopeId:draft.scopeId,inputId:f.id,bytes:new TextEncoder().encode('fixture-only-credential')});
  await gozar.runSetupAction({home,owner,providerId:provider.providerId,draftId:draft.draftId,expectedConfigurationRevision:c.revision,actionId:a.id,secretHandle:handle,approval:{kind:'setup',digest:a.digest,disclosureRevision:a.disclosure.revision,consentFactsDigest:a.consent.consentFactsDigest}});
  const fresh=await gozar.readConfigurationDraft({home,owner,providerId:provider.providerId,draftId:draft.draftId});const applied=await gozar.commitConfigurationDraft({home,owner,providerId:provider.providerId,draftId:draft.draftId,expectedConfigurationRevision:fresh.configuration.revision});draft=await gozar.beginConfigurationDraft({home,owner,providerId:provider.providerId,expectedConfigurationRevision:applied.revision});const clear=draft.configuration.actions.find(a=>a.kind==='clear-input');draft.configuration=await gozar.clearConfigurationInput({home,owner,providerId:provider.providerId,draftId:draft.draftId,inputId:clear.inputId,expectedConfigurationRevision:draft.configuration.revision,approval:{kind:'setup',digest:clear.digest,disclosureRevision:clear.disclosure.revision,consentFactsDigest:clear.consent.consentFactsDigest}});const action=draft.configuration.actions.find(a=>a.kind==='provide-secret'),field=draft.configuration.inputRequirements.find(f=>f.actionId===action.id);const staged=await gozar.storeSecret({home,owner,providerId:provider.providerId,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision,scopeId:draft.scopeId,inputId:field.id,bytes:new TextEncoder().encode('fixture-rotation-credential')});await gozar.runSetupAction({home,owner,providerId:provider.providerId,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision,actionId:action.id,secretHandle:staged.handle,approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}});
  backend.locked=true;const seen=await gozar.readConfigurationDraft({home,owner,providerId:provider.providerId,draftId:draft.draftId});report.calls.push({method:'readConfigurationDraft',input:{home:'<owned test home>',providerId:provider.providerId,draftId:draft.draftId},expected:'nonempty unknown credential observations, reason secret_backend_locked',actual:seen.configuration.credentials});assert.ok(Object.keys(seen.configuration.credentials).length);for(const value of Object.values(seen.configuration.credentials)){assert.equal(value.known,false);assert.equal(value.reason,'secret_backend_locked')}
 }else{
  const verifier=createServiceVerifier();app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('fixture application')});app.listen(0,'127.0.0.1');await once(app,'listening');
  const q={schemaVersion:1,home,owner,providerId:provider.providerId,target:`127.0.0.1:${app.address().port}`,usage:{kind:'attached'},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};const c=(await gozar.catalogRoutes(q)).candidates[0];
  if(mode==='rejected'){
   const definitionPath=join(registry.root,registry.manifest.providers[0].definition),definition=JSON.parse(await readFile(definitionPath,'utf8'));definition.adapter.facts.push({id:'saffron.new-boundary',label:'New boundary',value:'changed',known:true,affectsConsent:true,group:'jurisdiction-new',source:'fixture-data',asOf:null});await writeFile(definitionPath,JSON.stringify(definition));
   const input={...q,operationId:crypto.randomUUID(),wait:'verified',approval:{kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest}};await assert.rejects(gozar.expose(input),{code:'artifact_integrity_failed'});report.calls.push({method:'expose',input:{...input,home:'<owned test home>'},actual:'artifact_integrity_failed',effects:harness.events});
   const listed=await gozar.listRoutes({home,owner});report.calls.push({method:'listRoutes',actual:listed});for(const r of listed.routes){const closed=await gozar.closeRoute({home,handle:r.handle,mode:'remove'});report.calls.push({method:'closeRoute',input:{home:'<owned test home>',handle:r.handle,mode:'remove'},expected:'confirmed',actual:closed.cleanup});assert.equal(closed.cleanup.state,'confirmed')}
  }else{
  const initial=await gozar.expose({...q,operationId:crypto.randomUUID(),wait:'verified',approval:{kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest}});assert.equal(initial.verification.status,'verified');const current=await gozar.routeStatus({home,handle:initial.handle});assert.equal(current.verification.status,'verified');const listed=(await gozar.listRoutes({home,owner})).routes.find(r=>r.operationId===initial.operationId);report.calls.push({method:'listRoutes',input:{home:'<owned test home>',owner},expected:{published:current.published,verification:current.verification},actual:{published:listed.published,verification:listed.verification}});assert.equal(listed.published,current.published);assert.deepEqual(listed.verification,current.verification);
  }
 }
}catch(error){report.error={code:error.code,message:error.message,expected:error.expected,actual:error.actual};process.exitCode=1}
finally{backend.locked=false;report.cleanup=[];try{for(const route of(await gozar.listRoutes({home,owner})).routes){try{const closed=await gozar.closeRoute({home,handle:route.handle,mode:'remove'});report.cleanup.push(closed.cleanup)}catch(e){report.cleanup.push({code:e.code})}}await harness.close()}catch(e){report.cleanup.push({code:e.code})}if(app){app.closeAllConnections();app.close();await once(app,'close')}console.log(JSON.stringify(report,null,2));console.error('Retained fixture:',root)}
process.exit(process.exitCode??0);

```

## Host-only independent aggregate entrypoint
```js
// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { statfs, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
const output = process.env.GOZAR_COVERAGE_MATRIX;
if (!output)
	throw new Error("GOZAR_COVERAGE_MATRIX must name an external evidence file");
const results = [];
async function run(name, args, reserve = 5_000_000_000, extraEnv = {}) {
	const disk = await statfs(process.cwd());
	if (disk.bavail * disk.bsize < 100_000_000_000 + reserve) {
		results.push({
			name,
			result: "NOT RUN (disk)",
			requiredFreeBytes: 100_000_000_000 + reserve,
		});
		return;
	}
	const child = spawn(args[0], args.slice(1), {
		stdio: "inherit",
		env: { ...process.env, ...extraEnv },
	});
	const exitCode = await new Promise((accept, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => accept(code ?? signal));
	});
	results.push({ name, command: args, exitCode });
}
await run("install checked tarball", [
	process.execPath,
	"scripts/reachability/install-tarball.mjs",
]);
if (results[0].exitCode === 0) {
	await run(
		"public API preflight",
		[
			process.execPath,
			"--test",
			"scripts/reachability/contract-preflight.test.mjs",
		],
		undefined,
		{ GOZAR_COVERAGE_MATRIX: `${output}.preflight.json` },
	);
	await run("owner HTTP matrix", [
		"scripts/test-sandbox/test-sandbox",
		"--isolate",
		"cgroup",
		"--",
		process.execPath,
		"--import",
		"tsx",
		"--test",
		"--test-force-exit",
		"scripts/reachability/release-journey.test.mjs",
	]);
	await run("controller and secret boundaries", [
		"scripts/test-sandbox/test-sandbox",
		"--isolate",
		"cgroup",
		"--",
		process.execPath,
		"--import",
		"tsx",
		"--test",
		"--test-force-exit",
		"scripts/reachability/draft-boundary.test.mjs",
		"scripts/reachability/recovery.test.mjs",
		"scripts/reachability/runtime-consent.test.mjs",
		"scripts/reachability/initial-proof.test.mjs",
		"scripts/reachability/host-route-history.test.mjs",
		"scripts/reachability/install-boundary.test.mjs",
		"scripts/reachability/sdk-refusal.test.mjs",
	]);
	for (const [flag, spec] of [
		["--reachability", "reachability.spec.ts"],
		["--reachability-stream", "reachability-stream.spec.ts"],
	]) {
		await run(
			spec,
			[process.execPath, "e2e/harness.mjs", flag, spec],
			10_000_000_000,
			{ TEST_SANDBOX_ACTIVE: "" },
		);
	}
	await run("source and built bundle independence", [
		process.execPath,
		"--import",
		"tsx",
		"--test",
		"scripts/reachability/provider-independence.test.mjs",
	]);
}
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(
	`${output}.steps.json`,
	`${JSON.stringify(results, null, 2)}\n`,
);
if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;

```
