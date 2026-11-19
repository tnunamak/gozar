# npm trusted publishing: next-release preparation

This workflow prepares repository qualification and npm authentication, not a declaration
that the next release is accepted. No release version is changed by this patch.

## One-time owner setup

After the trusted-publishing PR is reviewed and merged, verify the repository's
GitHub Actions environment is named exactly `npm-publish` and retains the owner's
intended protection rules. The workflow assigns that environment to the whole job,
so existing environment rules apply to qualification-only runs too. Do not remove
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
to false. Qualification and publication stay in one Ubuntu-hosted job to preserve
the existing helpers' absolute evidence paths. The event SHA and workflow SHA must
match the checked-out clean source. There is no arbitrary ref input, token fallback,
npm whoami gate, tag/PR/push publication trigger, or account mutation.

Online setup installs concrete tool versions and populates Cargo's dependency cache.
The qualification phase builds fresh WASM in a new target directory, recursively
discovers sorted Node/adapters tests, runs them serially with TAP, and runs the
locked offline Cargo workspace tests serially. Missing/empty/failed/skipped/cancelled
results refuse qualification; do not change assertions or convert skips into passes.
A private short disk-backed HOME/TMPDIR avoids socket-path and host-home dependence.

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
The trusted runner and checked-out code are the trust boundary, not hostile concurrent
local writers. Receipts are evidence, not independent cryptographic attestations.

An attempt marker is recorded before npm publish. After success, registry integrity
is polled for approximately three minutes (individual HTTP calls have ten-second
bounds). Wrong visible integrity fails immediately; delayed absence eventually
fails. There is no second publish within one evidence directory. Each hosted run
uses a new directory, so the marker is not a cross-run lock. On ambiguous command
failure or visibility timeout, stop and inspect npm and retained evidence before
any new manual run; do not blindly retry. The workflow retains archive/evidence
even for qualification-only runs and failures after setup.

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
The test-only baseline fails because the runner does not exist; the implementation
passes 72 tests with no skips. actionlint and Node syntax checks also pass.

```sh
node --test --test-concurrency=1 test/node/trusted-release.test.mjs test/node/release-handoff.test.mjs test/node/release-installed-journey.test.mjs
actionlint .github/workflows/npm-publish.yml
```

The hosted tool installation, complete source gate, and live OIDC exchange are not
yet measured for this workflow. For the first hosted qualification, the release
owner selects **npm trusted release** in GitHub Actions, selects `main`, and leaves
`publish` false. Inspect `gozar-release-<sha>-<run_attempt>` for the qualified
archive and receipts tied to that SHA; a missing publication result is expected.
No OIDC exchange is verified by this run. A later separately authorized publish
run rebuilds and qualifies its own archive; it does not reuse the earlier run's
provenance or bytes. The release owner must review that distinction when accepting
consumer evidence.

## Pinned tool and action sources

Pins are concrete releases, not claims that this authoring run exercised them:
[Node 22.16.0](https://nodejs.org/en/blog/release/v22.16.0),
[npm 11.15.0](https://github.com/npm/cli/releases/tag/v11.15.0),
[Rust 1.90.0](https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/).
wasm-bindgen CLI 0.2.105 matches the existing crate/build script requirement.
Action full SHAs resolve to official release commits:
[checkout v4.2.2](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683),
[setup-node v4.4.0](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020),
[upload-artifact v4.6.2](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02).
Review/update these pins explicitly as part of maintenance, not via floating tags.
