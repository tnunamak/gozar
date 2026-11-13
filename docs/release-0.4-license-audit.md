# Gozar 0.4.0 license inventory

Audit date: 2026-11-13  
Audited source SHA: `4b233d1d2c8c608af34145ee3f24ea3d391e4c72`  
Lockfile SHA-256: `Cargo.lock` `9f157468ea6dce8129b5f4c03d98aa798ff04dc099f795c7e14bbd419bf749d4`; `package-lock.json` `587d80b6a5b2559bb0fc0fcefed3b0f07fc9b2a7005304a880bbb9bf28fb8d14`.

This is a factual inventory of declared license terms and inspected license evidence. It is not legal advice.

## Method and scope

For npm, the root manifest and lockfile were inspected. `package-lock.json` has no installed dependency entries; it records `@ngrok/ngrok@1.7.0` as an optional peer. The registry metadata for that exact version lists 13 optional platform packages, each at `1.7.0`. Metadata was retrieved with `npm view`; each package tarball was retrieved with `npm pack` and inspected. This includes packages for Android, Darwin, FreeBSD, Linux GNU and musl variants, and Windows, whether or not they match the audit host.

For Rust, `cargo metadata --locked --format-version=1 --all-features` and `cargo tree --locked -e normal,build` were used against `Cargo.lock`. This resolved the `gozar-core` dependency closure, including crates used to build the bundled WASM and its procedural macros. The registry source `Cargo.toml` license expressions and the corresponding cached crate license files were inspected. No Rust test-only dependencies appear in this lockfile.

The package manifest is `0.4.0`, while the root package entry in `package-lock.json` still says `0.3.4`. Its peer dependency information agrees with the manifest and the lockfile has no resolved npm dependency graph. The lockfile version mismatch was not changed because the requested slice excludes lockfile and version changes.

## Inventory

The 14 npm package entries have license expressions in npm package metadata. `@ngrok/ngrok` ships its `LICENSE-APACHE` and `LICENSE-MIT` files. The 13 platform packages ship native `.node` bindings and package metadata that declares `MIT`; their tarballs contain no separate license text file. That means their license evidence is the package metadata declaration, not an inspected copy of the MIT text.

| Ecosystem / package | Version | SPDX expression | Scope | Evidence |
| --- | --- | --- | --- | --- |
| npm `@ngrok/ngrok` | 1.7.0 | `(MIT OR Apache-2.0)` | Optional runtime peer | npm registry metadata; tarball contains `LICENSE-MIT` and `LICENSE-APACHE`; 13 optional platform packages listed in its metadata |
| npm `@ngrok/ngrok-android-arm64` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-darwin-arm64` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-darwin-universal` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-darwin-x64` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-freebsd-x64` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-linux-arm-gnueabihf` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-linux-arm64-gnu` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-linux-arm64-musl` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-linux-x64-gnu` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-linux-x64-musl` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-win32-arm64-msvc` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-win32-ia32-msvc` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| npm `@ngrok/ngrok-win32-x64-msvc` | 1.7.0 | `MIT` | Optional platform runtime | npm registry metadata and tarball `package.json`; `.node` binary present, no license text file |
| Cargo `aho-corasick` | 1.1.5 | `Unlicense OR MIT` | Runtime | Cargo metadata; crate `COPYING`, `LICENSE-MIT` |
| Cargo `bumpalo` | 3.20.3 | `MIT OR Apache-2.0` | Build-only, proc-macro support | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `cfg-if` | 1.0.5 | `MIT OR Apache-2.0` | Runtime | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `itoa` | 1.0.19 | `MIT OR Apache-2.0` | Runtime | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `memchr` | 2.8.3 | `Unlicense OR MIT` | Runtime | Cargo metadata; crate `COPYING`, `LICENSE-MIT` |
| Cargo `once_cell` | 1.21.4 | `MIT OR Apache-2.0` | Runtime | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `proc-macro2` | 1.0.107 | `MIT OR Apache-2.0` | Build-only, procedural macros | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `quote` | 1.0.47 | `MIT OR Apache-2.0` | Build-only, procedural macros | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `regex` | 1.13.1 | `MIT OR Apache-2.0` | Runtime | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `regex-automata` | 0.4.18 | `MIT OR Apache-2.0` | Runtime | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `regex-syntax` | 0.8.11 | `MIT OR Apache-2.0` | Runtime | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `rustversion` | 1.0.23 | `MIT OR Apache-2.0` | Build-only, build script | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `serde` | 1.0.229 | `MIT OR Apache-2.0` | Runtime | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `serde_core` | 1.0.229 | `MIT OR Apache-2.0` | Runtime | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `serde_derive` | 1.0.229 | `MIT OR Apache-2.0` | Build-only, derive macro | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `serde_json` | 1.0.154 | `MIT OR Apache-2.0` | Runtime | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `syn` | 2.0.119 | `MIT OR Apache-2.0` | Build-only, procedural macros | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `syn` | 3.0.10 | `MIT OR Apache-2.0` | Build-only, derive macro | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `unicode-ident` | 1.0.27 | `(MIT OR Apache-2.0) AND Unicode-3.0` | Build-only, procedural macros | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE`, `LICENSE-UNICODE` |
| Cargo `wasm-bindgen` | 0.2.105 | `MIT OR Apache-2.0` | Runtime | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `wasm-bindgen-macro` | 0.2.105 | `MIT OR Apache-2.0` | Build-only, procedural macro | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `wasm-bindgen-macro-support` | 0.2.105 | `MIT OR Apache-2.0` | Build-only, procedural macro support | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `wasm-bindgen-shared` | 0.2.105 | `MIT OR Apache-2.0` | Runtime and build-time shared crate | Cargo metadata; crate `LICENSE-MIT`, `LICENSE-APACHE` |
| Cargo `zmij` | 1.0.23 | `MIT` | Runtime | Cargo metadata; crate `LICENSE-MIT` |

