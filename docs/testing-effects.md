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
| process-runtime / detect | `{program}` | `{available:boolean}` |
| process-runtime / open | `{program,args,credential,origin,target,deadlineMs}` | `{handle}` |
| process-runtime / read | `{handle}` | `{present:boolean}` |
| process-runtime / close | `{handle}` | `{closed:boolean}`; read separately confirms absence |
| local-api / request | `{path,method,headers,body}` | `{status,headers,body:string}`; conditional writes retain real ETag checks |
| recipe / probe | `{recipe}` | `{stdout,stderr,exitCode}`; Gozar runs the declared parser, never a supplied success flag |

`data` and `bytes` encode bytes as base64. Fetch chunks preserve timing so nonce
and streaming checks still execute. Exchange returns bytes from the actual owned
local proof listener through the fixture's mapping; echoing input alone fails
the independent local witness. A TLS certificate is PEM and must match the
ephemeral proof certificate. Fixture evidence establishes only isolated fixture
transport, never real account entitlement or public-provider acceptance.

Operational sessions declare `spawn/run`, `spawn/read`, `spawn/close` and
`network/fetch`. `run` receives `{program,args,longRunning}` and returns bounded
`{stdout,stderr,exitCode}`. A long-running result has `exitCode:null` plus an opaque
`handle` and the PID of a harmless fixture child the backend actually started.
The normal session ledger checks that PID's birth identity and stops only that
process. `read({handle})` returns `{present,exitCode?}`; `close({handle,signal})`
requests cancellation. Source output still passes through the shipped parser.
No fixture executable replaces a vendor program on PATH. The fixture proof reads
the current owned gate challenge through `network/fetch`; fixture observations do
not establish reachability through a real provider.
