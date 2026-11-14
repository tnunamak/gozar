// Gozar consumer contract: query version 1, catalog and route response version 2.
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
  /** A requirement can never ask for 'unknown' reach; only Properties.reach may be unknown. */
  reach: Exclude<Reach, 'unknown'>;
  /**
   * 'https' (the default use) needs an encrypted route. 'any' also accepts plain HTTP and is valid only with reach
   * 'lan' or 'this-device'; with any other reach the query fails with invalid_input.
   */
  transport: 'https' | 'tcp' | 'tls' | 'any';
  payloadAccess: 'endpoint-only' | 'allow-provider';
  address: 'stable' | 'any';
  /** 'none' means ready now; 'allow' permits a candidate that still needs a setup action. */
  setup: 'none' | 'allow';
  protocols: ('sse' | 'streamable-http' | 'oauth-dcr')[];
};

export type Query = {
  operationId?:string;
  hostCapabilities?:import('./embedding-contract.js').HostCapabilities;
  schemaVersion: 1;
  owner: string;
  target: string;
  usage: Usage;
  requirements: Requirements;
  home: string;
  /** Gozar-owned named policy; uninterpreted by apps. Unknown name: route_not_found. */
  route?: string;
  origin?: string;
  /**
   * Selects exactly one adapter by the `providerId` its Candidate shows; the catalog then holds only that candidate.
   * An unknown id is route_not_found, and its message lists every id on offer. Not valid together with `route`.
   * Apps show, store and send the id back; they never compare it with a literal.
   */
  providerId?: string;
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
  kind: 'open-url' | 'instructions' | 'provide-secret' | 'provide-value' | 'gozar-runs'|'clear-input'|'install-artifact';
  inputId?:string;
  consent?:SetupConsentSnapshot;
  review?:{canonicalInput:unknown};
  label: string;
  digest: string;
  disclosure: Disclosure;
  href?: string;
  instructions?: string;
  secretLabel?: string;
  obtainUrl?: string;
  help?: string;
  /** For 'provide-value' only: a plain, non-secret input (a domain, an address). Answer it with runSetupAction `value`. */
  valueLabel?: string;
  valuePlaceholder?: string;
  valueFormat?: 'https-origin' | 'domain' | 'text';
  required?: boolean;
  artifact?:{url:string;sha256:string;platform:string;architecture:string};
  effects?:{writes:string[];networkOrigins:string[];requiresPrivilege:boolean;restartRequired:boolean};
};

export type Properties = {
  reach: Reach;
  transport: 'http' | 'https' | 'tcp' | 'tls';
  traffic: {
    tlsTermination: 'endpoint' | 'provider' | 'unknown';
    providerCanReadPayload: boolean | null;
    readers: string[];
    metadataVisibleTo: string[];
    evidenceRef: string | null;
  };
  address: {
    stability: 'stable' | 'ephemeral' | 'unknown'; scope: string; conditions: string[];
    /** The public ports a route of the queried (or viewed) usage kind may use, in the order Gozar tries them; null when the provider assigns the port. */
    ports: number[] | null;
  };
  cost: { kind: 'free' | 'paid' | 'unknown'; summary: string; currency: string | null; amount: number | null; period: string | null };
  needsAccount: boolean | null;
  lifetimes: ('session' | 'attached' | 'durable')[];
  supervision: 'controller' | 'provider-persistent' | 'host-supervised';
  protocols: { sse: boolean; streamableHttp: boolean; oauthDcr: boolean };
  /**
   * What Gozar checks before it publishes: where the check runs from, and which checks it makes for this request.
   * `tls` appears only for an https provider, and `sse` only when the request asks for SSE.
   */
  proof: { vantage: ProofVantage; checks: ProofCheck[] };
};

export type ProofVantage = 'public' | 'tailnet' | 'lan' | 'this-device' | 'none';
export type ProofCheck = 'tls' | 'nonce' | 'sse';

