// Gozar consumer contract, version 1 (frozen in C0).
//
// Types only: this file declares the consumer boundary and implements nothing. The JSON Schemas in
// runtime/route-catalog.schema.json and the fixtures in test/fixtures/route-contract.json are the
// machine-checkable form of the same shapes; a change to one needs a versioned change to all three.
// Provider names, provider enums and adapter tuples never appear here: apps branch on these shapes
// and on GozarErrorCode only.

// --- Shapes -------------------------------------------------------------------------------------

export type Reach = 'internet' | 'tailnet' | 'lan' | 'this-device' | 'unknown';

export type Usage =
  | { kind: 'durable'; routeId: string }
  | { kind: 'session'; lifetimeMs: number }
  | { kind: 'attached' };

export type Requirements = {
  reach: Reach;
  transport: 'https';
  payloadAccess: 'endpoint-only' | 'allow-provider';
  address: 'stable' | 'any';
  /** 'none' means ready now; 'allow' permits a candidate that still needs a setup action. */
  setup: 'none' | 'allow';
  protocols: ('sse' | 'streamable-http' | 'oauth-dcr')[];
};

export type Query = {
  schemaVersion: 1;
  owner: string;
  target: string;
  usage: Usage;
  requirements: Requirements;
  home: string;
  /** Gozar-owned named policy; uninterpreted by apps. Unknown name: route_not_found. */
  route?: string;
  origin?: string;
  /** Default: 'create'. */
  intent?: 'create' | 'adopt';
  /** Opaque reference from inspectLegacyRoute. */
  migrationRef?: string;
};

export type Disclosure = {
  revision: string;
  text: string;
  links: { rel: 'terms' | 'privacy'; label: string; href: string }[];
};

export type Action = {
  id: string;
  kind: 'open-url' | 'instructions' | 'provide-secret' | 'gozar-runs';
  label: string;
  digest: string;
  disclosure: Disclosure;
  href?: string;
  instructions?: string;
  secretLabel?: string;
};

export type Properties = {
  reach: Reach;
  transport: 'http' | 'https';
  traffic: {
    tlsTermination: 'endpoint' | 'provider' | 'unknown';
    providerCanReadPayload: boolean | null;
    readers: string[];
    metadataVisibleTo: string[];
    evidenceRef: string | null;
  };
  address: { stability: 'stable' | 'ephemeral' | 'unknown'; scope: string; conditions: string[] };
  cost: { kind: 'free' | 'paid' | 'unknown'; summary: string; currency: string | null; amount: number | null; period: string | null };
  needsAccount: boolean | null;
  lifetimes: ('session' | 'attached' | 'durable')[];
  supervision: 'controller' | 'provider-persistent' | 'host-supervised';
  protocols: { sse: boolean; streamableHttp: boolean; oauthDcr: boolean };
};

export type Candidate = {
  /** Opaque to apps. */
  name: string;
  /** Opaque to apps; the only value usable in a preference list. */
  preferenceRef: string;
  rank: number;
  eligible: boolean;
  unmet: { requirement: string; actual: unknown; reasonCode: string }[];
  display: { label: string; description: string };
  properties: Properties;
  /**
   * On macOS every candidate has setup.state 'unsupported', eligible false and an unmet entry with
   * reasonCode 'unsupported' (revision 3).
   */
  setup: { state: 'ready' | 'action-required' | 'unsupported' | 'unknown'; actions: Action[] };
  disclosure: Disclosure;
  /** Never set for an ineligible candidate. Bearer data: hold transiently or in a 0600 file; never log. */
  candidateToken: string | null;
  expiresAt: string | null;
};

export type Catalog = {
  schemaVersion: 1;
  catalogRevision: string;
  observedAt: string;
  preferenceRevision: number;
  candidates: Candidate[];
  noMatch: null | { code: 'requirements_unsatisfied'; requirements: string[] };
};

export type Handle = { kind: 'session' | 'attached' | 'durable' | 'external'; id: string; generation: number };

export type Ingress = {
  generation: number;
  verifiedAt: string;
  validUntil: string;
  publicAuthority: string;
  authorityHandling: 'configured-origin';
  clientAddress:
    | { source: 'unavailable'; reason: string }
    | { source: 'socket' }
    | {
        source: 'trusted-header';
        evidenceRef: string;
        peer:
          | { kind: 'unix-socket'; path: string; ownerUid: number }
          | { kind: 'mtls'; spkiSha256: string }
          | { kind: 'network-boundary'; cidrs: string[]; boundaryRef: string };
        header: {
          name: string;
          format: 'rfc7239' | 'ip-list';
          sanitization: 'strip-inbound-and-write';
          selection: 'rightmost-untrusted';
          trustedHops: number;
          trustedProxyCidrs: string[];
        };
      };
};

