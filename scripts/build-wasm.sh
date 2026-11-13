#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export CARGO_BUILD_JOBS=2
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$PWD/target}"
# Keep local source and dependency paths out of the distributed WASM.
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--remap-path-prefix=$HOME=/build --remap-path-prefix=$PWD=."
wasm_bindgen_cli="${WASM_BINDGEN:-$(command -v wasm-bindgen || true)}"
if [[ -z "$wasm_bindgen_cli" ]]; then
  wasm_bindgen_cli="$HOME/.cache/gozar/wasm-bindgen/0.2.105/wasm-bindgen"
fi
if [[ ! -x "$wasm_bindgen_cli" ]]; then
  echo "wasm-bindgen 0.2.105 required; install it or set WASM_BINDGEN to its executable" >&2
  exit 1
fi
if [[ "$("$wasm_bindgen_cli" --version)" != "wasm-bindgen 0.2.105" ]]; then
  echo "wasm-bindgen CLI must match pinned crate version 0.2.105" >&2
  exit 1
fi
# ionice is Linux-only (util-linux); macOS has no such command.
ionice=()
if command -v ionice >/dev/null 2>&1; then ionice=(ionice -c 3); fi
nice -n 19 ${ionice[@]+"${ionice[@]}"} cargo build -p gozar-core --lib --release --target wasm32-unknown-unknown
nice -n 19 ${ionice[@]+"${ionice[@]}"} "$wasm_bindgen_cli" "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/gozar_core.wasm" --target nodejs --out-dir packages/gozar-core/generated

# wasm-bindgen's Node target is CommonJS even when the workspace uses ESM.
printf '{"type":"commonjs"}\n' > packages/gozar-core/generated/package.json