export type UnmetRequirement = 'reach' | 'transport' | 'payloadAccess' | 'address' | 'setup' | 'protocols' | 'usage' | 'platform';
export type UnmetReason = 'not_met' | 'unknown' | 'unsupported_platform';


/** An observation, never a guessed default. */
export type Observation<T> = { known: true; value: T } | { known: false; reason: string };
/** Open display data. Show every affectsConsent row before approval. Groups and ids are open strings. */
export type Fact = { id: string; label: string; value: string | number | boolean | null; group: string;
  affectsConsent: boolean; source: string; asOf: string | null } &
  ({ known: true; reason?: string|null } | { known: false; reason: string });
export type SetupConsentScope={kind:'setup';registryId:string;scopeId:string;providerId:string;configurationRevision:string;draftId:string|null;actionId:string;disclosureRevision:string;actionDigest:string};
export type RouteConsentScope={kind:'route';registryId:string;scopeId:string;providerId:string;configurationRevision:string;query:{usage:Usage;reach:Reach;transport:Properties['transport'];target:string;expectedOrigin:string|null};reviewHandle?:string;handleGeneration?:number};
/** The actual typed canonical input. Setup includes the full trusted action, including artifact/effect disclosures. */
export type SetupConsentDisclosures={action:Omit<Action,'consent'|'review'>};
export type RouteConsentDisclosures={reach:Reach;transport:Properties['transport'];traffic:Properties['traffic'];address:Properties['address'];cost:{kind:Properties['cost']['kind']};lifetimes:Properties['lifetimes'];supervision:Properties['supervision'];protocols:Properties['protocols'];disclosure:Disclosure};
export type ConsentDisclosures=SetupConsentDisclosures|RouteConsentDisclosures;
export type SetupConsentSnapshot={scope:SetupConsentScope;consentFactsDigest:string;facts:Fact[];disclosures:SetupConsentDisclosures};
export type RouteConsentSnapshot={scope:RouteConsentScope;consentFactsDigest:string;facts:Fact[];disclosures:RouteConsentDisclosures};
export type ConsentSnapshot=SetupConsentSnapshot|RouteConsentSnapshot;
export type Availability = Record<Usage['kind'], { state: 'available' | 'detect-only' | 'unsupported'; reason: string }>;
export type Prerequisite = { id: string; label: string; state: 'present' | 'missing' | 'unknown' | 'denied'|'unsupported';
  observation?:Observation<boolean|string>;observedAt: string|null; version: Observation<string>; remedy: Action | null };
export type InputRequirement = { id: string; actionId:string; label: string; kind: 'text' | 'domain' | 'https-origin'; secret: boolean; help: string;
  required: boolean; obtainUrl: string | null; validation: 'syntax-only' };
export type Configuration = { revision:string;scopeId:string;inputRequirements: InputRequirement[]; values: Record<string,string>;
  credentials: Record<string,Observation<boolean>>; actions: Action[] };

export type Candidate = {
  consent:RouteConsentSnapshot;
  consentFactsDigest:string;
  review:{canonicalInput:unknown};
  availability: Availability;
  prerequisites: Prerequisite[];
  facts: Fact[];
  configuration: Configuration;
  /** The adapter's own stable id, the value `Query.providerId` takes. Pass-through data: show it, store it, send it back. */
  providerId: string;
  /** Opaque to apps. */
  name: string;
  /** Opaque to apps; the only value usable in a preference list. */
  preferenceRef: string;
  rank: number;
  eligible: boolean;
  unmet: { requirement: UnmetRequirement; actual: unknown; reasonCode: UnmetReason }[];
  display: {
    label: string; description: string;
    /** One static sentence: what a route of the queried usage kind needs on this computer, naming its ports. Shown whether or not setup is ready. */
    needs: string;
  };
  properties: Properties;
  /**
   * On a platform Gozar does not support (anything but Linux and macOS in 0.2.0), every candidate has
   * setup.state 'unsupported', eligible false and the unmet entry
   * `{requirement:'platform', reasonCode:'unsupported_platform'}` (revision 3; amendment 3).
   */
  setup: { state: 'ready' | 'action-required' | 'unsupported' | 'unknown' | 'detect-only'; actions: Action[] };
  disclosure: Disclosure;
  /**
   * Set only when `eligible` is true AND `setup.state` is 'ready'. An 'action-required' candidate has
   * null: after runSetupAction the app asks the catalog again to get a token. Bearer data: hold
   * transiently or in a 0600 file; never log.
   */
  candidateToken: string | null;
  expiresAt: string | null;
};

