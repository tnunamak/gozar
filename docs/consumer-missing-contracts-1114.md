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
