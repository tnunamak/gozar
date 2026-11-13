# Third-party notices

The distributed WASM and generated glue include Rust dependencies. Actual license
and notice texts from the locked source packages are included below. Both texts
are retained for dual-licensed packages; additional Unicode notices are retained.
Build dependencies are included conservatively.

| Package | Declared license | Included texts |
| --- | --- | --- |
| aho-corasick 1.1.5 | Unlicense OR MIT | [COPYING](third-party/rust/aho-corasick-1.1.5/COPYING), [LICENSE-MIT](third-party/rust/aho-corasick-1.1.5/LICENSE-MIT), [UNLICENSE](third-party/rust/aho-corasick-1.1.5/UNLICENSE) |
| bumpalo 3.20.3 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/bumpalo-3.20.3/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/bumpalo-3.20.3/LICENSE-MIT) |
| cfg-if 1.0.5 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/cfg-if-1.0.5/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/cfg-if-1.0.5/LICENSE-MIT) |
| itoa 1.0.19 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/itoa-1.0.19/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/itoa-1.0.19/LICENSE-MIT) |
| memchr 2.8.3 | Unlicense OR MIT | [COPYING](third-party/rust/memchr-2.8.3/COPYING), [LICENSE-MIT](third-party/rust/memchr-2.8.3/LICENSE-MIT), [UNLICENSE](third-party/rust/memchr-2.8.3/UNLICENSE) |
| once_cell 1.21.4 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/once_cell-1.21.4/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/once_cell-1.21.4/LICENSE-MIT) |
| proc-macro2 1.0.107 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/proc-macro2-1.0.107/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/proc-macro2-1.0.107/LICENSE-MIT) |
| quote 1.0.47 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/quote-1.0.47/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/quote-1.0.47/LICENSE-MIT) |
| regex 1.13.1 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/regex-1.13.1/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/regex-1.13.1/LICENSE-MIT) |
| regex-automata 0.4.18 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/regex-automata-0.4.18/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/regex-automata-0.4.18/LICENSE-MIT) |
| regex-syntax 0.8.11 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/regex-syntax-0.8.11/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/regex-syntax-0.8.11/LICENSE-MIT) |
| rustversion 1.0.23 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/rustversion-1.0.23/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/rustversion-1.0.23/LICENSE-MIT) |
| serde 1.0.229 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/serde-1.0.229/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/serde-1.0.229/LICENSE-MIT) |
| serde_core 1.0.229 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/serde_core-1.0.229/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/serde_core-1.0.229/LICENSE-MIT) |
| serde_derive 1.0.229 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/serde_derive-1.0.229/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/serde_derive-1.0.229/LICENSE-MIT) |
| serde_json 1.0.154 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/serde_json-1.0.154/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/serde_json-1.0.154/LICENSE-MIT) |
| syn 2.0.119 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/syn-2.0.119/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/syn-2.0.119/LICENSE-MIT) |
| syn 3.0.10 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/syn-3.0.10/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/syn-3.0.10/LICENSE-MIT) |
| unicode-ident 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | [LICENSE-APACHE](third-party/rust/unicode-ident-1.0.27/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/unicode-ident-1.0.27/LICENSE-MIT), [LICENSE-UNICODE](third-party/rust/unicode-ident-1.0.27/LICENSE-UNICODE) |
| wasm-bindgen 0.2.105 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/wasm-bindgen-0.2.105/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/wasm-bindgen-0.2.105/LICENSE-MIT) |
| wasm-bindgen-macro 0.2.105 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/wasm-bindgen-macro-0.2.105/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/wasm-bindgen-macro-0.2.105/LICENSE-MIT) |
| wasm-bindgen-macro-support 0.2.105 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/wasm-bindgen-macro-support-0.2.105/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/wasm-bindgen-macro-support-0.2.105/LICENSE-MIT) |
| wasm-bindgen-shared 0.2.105 | MIT OR Apache-2.0 | [LICENSE-APACHE](third-party/rust/wasm-bindgen-shared-0.2.105/LICENSE-APACHE), [LICENSE-MIT](third-party/rust/wasm-bindgen-shared-0.2.105/LICENSE-MIT) |
| zmij 1.0.23 | MIT | [LICENSE-MIT](third-party/rust/zmij-1.0.23/LICENSE-MIT) |

The optional native SDK is an external peer and is not bundled in this archive.
Its separate distribution and license evidence are recorded in
[the release audit](docs/release-0.4-license-audit.md).

Regenerate with `node scripts/collect-third-party-notices.mjs`. The manifest records
the Cargo.lock digest and SHA-256 of every copied file.