export type Catalog = {
  schemaVersion: 2;
  features: string[];
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
  operationId:string|null;
  binding:import('./embedding-contract.js').RouteBinding;
  schemaVersion: 2;
  routeState: 'detected' | 'verified' | 'expired' | 'cleanup-unconfirmed' | 'inactive' | 'unknown';
  expiresAt: Observation<string>;
  hostConfiguration: { target: Observation<string>; localPort: Observation<number>; bindTarget: Observation<string>; origin: Observation<string> };
  facts: Fact[];
  actions: ('stop' | 'edit' | 'rotate')[];
  handle: Handle;
  origin: string | null;
  published: string | null;
  state: 'creating' | 'usable' | 'unverified' | 'unknown' | 'lost' | 'suspending' | 'suspended' | 'address_changed' | 'uncertain' | 'releasing' | 'released' | 'handing-back';
  ownership: 'gozar-owned' | 'external-owned';
  properties: Properties;
  ingress: Ingress | null;
  /** `vantage` is where the last check actually ran from; a check made from this computer is 'this-device'. `checks` lists what that check made. */
  verification: { status: 'verified' | 'unverified'; observedAt:string|null;subject:ProofSubject|null;checkedAt: string | null; vantage: ProofVantage; checks: ProofCheck[]; validUntil: Observation<string>; results: {check: ProofCheck; status: 'passed' | 'failed' | 'unknown'}[] };
  limits: { recommendedPollIntervalMs: number; idleTimeoutMs: number | null };
  cleanup: { state: 'none' | 'unconfirmed' | 'confirmed'; message?: string;nextAction:Action|null };
};
export type ProofSubject={origin:string;target:string;instanceId:string;handleGeneration:number;bootId:string};

export type Approval = { kind:'route';consentFactsDigest:string;candidateToken: string; disclosureRevision: string };

/** Frozen. Apps branch only on these codes; provider diagnostics stay inside Gozar. */
export type GozarErrorCode =
  | 'invalid_input' | 'requirements_unsatisfied' | 'setup_required' | 'consent_required' | 'consent_unknown'
  | 'consent_expired' | 'consent_mismatch' | 'candidate_stale' | 'preference_conflict' | 'route_not_found'
  | 'route_conflict' | 'address_changed' | 'stopped_by_user' | 'handing_back' | 'verification_failed'
  | 'provider_unavailable' | 'cleanup_debt' | 'unsupported' | 'ambiguous_route' | 'busy' | 'internal_error'
  | 'configuration_stale'|'configuration_in_use'|'secret_in_use'|'secret_backend_locked'|'secret_backend_unavailable'
  | 'host_policy_denied'|'artifact_integrity_failed'|'configuration_migration_required'|'proof_refresh_unsupported'|'operation_conflict';
// 'busy': a lock is held; retry after a pause. 'internal_error': an unexpected Gozar fault.

export type GozarError = { schemaVersion: 1; error: { code: GozarErrorCode; message: string; nextAction: Action | null } };

/** What JS callers catch: `.code` and `.nextAction` carry the same data as the CLI GozarError envelope. */
export interface GozarThrownError extends Error { code: GozarErrorCode; nextAction: Action | null;route?:RouteView }

// --- Results and records ------------------------------------------------------------------------

