# ngrok raw stream adapters

`ngrok-tcp-passthrough` and `ngrok-tls-passthrough` support attached routes. They use the optional `@ngrok/ngrok` SDK and Gozar-stored credentials. Use Gozar CLI setup to provide the token; TLS also requires a reserved domain. Account entitlement, billing and quota remain unknown until the provider accepts the request. No live account check was used to develop these adapters.

Request `transport: 'tcp'` or `transport: 'tls'` through the ordinary route API. Origins have explicit ports: `tcp://host:port` or `tls://host:443`. These are raw stream addresses, not HTTP URLs. The adapters do not claim SSE, Streamable HTTP or OAuth discovery support. TCP payload confidentiality stays unknown; plaintext TCP can be visible to the relay.

## Initial transport proof

The adapter creates one local forwarding gate. The SDK tunnel always points to that gate. During the initial unpublished proof, new connections reach a short-lived echo listener behind the gate. The verifier connects through the SDK's returned public endpoint and sends one bounded frame: `GOZAR-PROOF/1 NONCE\n`, followed by write EOF. It requires exact response bytes, EOF, and a separate local witness that the owned echo listener received the same attempt's frame. An unrelated echo server cannot pass by reflecting the nonce.

Before proof returns success, the gate stops directing new connections to the echo listener, closes the echo listener, and forwards raw bytes to the original configured target. The public tunnel and its forwarding target do not change. Existing streams remain connected. This proves the tunnel transport reaches the owned gate. It does not prove application readiness, authorization or application identity.

The TLS proof runs the same exchange over TLS. OpenSSL generates an ephemeral self-signed proof certificate in a private temporary directory; Gozar deletes the files after loading them. The public probe pins this certificate's fingerprint. It does not use CA or hostname trust for this synthetic certificate. Output facts identify the **synthetic proof certificate** subject and issuer, and report `identityTrusted: false` for application identity. No application private key or proof private key is sent to ngrok. SDK options omit edge termination keys, certificates, traffic policy and PROXY protocol. Subsequent application TLS streams remain opaque bytes through the gate.

## Status and cleanup

The session has no automatic refresh method. Status retains the original proof observation and time. It never installs the echo service on a published route or labels an old proof as fresh. Close and reopen the route to obtain a new transport proof.

Cancellation closes the gate and all owned sockets. SDK startup has a deadline; a listener returned after cancellation is closed. Removal closes the gate and the specific owned SDK listener. Repeated removal is safe. A failed SDK close reports cleanup debt; no application server or foreign listener is stopped.

## Offline evidence

Run the dedicated tests:

```sh
nice -n 19 node --test test/adapters/ngrok-protocol-proof.test.mjs test/adapters/ngrok-protocol-runtime.test.mjs
```

The tests use an injected SDK, real local TCP/TLS servers and a synthetic certificate fixture. They check the owned-listener witness, wrong endpoint/attempt/target, wrong echo, cancellation and late SDK completion, pinned proof certificate facts, removal and ordinary traffic after proof. The first red run failed because the strategy module did not exist. The next run caught a half-close bug that dropped an application reply; the gate now preserves the client's write EOF while receiving the response. The TLS red run identified Node's rejection of IP addresses as SNI; local IP fixtures now omit SNI, while domain probes preserve the routed SNI.

These tests establish local behavior. They do not establish ngrok account permission, public DNS, provider acceptance of passthrough options, provider cleanup under network failure, or a real application's TLS identity.

Recorded commands: the two dedicated files passed 16 tests. The earlier command that also included `test/adapters/ngrok-runtime.test.mjs` and `test/adapters/ngrok-attached-validation.test.mjs` passed 31 tests before four additional dedicated tests were added. The full project suite is left to the integration gate.

SDK option names were checked against the [ngrok JavaScript 1.7.0 declarations](https://github.com/ngrok/ngrok-javascript/blob/v1.7.0/index.d.ts): `proto`, `domain`, `remote_addr`, and `addr`. Its `crt` and `key` options configure edge termination; this implementation supplies neither. This is source inspection, not evidence of provider acceptance.
