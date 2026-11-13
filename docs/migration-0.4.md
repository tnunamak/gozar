# Migrating from 0.3 to 0.4

Keep schemaVersion: 1 in queries and requests. Catalog and RouteView responses
now return schemaVersion: 2, including route views nested in watch events. Other
response envelopes retain their existing version.

Update exhaustive switches: Candidate.setup.state now includes detect-only.
RouteView.cleanup.state replaces debt with unconfirmed and adds confirmed.
The cleanup_debt error code remains unchanged. RouteView.state and origin versus
published retain their meanings. Use routeState for the screen's proof/expiry
classification, and never advertise a published URL from an expired projection.

Use availability[usage.kind] to decide whether Gozar can execute a choice.
Detect-only candidates never receive candidate tokens, even when local software
is present. Setup readiness alone does not establish executable support.

Render prerequisites independently of route proof. Render configuration.fields
as inputs. Read configuration.values for plain saved values and credentials for
presence only. storeSecret({home,value}) returns {handle}; pass it as secretHandle
to the approved runSetupAction. The same approved actions edit and rotate saved
configuration while ready. Stop and obtain fresh consent before replacing a live
route; editing saved setup does not reconfigure an existing process.

Render facts generically by group. Groups and ids are open strings; a new row is
not a schema change. Show EVERY affectsConsent row before approval. Unknown facts
carry a reason; needs-provider-call means local detection cannot establish the
answer. Known false has known:true,value:false. Never treat unknown as false.
Keep computing with the small typed core: reach, traffic, address, cost kind,
availability, prerequisites and proof. Promote a display fact into the core only
when an app needs to branch, compare, sort or gate on it; this requires semver.

The legacy nullable traffic fields remain for compatibility. Null payload access
is unknown. Proof expiry and route expiry are separate observations. An unknown
expiry is not a promise of permanence. Checks run from the reported vantage;
this-device verification does not prove reachability from every remote client.

Run the shipped example with exactly one flag:

    node node_modules/@tnunamak/gozar/examples/remote-access-screen.mjs --fakes
    node node_modules/@tnunamak/gozar/examples/remote-access-screen.mjs --detect

The first mode uses fake data only. The second performs real read-only detection
and creates no route. Host passwords, restart policy and application port pins
remain the embedding app's responsibility.