export type PreferenceRecord = {
  schemaVersion: 1;
  scope: 'user';
  revision: number;
  /** What was stored: preferenceRef or providerId values. */
  adapterPreference: string[];
  onUnavailable: 'ask';
};

export type SetupActionResult = {
  configuration:Configuration;configurationRevision:string;scopeId:string;
  schemaVersion: 1;
  state: 'complete' | 'pending' | 'blocked';
  nextAction: Action | null;
  catalogRevision: string;
};

export type WatchEvent = {
  schemaVersion: 1;
  sequence: number;
  type: 'snapshot' | 'changed' | 'terminal'|'consent_changed';
  oldDigest?:string;newDigest?:string;nextAction?:Action|null;reason?:string;
  route: RouteView;
};

export type InspectLegacyRouteResult = {
  schemaVersion: 1;
  migrationRef: string;
  origin: string | null;
  target: string;
  bridgeHome: string | null;
  state: 'adoptable' | 'external' | 'blocked';
  reasonCode: 'unrecognized_format' | 'not_found' | 'target_mismatch' | 'origin_mismatch' | 'not_adoptable' | null;
  /** For 'unrecognized_format': the sign-in-again setup action. */
  nextAction: Action | null;
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
export type EnsureRouteRequest = Query & { intent?: 'create'; usage: { kind: 'durable'; routeId: string }; approval?: Approval; reconsent?: boolean };

/**
 * Durable only; no claim input. The old-owner fence is the caller's precondition. `approval` is always
 * required. A user-stop tombstone is cleared only when `reconsent: true` is also set; without it,
 * adopt fails with stopped_by_user (symmetric with ensureRoute).
 */
export type AdoptRouteRequest = Query & {
  intent?: 'adopt';
  usage: { kind: 'durable'; routeId: string };
  reconsent?: boolean;
  origin: string;
  approval: Approval;
  handover: { from: string; generation: number };
};

/**
 * Session or attached usage only. With attached usage the calling process holds the lease: the library
 * sends heartbeats on an unref'd timer, process exit ends the lease within the expiry window, and
 * closeRoute({handle}) ends it early. There is no lease object and no extra export.
 */
export type ExposeRequest = Query & {
  intent?: 'create';
  usage: { kind: 'session'; lifetimeMs: number } | { kind: 'attached' };
  approval: Approval;
  wait: 'allocated' | 'verified';
};

export type RouteRef = { home: string; handle: Handle };
export type SuspendRouteRequest = RouteRef & { handle: Handle & { kind: 'durable' } };
export type CloseRouteRequest = RouteRef & { mode: 'remove' };
export type WatchRoutesRequest = RouteRef & { signal: AbortSignal; intervalMs?: number };
export type SetRoutePreferencesRequest = {
  profileHome: string;
  expectedRevision: number;
  /** preferenceRef or providerId values. */
  adapterPreference: string[];
  onUnavailable: 'ask';
};
export type RunSetupActionRequest = {
  home: string;
  owner?:string;providerId:string;expectedConfigurationRevision:string;draftId?:string;
  actionId: string;
  approval: { kind:'setup';consentFactsDigest:string;digest: string; disclosureRevision: string };
  /** Points into Gozar's private store; never a token value. For 'provide-secret'. */
  secretHandle?: string;
  /** For 'provide-value': checked against the action's valueFormat, then kept as configuration (not in the secret store). */
  value?: string;
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
/**
 * Fresh proof for one handle. An external service is read with `handle: {kind:'external', id:<origin>}`
 * and returns the normalized RouteView (ownership 'external-owned'); there is no separate projection export.
 */
export function routeStatus(request: RouteRef): Promise<RouteView>;
/** Removes forwarding but keeps the pin and consent. Resume with ensureRoute. */
export function suspendRoute(request: SuspendRouteRequest): Promise<RouteView>;
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
/** Attached usage returns a plain RouteView; see ExposeRequest for who holds the lease. */
export function expose(request: ExposeRequest): Promise<RouteView>;
export function expose(options: LegacyExposeOptions): Promise<LegacySessionReply>;
export function status(options?: LegacyExposeOptions): Promise<LegacySessionReply>;
export function stop(options?: LegacyExposeOptions): Promise<LegacySessionReply>;

// --- Kept service and hand-back exports (also at @tnunamak/gozar/service) ------------------------
// The pre-0.2 durable signatures (ensureRoute/adoptRoute with adapterId and approvals tuples, and
// statusRoutes) are not kept: those durable signatures were unpublished at the
// historical 0.1.0 migration boundary. The current root ensureRoute/adoptRoute replace them.
// ensureRoute/adoptRoute above replace them.

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

/** Stores secret bytes privately; returns an opaque handle only. */
export const storeSecret:import('./embedding-contract.js').HostEmbeddingMethods['storeSecret'];
export const discardSecret:import('./embedding-contract.js').HostEmbeddingMethods['discardSecret'];
export const beginConfigurationDraft:import('./embedding-contract.js').HostEmbeddingMethods['beginConfigurationDraft'];
export const commitConfigurationDraft:import('./embedding-contract.js').HostEmbeddingMethods['commitConfigurationDraft'];
export const discardConfigurationDraft:import('./embedding-contract.js').HostEmbeddingMethods['discardConfigurationDraft'];
export const listProviders:import('./embedding-contract.js').HostEmbeddingMethods['listProviders'];
export const readConfigurationDraft:import('./embedding-contract.js').HostEmbeddingMethods['readConfigurationDraft'];
export const clearConfigurationInput:import('./embedding-contract.js').HostEmbeddingMethods['clearConfigurationInput'];
export function reviewRouteConsent(request:RouteRef):Promise<RouteConsentSnapshot&{subject:ProofSubject|null;approvalToken:string;expiresAt:string}>;
export function approveRouteConsent(request:RouteRef&{approvalToken:string;consentFactsDigest:string}):Promise<RouteView>;
export function listRoutes(request:{home:string;owner?:string}):Promise<{routes:RouteView[]}>;
export type {SecretBackend,HostCapabilities,HostCapabilityId,HostIdentity,ConfigurationDraft,ProviderInventory} from './embedding-contract.js';
export type {Adapter,AdapterDefinition,AdapterRequest,AdapterPlan,AdapterProofSession,ProofAttempt,ReadContext,SetupContext,AdmittedEffectContext,Receipt,Removal,Verification,Observation as AdapterObservation} from './adapter-contract.js';

/** Trusted executable extension registry. Relative provider paths resolve under root/providers. */
export type GozarOptions={manifest?: string | {providers: {id:string; module:string; definition:string}[]}; root?: string;secretBackend?:import('./embedding-contract.js').SecretBackend;hostCapabilities?:import('./embedding-contract.js').HostCapabilities;identity?:import('./embedding-contract.js').HostIdentity};
export function createGozar(options?: GozarOptions): import('./embedding-contract.js').HostEmbeddingMethods & {
 catalogRoutes: typeof catalogRoutes; expose: (request:ExposeRequest)=>Promise<RouteView>;
 ensureRoute: typeof ensureRoute; adoptRoute: typeof adoptRoute; routeStatus: typeof routeStatus;
 closeRoute: typeof closeRoute; suspendRoute: typeof suspendRoute; watchRoutes: typeof watchRoutes;
 runSetupAction: typeof runSetupAction; inspectLegacyRoute: typeof inspectLegacyRoute;
 getRoutePreferences: typeof getRoutePreferences; setRoutePreferences: typeof setRoutePreferences;
 resolveClientAddress: typeof resolveClientAddress;
 reviewRouteConsent:typeof reviewRouteConsent;approveRouteConsent:typeof approveRouteConsent;
 listRoutes:typeof listRoutes;
};
