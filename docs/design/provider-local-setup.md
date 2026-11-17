# Setup for SSH trials, LAN and an owner-managed address

The adapter supplies the instructions and choices in its setup actions. Start and stop use Gozar’s route approval and route handle. The setup operation can describe a pending route from its scoped route view. The controller owns the process or listener, proof and cleanup records.

## localhost.run and tunnl.gg

When OpenSSH is missing, Gozar asks the administrator to approve the OS client package in the system’s software manager. Setup checks the installed client again. The tunnl.gg setup also checks for the installation key generator. This is an assisted dependency step. The OS package manager controls installation.

Route consent covers outbound TCP port 22 to the named relay, public trial exposure, first-use SSH host trust, and relay access to application payloads. OpenSSH uses an isolated, session-private known-hosts file. It accepts a first-seen key only inside the approved route and rejects a changed key against a saved entry. Stop if a known key changes and verify the claimed replacement with the provider. A new session creates a new private known-hosts file, so approving a reconnect includes first-use trust again.

localhost.run uses its anonymous mode. tunnl.gg uses its key-bound mode with Gozar’s installation key. Neither mode requires an account. Gozar validates the announced HTTPS origin with the provider’s recipe. Use the intended client network to check the actual application at that origin. A tunnl.gg browser warning may appear. Continuing past the warning does not complete Gozar’s independent challenge.

Stop withdraws publication and closes the exact owned SSH process. Gozar removes its private session files after confirmed exit. The installation key remains in the Gozar home for later approved connections. Local stop alone leaves remote hostname retirement and key revocation unverified.

## LAN

Choose an address from the current interface list and approve its HTTP listener scope. Gozar binds only that address and rechecks it before start. The listener forwards to Gozar’s loopback gate. If an administrator must adjust network access, allow TCP only to the selected address and the listener’s assigned port, from the intended LAN client or its subnet. Remove a rule created solely for the route when it ends. Existing shared rules remain under the administrator’s control.

Use another trusted device on the intended LAN to run the route challenge against the exact HTTP address. The local application challenge and independent LAN check are separate observations. If the interface disappears, choose a currently observed address and review its scope before starting again.

## Owner-managed HTTPS address

Provide the exact HTTPS origin. Set DNS to the owner-managed proxy, serve a client-trusted certificate for that HTTPS authority, and route any required inbound connection to that proxy. Forward the host’s requests to the exact upstream Gozar reports for the route. A Gozar-owned gate has its own loopback address and port. A host-owned verifier uses the owner’s approved upstream. Preserve the challenge path and stream responses when needed. Verify the real application from the intended network. Gozar’s check reports its actual vantage.

Gozar can withdraw its own publication, close a gate it owns, and remove its tracking record. The owner retains DNS, TLS keys and certificates, proxy mappings, router rules and existing credentials. The owner or administrator can remove a mapping created solely for this route through the corresponding infrastructure controls.
