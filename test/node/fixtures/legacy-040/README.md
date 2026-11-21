# Historical 0.4.0 writer fixture

Provenance of the old persisted state used by `test/node/stable-configuration.test.mjs`.

- Source: npm `@tnunamak/gozar@0.4.0`, tarball integrity
  `sha512-OeRD1D4IHQ/wyP+gI18Y/pquDLrrlYV2iUm9aetMQ/3sC7lvM67cPmdY0bPxgs7CAO+GpoHjCAdW3yWoarllEw==`
  (the file equals git tag `v0.4.0`).
- `embedding-services.040.mjs` is `packages/gozar-node/embedding-services.mjs` from that tarball, sha256
  `7cd626fd107a628110a713bc4b995831227ceef0f74946ca940e8c1920169c31`. Only the three relative import
  prefixes changed (`./x.mjs` to `../../../../packages/gozar-node/x.mjs`). The imported modules
  (service-state, journal, secret-store) are byte-identical between v0.4.0 and the candidate base. The test
  reverses the rewrite and checks the hash.
- 0.4.0 registry id (`registryIdentity()` over the tarball):
  `registry-v1:1abf43a22c7f2a249a649e263f92881a41b1ddb6efb0746dc665f2859ffe096f`.
- `golden-embedding-state.json` is the `embedding-state.json` that the unmodified tarball code wrote for a
  fresh private home `/home/tnunamak/.tmp/stable-052/fx-golden/home`, owner `pdpp-reference-server`, with
  synthetic values (own-address origin `https://fixture.invalid`; a cloudflare-named token secret). The test
  proves that its scope keys equal `sha256(JSON.stringify([registryId, home, owner, providerId]))`.
