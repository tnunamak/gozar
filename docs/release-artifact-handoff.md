# Qualified archive handoff

This tool prepares an artifact, not a release. It never publishes, tags, merges,
handles credentials/passkeys, or runs a second Node/Rust gate. No provider is
qualified by these fixture journeys. In particular ngrok rows remain detect-only.

## Host workflow

1. Start from the explicit clean source commit that passed the host's full offline
   Node/Rust gate. Record the gate's actual result in the schema below.
2. Prepare into a **new directory outside the source checkout**, whose parent
   already exists:
   `node scripts/prepare-release-handoff.mjs prepare --root /checkout --source-sha SHA --gate-receipt /evidence/gate.json --output-directory /evidence/new-artifact`
3. Run the genuine installed-archive consumer against the exact tarball and SHA256
   in manifest.json. Preserve actual output and cleanup debt. An injected test
   runner, source-checkout examples, mocked examples, or an unknown outcome is not
   consumer PASS. Check optional peer dependencies as well as optional dependencies:
   package.json declares @ngrok/ngrok as an optional **peer**. Merely using
   --omit=optional or scanning only optionalDependencies is not absence proof.
4. Only after real consumer PASS, finalize:
   `node scripts/prepare-release-handoff.mjs finalize --manifest /evidence/new-artifact/manifest.json --consumer-receipt /evidence/consumer.json`
5. Give Tim the single publishCommand emitted by finalization. It targets only the
   exact verified tarball, with --ignore-scripts on **publication**, so publication
   cannot rebuild it. Tim performs publication/authentication. The preparation
   step uses ordinary npm pack with --ignore-scripts=false: its prepack is mandatory.

Preparation checks git HEAD and a fully clean tracked/untracked working tree both
before and after pack. It parses single-object, array, or singleton-map npm JSON,
reads the actual archive bytes, checks gzip/tar framing/checksums and safe regular
members, and records per-member hashes. It rejects nonregular archive members and
unsupported tar extensions rather than guessing. Output contains the source,
gate receipt digest, archive digest, inventory, subprocess results and limits.
Unknown/nonzero gate, failed prepack, dirty source or malformed output cannot
produce a prepared result. Preparation always leaves publishCommand null.

Finalization rereads and hashes the archive and gate receipt. A different source
or artifact consumer identity refuses. Qualified-artifact is not blanket product
PASS; detect-only providers remain detect-only. A missing/failed consumer remains
explicitly unresolved. Exact nonzero process result and output survive in the
failure manifest.

## Receipt integration contract (strict version 1)

The submitting host must emit these from actual executions. This script does not
synthesize successful receipts from console prose or authenticate a signer.
Receipt files and the source tree are trusted local inputs; hashes bind their
bytes, not the truth of an assertion. A producer adapter must be reviewed before
use; schemas of existing external producers were not available in the scoped
source. Do not relabel a mock run as real, or hand-edit failures to passed.

Gate JSON:
- schemaVersion: 1; kind: gozar-offline-host-gate
- sourceSha: exact lowercase 40-hex commit; status: passed
- node and rust: each has exitCode: 0, failed: 0, and passed: positive integer
- Extra fields may retain host commands, log locations and timestamps.

Consumer JSON:
- schemaVersion: 1; kind: gozar-installed-consumer
- status: passed; execution: real-installed-archive
- sourceSha and sha256: exact prepared commit and actual tarball digest
- unresolvedFailures: empty array
- absentOptionalPackages: includes @ngrok/ngrok, backed by installed-tree evidence
- journeys.screen and journeys.lifecycle: each has exitCode: 0 and installedBytes: true
- archiveMembersMatch, proofVerified, cleanupConfirmed, foreignAppPreserved: true
- Preserve actual consumer output/log references in additional fields.

The consumer must run the shipped screen --fakes and the unknown-provider
non-HTTP lifecycle fixture from installed bytes, with verified proof, independent
owned-resource cleanup evidence and foreign-application preservation. Neither a
generic status: passed nor the runner's unit tests meet this schema.

## Validation responsibilities

The new tests exercise subprocess injection, both npm JSON shapes, gate/dirty
source refusal, exact prepack failure, actual compressed archive hashing,
changed-archive refusal and unknown consumer refusal. They do **not** manufacture
successful examples or certify a consumer journey. Host validation still owes
the full offline gate plus real packing and the actual installed artifact run.
