# npm trusted publishing: next-release preparation

This workflow prepares repository qualification and npm authentication, not a declaration
that the next release is accepted. No release version is changed by this patch.

## One-time owner setup

After the trusted-publishing PR is reviewed and merged, verify the repository's
GitHub Actions environment is named exactly `npm-publish` and retains the owner's
intended protection rules. Only the explicit `publish` job uses this environment. The `qualify` job has
`contents: read`, no `id-token: write`, and does not use the trusted environment. Do not remove
or bypass those rules to make the workflow run.

In the existing public `@tnunamak/gozar` package's npm trusted-publisher settings,
configure the GitHub Actions publisher with owner/user `tnunamak`, repository
`gozar`, workflow filename `npm-publish.yml` (not the repository path), and
environment `npm-publish`. Allow direct publishing for this configuration. Initial
npm setup may require 2FA. Enrollment is an owner action; the workflow does not
create the npm trust relationship or change tokens or protection rules.
Do not revoke existing credentials as part of this setup.

[Primary npm trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/)
covers GitHub-hosted runners, OIDC, supported npm/Node versions and automatic provenance.
npm documentation has conflicting configuration-count guidance across pages;
this design needs exactly one configuration and makes no multi-config assumption.
The existing public personal-scope package does not require migration to an organization.
Live OIDC exchange remains unverified. A publish=false run cannot verify it.

## Operation

Commit a new release version on main before publication. An existing registry version
is refused regardless of its version number. Dispatch on main only; publish defaults
to false. Qualification and publication run in separate Ubuntu-hosted jobs. The privileged
job needs successful qualification and runs only for `publish: true`; it alone has
`id-token: write` and uses `npm-publish`. It does not build, qualify, or run tests, and it
installs no npm: its only npm is the pinned tool carried by this run's qualification artifact.
Both jobs check out the same SHA and use `/tmp/gozar-release/evidence` so receipts
retain their original absolute paths. Publication downloads the immutable artifact
from the same run attempt at that exact path. A different checkout root or layout
fails closed; no receipt paths or hashes are rewritten. The event SHA and workflow SHA must
match the checked-out clean source. There is no arbitrary ref input, token fallback,
npm whoami gate, tag/PR/push publication trigger, or account mutation.

Online setup in the unprivileged job installs concrete tool versions, populates Cargo's
dependency cache, and fetches the publisher npm 11.15.0 tarball from
`registry.npmjs.org`; the download is verified against the committed sha512 integrity
pin (public npm dist metadata) before it is staged for qualification.
The qualification phase builds fresh WASM in a new target directory, recursively
discovers sorted Node/adapters tests, runs them serially with TAP, and runs the
locked offline Cargo workspace tests serially. Missing/empty/failed/skipped/cancelled
results refuse qualification; do not change assertions or convert skips into passes.
A private short disk-backed HOME/TMPDIR avoids socket-path and host-home dependence.

The authorized job performs no online global npm install and no dependency bootstrap.
Its checked-out code re-verifies the carried tool bytes against the same committed pin
before any extraction or execution, extracts the self-contained package into a fresh
private directory, exposes `bin/npm-cli.js` only through a private PATH symlink, and
checks the tool's reported version before writing the attempt marker. Qualification
copies the already-verified tool bytes into the same-run evidence under the nonhidden
`publisher-tool/npm.tgz` directory, never inside `artifact/`, which keeps exactly one
Gozar tgz. A byte-level pin is not a review of npm's own code: the pin trusts the
official npm tarball's registry-published bytes, the same trust any global install
would need, without letting that bootstrap execute under publication authority.

prepareReleaseHandoff performs the single ordinary npm pack, including prepack.
runInstalledJourney installs those exact archive bytes offline and measures the
SDK screen/lifecycle fixture. Its measured report is translated to the existing
consumer schema and finalizeReleaseHandoff qualifies that archive. Package name,
version and repository are cross-checked against archived package.json.
No laptop-built artifact is uploaded for npm provenance.