## Result and gaps

Inventory count: 14 npm packages and 24 third-party Cargo crates (38 dependency entries total). All 38 have an unambiguous declared SPDX expression. No GPL, AGPL, LGPL, SSPL, BUSL, missing-license, or ambiguous-license expressions were found. The expressions are MIT, Apache-2.0, Unlicense, and Unicode-3.0; the `OR` choices and the additional `AND Unicode-3.0` condition are preserved above. The inspected crate license files and npm metadata support the declared permissive terms.

Evidence gaps: the 13 platform-native npm tarballs contain no license text, so their MIT terms rely on each exact version's registry/package metadata declaration. The npm lockfile has no resolved optional-peer closure and its root project version is stale (`0.3.4` versus manifest `0.4.0`); the optional closure was therefore checked from the live npm registry at the fixed `1.7.0` versions. No source build or binary provenance audit was performed for the native `.node` artifacts. `npm pack --dry-run --ignore-scripts` reported that `LICENSE` is included (112 files total). The plain `npm pack --dry-run` ran the existing `prepack` check and stopped because the ignored/generated file `packages/gozar-core/generated/package.json` is absent in this checkout. These are evidence limitations, not missing or ambiguous declared license expressions.

## PR-ready paragraph

Gozar 0.4.0 declares Apache-2.0 in its npm and Cargo package metadata and ships the standard Apache-2.0 license text in the npm package. The release dependency inventory covers 14 npm packages, including every optional ngrok platform binding, and all 24 third-party crates resolved by `Cargo.lock`, including the bundled WASM dependency graph. Every dependency has a declared permissive license expression; the report records the exact expressions, separates runtime from build-only crates, and documents the platform-package and lockfile evidence limits.


## Packaged notice closure (B1 integration)

The license lane was merged from `933db4e5e2ae167c0008689c516f89a158481641`.
B1 copied the actual license, Unicode and notice files from all 24 locked cached
Rust source packages into `third-party/rust/`, including build dependencies.
`third-party/manifest.json` records the Cargo.lock SHA-256 and each copied file's
SHA-256; `scripts/check-package.mjs` checks their bytes and archive inclusion in
ordinary prepack. `THIRD-PARTY-NOTICES.md` links each package to its actual texts.
The optional SDK/native peers are not bundled into Gozar's archive; their
metadata-only MIT caveat above remains. No native binary provenance claim is made.

The root lockfile version/license metadata now matches 0.4.0/Apache-2.0 without
changing dependency resolutions. The WASM build generator now emits Apache-2.0
in its generated package.json; ordinary prepack requires that declaration and
the root LICENSE. The final integration report records the exact verification head.
