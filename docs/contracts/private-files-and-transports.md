# Private files and typed transports

These hooks accept trusted host authority. They do not enable a provider adapter or prove a client can reach its endpoint.

A private binding declares its format, public template, credential binding names and exact scope requirements in one place:

```json
{
  "configFile": {
    "type": "session-private-path",
    "materialize": {
      "format": "json",
      "template": {
        "credential": { "kind": "credential-ref", "binding": "credential" },
        "hostname": "{hostname}"
      },
      "credentialRefs": ["credential"],
      "requires": [
        {
          "op": "verified",
          "fact": "credential-scope",
          "value": {
            "credentialRef": "{credential}",
            "hostname": "{hostname}",
            "tunnel": "{tunnel}"
          }
        }
      ]
    }
  },
  "credential": { "type": "credential-reference" },
  "hostname": { "type": "dns-name" },
  "tunnel": { "type": "opaque-private-reference" }
}
```

The trusted host supplies `credential` with an opaque `handleRef`. It supplies the exact `credential-scope` fact and the selected hostname and tunnel bindings. New credential, materialization and transport authority carries `sessionId`, `generation`, `authorityRef`, `observedAtMs` and `expiresAtMs`. A credential binding has no `value` or filesystem path.

The resolver receives the opaque credential handle. Credential bytes stay inside private file materialization. The returned file binding contains the file handle, modes `0600` and `0700`, scoped authority and `materialization.credentialRefs`, which maps credential binding names to opaque handles. The core and host check those references and exact facts before persistence and child dispatch. Private paths are resolved at dispatch. Materialized child output is suppressed; it cannot serve as endpoint evidence.

The private file record binds its adapter, binding, generation and a hash of the expanded public declaration. That record becomes durable before credential bytes are written. A dispatch marker is committed before spawn and cleared after the owned process record is durable; an unknown outcome retains the artifact. Cleanup checks the original file inode, modes and session, and waits until every recorded process that uses the artifact is confirmed gone. Uncertain cleanup keeps the record and file.

A `transport-endpoint` binding has this value shape:

```json
{
  "scheme": "https",
  "hostname": "selected.example",
  "port": 443,
  "endpointName": "selected-endpoint"
}
```

Schemes `https`, `tls` and `tcp` remain distinct. A `transport-mapping` prerequisite binds an exact endpoint, upstream and policy reference to a fresh host fact:

```json
{
  "op": "transport-mapping",
  "fact": "selected-mapping",
  "endpoint": "{endpoint}",
  "upstream": { "scheme": "http", "hostname": "127.0.0.1", "port": 8123 },
  "policyRef": "policy:selected",
  "origin": "https://selected.example"
}
```

The fact's `value` contains exactly `endpoint`, `upstream`, `policyRef` and the optional `origin`. An origin is valid only for the exact HTTPS endpoint. TLS and TCP endpoints have no HTTP origin. Mapping authority does not replace TLS, instance or protocol checks for publication.

Creation authority can expire after allocation. Stopping an owned process uses its original ledger bindings and a fresh birth-identity check; it does not require renewed creation credentials. Explicit provider identity and absence readbacks still apply.

An older controller can hand a stopped session to the current runtime. The CLI authenticates its stop channel, checks the durable stop fence and exact controller birth identity, requests graceful exit, then reconciles the journal. For an endpoint declared `endpointLifetime:"owned-process"`, a fresh absence check proves that ephemeral allocation is gone. Legacy recovery accepts this declaration only when installed and saved recipes, binding specs and admission match exactly. It grants no authority over persistent mappings, DNS or reservations.