export type RouteView = {
  schemaVersion: 1;
  handle: Handle;
  origin: string | null;
  published: string | null;
  state: 'creating' | 'usable' | 'unverified' | 'unknown' | 'lost' | 'address_changed' | 'uncertain' | 'releasing' | 'released' | 'handing-back';
  ownership: 'gozar-owned' | 'external-owned';
  properties: Properties;
  ingress: Ingress | null;
  verification: { status: 'verified' | 'unverified'; checkedAt: string | null };
  limits: { recommendedPollIntervalMs: number; idleTimeoutMs: number | null };
  cleanup: { state: 'none' | 'debt'; message?: string };
};

export type Approval = { candidateToken: string; disclosureRevision: string };

/** Frozen. Apps branch only on these codes; provider diagnostics stay inside Gozar. */
export type GozarErrorCode =
  | 'invalid_input' | 'requirements_unsatisfied' | 'setup_required' | 'consent_required' | 'consent_unknown'
  | 'consent_expired' | 'consent_mismatch' | 'candidate_stale' | 'preference_conflict' | 'route_not_found'
  | 'route_conflict' | 'address_changed' | 'stopped_by_user' | 'handing_back' | 'verification_failed'
  | 'provider_unavailable' | 'cleanup_debt' | 'unsupported' | 'ambiguous_route';

export type GozarError = { schemaVersion: 1; error: { code: GozarErrorCode; message: string; nextAction: Action | null } };

/** What JS callers catch: `.code` and `.nextAction` carry the same data as the CLI GozarError envelope. */
export interface GozarThrownError extends Error { code: GozarErrorCode; nextAction: Action | null }

// --- Results and records ------------------------------------------------------------------------

export type PreferenceRecord = {
  schemaVersion: 1;
  scope: 'user';
  revision: number;
  /** Opaque preferenceRef values. */
  adapterPreference: string[];
  onUnavailable: 'ask';
};

export type SetupActionResult = {
  schemaVersion: 1;
  state: 'complete' | 'pending' | 'blocked';
  nextAction: Action | null;
  catalogRevision: string;
};

export type WatchEvent = {
  schemaVersion: 1;
  sequence: number;
  type: 'snapshot' | 'changed' | 'terminal';
  route: RouteView;
};

export type InspectLegacyRouteResult = {
  schemaVersion: 1;
  migrationRef: string;
  origin: string | null;
  target: string;
  bridgeHome: string | null;
  state: 'adoptable' | 'external' | 'blocked';
  reasonCode: string | null;
};

export type ResolveClientAddressResult = {
  address: string | null;
  source: 'socket' | 'trusted-header' | 'unavailable';
  reason: string | null;
};

// --- Requests -----------------------------------------------------------------------------------

/** Paths are opaque input. Gozar recognises provider-owned formats only; anything else becomes a sign-in-again setup action. */
export type InspectLegacyRouteRequest = {
  home: string;
  owner: string;
  source: { stateFiles: string[] };
  origin?: string;
  target: string;
};

/**
 * Requires usage.kind 'durable'. Clearing a user-stop tombstone needs a fresh `approval`;
 * `reconsent: true` without `approval` fails with consent_required (revision 3).
 */
export type EnsureRouteRequest = Query & { usage: { kind: 'durable'; routeId: string }; approval?: Approval; reconsent?: boolean };

/** Durable only; no claim input. The old-owner fence is the caller's precondition. */
export type AdoptRouteRequest = Query & {
  usage: { kind: 'durable'; routeId: string };
  origin: string;
  approval: Approval;
  handover: { from: string; generation: number };
};

/** Session or attached usage only. */
export type ExposeRequest = Query & {
  usage: { kind: 'session'; lifetimeMs: number } | { kind: 'attached' };
  approval: Approval;
  wait: 'allocated' | 'verified';
};

export type RouteRef = { home: string; handle: Handle };
export type CloseRouteRequest = RouteRef & { mode: 'remove' };
export type WatchRoutesRequest = RouteRef & { signal: AbortSignal; intervalMs?: number };
export type SetRoutePreferencesRequest = {
  profileHome: string;
  expectedRevision: number;
  adapterPreference: string[];
  onUnavailable: 'ask';
};
export type RunSetupActionRequest = {
  home: string;
  actionId: string;
  approval: { digest: string; disclosureRevision: string };
  /** Points into Gozar's private store; never a token value. */
  secretHandle?: string;
};

