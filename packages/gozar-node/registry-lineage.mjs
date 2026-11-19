// Storage identity versus code identity. A configuration is stored under a stable custodian name, never under a
// content hash that changes with every release. The content registry id still goes into every consent scope,
// so changed code is still re-approved. Prior art: Keychain service/account and VS Code extension id name the
// data; signer or publisher identity authorizes the caller (divan credential-storage entry, commit 3661b2b).

import { readFileSync } from 'node:fs';

export const BUNDLED_LINEAGE_ID = 'gozar-bundled';

// Registry ids of every published release of the bundled registry whose state this package carries forward.
// Each was recomputed with registryIdentity() from the npm tarball and matches the published integrity:
//   0.4.0 sha512-OeRD1D4I...   0.5.0 sha512-Ia4F/HVi...   0.5.1 sha512-T9gYzZIe...
// The set is closed. A later release needs no entry because it keeps the stable custodian name.
export const PUBLISHED_REGISTRY_IDS = Object.freeze([
  'registry-v1:1abf43a22c7f2a249a649e263f92881a41b1ddb6efb0746dc665f2859ffe096f',
  'registry-v1:009cf0b7d0ee2fe6e21698457150dfecd23235daed30f74b51aca03969e34e7e',
  'registry-v1:95e8ffed8f49f082f266ad801eed598af066c3959e3d11909a4dcbd5d73c2a51',
]);

// Every input id that those releases persisted, with its role. Provider data lives with the adapters, not in core.
// The bundled providers use each id with one role, so a saved binding or value is compatible only when its id is
// listed there with the matching role.
export const BUNDLED_INPUT_KINDS = Object.freeze(Object.fromEntries(Object.entries(
  JSON.parse(readFileSync(new URL('../../adapters/published-input-kinds.json', import.meta.url), 'utf8'))).filter(([id]) => !id.startsWith('$'))));

const bundled = Object.freeze({ id: BUNDLED_LINEAGE_ID, replaces: PUBLISHED_REGISTRY_IDS, inputKinds: BUNDLED_INPUT_KINDS });
export const bundledLineage = () => bundled;
export const isBundledLineage = lineage => lineage === bundled;