Publication revalidates the original prepared snapshot, qualified manifest, gate,
raw installed report, translated consumer receipt and tarball. Only a genuine
registry HTTP 404 permits the attempt. Existing versions, redirects, auth errors,
network failures and unknown responses stop. The command publishes the checked
tarball with public access and scripts disabled, never repacking. OIDC is required;
npm credential/config environment overrides and repository .npmrc are refused.
The tool verification is an ordering and authentication change, not step isolation:
OIDC remains job-wide, the hosted runner's tar and Node still mediate extraction,
and the trusted runner and checked-out code remain the trust boundary, not hostile
concurrent local writers. Receipts are evidence, not independent cryptographic
attestations.

An attempt marker is recorded before npm publish. After success, registry integrity
is polled for approximately three minutes (individual HTTP calls have ten-second
bounds). Wrong visible integrity fails immediately; delayed absence eventually
fails. There is no second publish within one evidence directory. Each hosted run
uses a new directory, so the marker is not a cross-run lock. On ambiguous command
failure or visibility timeout, stop and inspect npm and retained evidence before
any new manual run; do not blindly retry. The workflow retains qualified archive/evidence and separately retains qualification
failure and publication evidence. A failed-only rerun without a newly produced
qualification artifact for that run attempt fails closed. Inspect npm and prior
publication evidence before authorizing any fresh run.

## Acceptance still owed by the release owner

The installed consumer here is the repository SDK screen/lifecycle fixture ONLY.
It is not DataConnect, Faravan or Dalan suite acceptance, a live account/provider
check, cellular testing, or full release acceptance. Those independent obligations
remain with the release owner; there are no fabricated three-app receipts.
No real publish, dry-run publish, workflow dispatch or OIDC exchange was performed
while authoring this patch.

Local verification runs the release orchestration tests with fake process and registry
responses, plus both existing release test files. They exercise artifact tampering,
failed qualification, duplicate publication attempts, and delayed registry visibility.
The tests also cover OIDC permission placement, restored artifact paths, the committed
publisher tool pin, missing or tampered tool bytes refused before extraction or tool
execution, extraction through the private bin, and a workflow regression forbidding any
`npm install` in the authorized job. The current split-job change has not yet been
exercised on a hosted runner. The real pinned tarball was additionally verified against
public registry metadata and executed (`--version` only, credential-free) during this
preparation; that control does not measure a hosted run.

```sh
node --test --test-concurrency=1 test/node/trusted-release.test.mjs test/node/release-handoff.test.mjs test/node/release-installed-journey.test.mjs
actionlint .github/workflows/npm-publish.yml
```

The hosted tool installation, complete source gate, and live OIDC exchange are not
yet measured for this workflow. For the first hosted qualification, the release
owner selects **npm trusted release** in GitHub Actions, selects `main`, and leaves
`publish` false. Confirm the `publish` job is skipped. Inspect
`gozar-qualified-<sha>-<run_attempt>` for the qualified
archive and receipts tied to that SHA; a missing publication result is expected.
No OIDC exchange is verified by this run. A later separately authorized publish
run qualifies its own archive in the unprivileged job; its privileged job consumes
only that run attempt's immutable qualification artifact. It does not reuse the
earlier run's provenance or bytes. The release owner must review that distinction when accepting
consumer evidence.

## Pinned tool and action sources

Pins are concrete releases, not claims that this authoring run exercised them:
[Node 22.16.0](https://nodejs.org/en/blog/release/v22.16.0),
[npm 11.15.0](https://github.com/npm/cli/releases/tag/v11.15.0),
[Rust 1.90.0](https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/).
The publisher npm pin includes its registry tarball URL and sha512 integrity
(`dist.integrity` from [public metadata](https://registry.npmjs.org/npm/11.15.0)),
committed in `scripts/trusted-release.mjs`; npm's engines range
`^20.17.0 || >=22.9.0` accepts the workflow's Node 22.16.0. Review and update the
version and integrity pin together, rechecking public metadata, never one alone.
wasm-bindgen CLI 0.2.105 matches the existing crate/build script requirement.
Action full SHAs resolve to official release commits:
[checkout v4.2.2](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683),
[setup-node v4.4.0](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020),
[upload-artifact v4.6.2](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02),
[download-artifact v4.3.0](https://github.com/actions/download-artifact/commit/d3f86a106a0bac45b974a628896c90dbdf5c8093).
Review/update these pins explicitly as part of maintenance, not via floating tags.