/** Transport-derived facts only. The exact member types are not fixed by the plan; see Open contract questions. */
export type ClientAddressProof = {
  socketPeer: { address: string; port: number };
  peerIdentity:
    | { kind: 'unix-socket'; path: string; ownerUid: number }
    | { kind: 'mtls'; spkiSha256: string }
    | { kind: 'network-boundary'; address: string }
    | null;
  headers: Record<string, string | string[]>;
  now: number;
  routeGeneration: number;
};

// --- Root exports -------------------------------------------------------------------------------

export function catalogRoutes(query: Query): Promise<Catalog>;
/** Alias of catalogRoutes. */
export function detect(query: Query): Promise<Catalog>;
export function inspectLegacyRoute(request: InspectLegacyRouteRequest): Promise<InspectLegacyRouteResult>;
export function ensureRoute(request: EnsureRouteRequest): Promise<RouteView>;
export function adoptRoute(request: AdoptRouteRequest): Promise<RouteView>;
export function routeStatus(request: RouteRef): Promise<RouteView>;
export function closeRoute(request: CloseRouteRequest): Promise<RouteView>;
export function watchRoutes(request: WatchRoutesRequest): AsyncIterable<WatchEvent>;
export function getRoutePreferences(request: { profileHome: string }): Promise<PreferenceRecord>;
export function setRoutePreferences(request: SetRoutePreferencesRequest): Promise<PreferenceRecord>;
export function runSetupAction(request: RunSetupActionRequest): Promise<SetupActionResult>;
export function resolveClientAddress(proof: ClientAddressProof, ingress: Ingress): ResolveClientAddressResult;

/**
 * Legacy session options, kept through a version-discriminated overload: a call without
 * `schemaVersion: 1` is the legacy call. Keys mirror the legacy CLI flags in api.mjs.
 */
export type LegacyExposeOptions = {
  schemaVersion?: undefined;
  home?: string; port?: number; clientReach?: string; adapterId?: string; origin?: string; lifetimeMs?: number;
  bindAddress?: string; firewallAck?: boolean; transport?: string; clientProfileId?: string; probeWaitMs?: number;
  probeDirectory?: string; probeRequest?: string; probeReceipt?: string; probeExecutorId?: string;
  installLinkTemplate?: string; yes?: boolean; sse?: boolean; streamableHttp?: boolean; oauthDcr?: boolean; operational?: boolean;
};
export type LegacySessionReply = Record<string, unknown>;
export function expose(request: ExposeRequest): Promise<RouteView>;
export function expose(options: LegacyExposeOptions): Promise<LegacySessionReply>;
export function status(options?: LegacyExposeOptions): Promise<LegacySessionReply>;
export function stop(options?: LegacyExposeOptions): Promise<LegacySessionReply>;

// --- Kept service and hand-back exports (also at @tnunamak/gozar/service) ------------------------

export type ServiceRoute = Record<string, unknown>;
export function addService(request: { origin: string; target: string; home?: string; verifyCmd?: string | null }): Promise<{ schemaVersion: 1; route: ServiceRoute }>;
export function statusServices(request?: { home?: string; origin?: string }): Promise<{ schemaVersion: 1; routes: ServiceRoute[] }>;
export function removeService(request: { origin: string; home?: string }): Promise<{ schemaVersion: 1; origin: string; removed: boolean }>;
/** In-app proof handler; returns true when it answered the request. */
export function createServiceVerifier(): (req: unknown, res: unknown) => boolean;

export type ReleaseRouteResult = { schemaVersion: 1; routeId: string; removed: boolean; providerRemoved: boolean; cleanupDebt: unknown };
/** `claim` is opaque Gozar-owned rollback data, never an adopt input. */
export type HandBackResult = { schemaVersion: 1; routeId: string; claim: unknown; transfer: string };
export function releaseRoute(request: { routeId: string; mode: 'hand-back'; home?: string }): Promise<HandBackResult>;
export function releaseRoute(request: { routeId: string; mode?: 'remove' | 'dismiss'; home?: string }): Promise<ReleaseRouteResult>;
export function confirmHandBack(request: { routeId: string; transfer: string; home?: string }): Promise<{ schemaVersion: 1; routeId: string; handedBack: true; claim: unknown }>;
export function cancelHandBack(request: { routeId: string; transfer: string; home?: string }): Promise<{ schemaVersion: 1; route: ServiceRoute }>;
