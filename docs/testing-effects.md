# Deterministic effects for trusted adapters

Import `createTestingGozar` from `@tnunamak/gozar/testing`. Call it with
`{...factoryOptions,effects:[{kind,operation,handle:async(input,context)=>result}]}`.
It returns `{gozar,events,close}`. Use the public `gozar` methods for the whole
setup, consent, execution, proof and cleanup journey. Await `close()` afterward.
Only this explicit factory installs handlers. Duplicate mappings reject; an
unmatched operation refuses without invoking a real fallback. Provider IDs are
opaque selection data and are absent from handler matching.

Handlers are trusted host code. Callbacks stay in the host process; the private
authenticated controller broker transports JSON requests/results. `events` has
only operation names, sequence, fixture marker and completion state. Inputs,
outputs, credentials and exception messages are excluded. Supply synthetic
credentials. A handler must retain its own independent resource ledger.

The versioned request/result unions ship in `testing-contract.d.ts`:

| kind / operation | input | result |
| --- | --- | --- |
| sdk-listener / detect | `{}` | `{available:boolean}` |
| sdk-listener / open | `{options:{addr,authtoken,domain?,proto?,remote_addr?}}` | `{handle,url}` |
| sdk-listener / read | `{handle}` | `{present:false}` or `{present:true,url}` |
| sdk-listener / close | `{handle}` | `{closed:boolean}`; read must separately confirm absence |
| network / fetch | `{url,method,headers}` | `{status,headers,chunks:[{data,delayMs}]}` |
| network / exchange | `{endpoint,transport,bytes,pinnedCertificate,deadlineMs}` | `{bytes,certificate?}` |

`data` and `bytes` encode bytes as base64. Fetch chunks preserve timing so nonce
and streaming checks still execute. Exchange returns bytes from the actual owned
local proof listener through the fixture's mapping; echoing input alone fails
the independent local witness. A TLS certificate is PEM and must match the
ephemeral proof certificate. Fixture evidence establishes only isolated fixture
transport, never real account entitlement or public-provider acceptance.
