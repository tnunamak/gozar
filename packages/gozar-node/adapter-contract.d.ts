// Gozar adapter boundary, version 1 (frozen in C0; amendment 1 adds context fields; amendment 2 adds Receipt.origin).
//
// One adapter is one directory plus one `{id, module, definition}` entry in adapters/manifest.json
// `providers`. Types only: no runtime behaviour is declared here. Opaque effect, readback and
// identity bodies stay provider-specific; core validates the envelope and the admission.
import type { Action, Fact, Availability, Properties, RouteView, Ingress, Usage, Requirements, Disclosure,InputRequirement,HostCapabilityId } from './route-contract.js';

export type AdapterState = 'ready' | 'action-required' | 'unsupported' | 'unknown';

/**
 * Every method is required. Unsupported setup/create/kinds return a typed `unsupported`, never fabricated success.
 * `create` and `remove` reject with an AdapterEffectError when they cannot apply the effect. A
 * `precondition_failed` rejection means nothing was changed: the core re-observes and re-plans (the
 * ownership decision stays in the core, never inside the adapter or `executePlan`).
 */
export interface Adapter {
  id: string;
  definition: AdapterDefinition;
  detect(ctx: ReadContext): Promise<{ state: AdapterState; facts: unknown }>;
  properties(facts: unknown): Properties;
  setupActions(facts: unknown): Action[];
  configurationActions?(): Action[];
  /** Prepares this attempt's protocol-specific challenge before provider creation. */
  prepareProof?(ctx: ReadContext, request: AdapterRequest, attempt: ProofAttempt): Promise<AdapterProofSession>;
  setup(ctx: SetupContext, actionId: string, secretHandle?: string): Promise<SetupResult>;
  plan(ctx: ReadContext, request: AdapterRequest): Promise<AdapterPlan>;
  create(ctx: AdmittedEffectContext, plan: AdapterPlan): Promise<Receipt>;
  observe(ctx: ReadContext, request: AdapterRequest): Promise<Observation>;
  verify(ctx: ReadContext, receipt: Receipt): Promise<Verification>;
  remove(ctx: AdmittedEffectContext, receipt: Receipt, observed: Observation): Promise<Removal>;
  runtimeFacts(ctx: ReadContext, receipt: Receipt): Promise<{ properties: Properties; ingress: Ingress | null; limits: RouteView['limits'];facts?:Fact[];binding?:RouteView['binding'] }>;
}

export type AdapterDefinition = {
  schemaVersion: 1;
  id: string;
  label: string;
  capabilities: Properties;
  facts?: Fact[];
  availability?: Availability;
  prerequisites?: {id: string; label: string; observation: string; actionId?: string}[];
  supportedKinds: ('session' | 'attached' | 'durable')[];
  disclosure: Disclosure;
  /** URL schemes accepted from this adapter, including the colon; default derives from transport. */
  originSchemes?: string[];
  needs?:string;
  ownership?:'gozar-owned'|'external-owned';
  inputRequirements?:InputRequirement[];
  requiredCapabilities?:HostCapabilityId[];
  effectOperations?:{kind:string;operation:string}[];
  byUsage?:Partial<Record<Usage['kind'],{needs?:string;ports?:number[]|null}>>;
};

/** The adapter binds verification to the fresh challenge and this attempt's endpoint. */
export type AdapterProofSession = {
  target: string;
  verify(input: {origin: string; receipt: Receipt; attempt: ProofAttempt}): Promise<{
    attemptId: string; endpoint: string;
    status: 'verified' | 'unverified'; checkedAt: string | null; validUntil?: string;
    vantage: RouteView['verification']['vantage']; checks: RouteView['verification']['checks']; facts?: Fact[];
  }>;
  close(): Promise<void>;
  /** Optional safe reproof. Without it status retains the original proof and its expiry. */
  refresh?: AdapterProofSession['verify'];
};
export type ProofAttempt = { id: string; nonce: string; deadlineMs: number; signal: AbortSignal };

export type AdapterRequest = {
  target: string;
  origin: string | null;
  usage: Usage;
  requirements: Requirements;
  configurationRef: string | null;
};

/**
 * `precondition` is required. null means the effect is unconditional. When non-null, `executePlan` and
 * `compareAndRemove` apply the effect only if the provider's current revision still equals
 * `precondition.revision` (null meaning the provider has no revision to compare); otherwise they reject with
 * AdapterEffectError `precondition_failed` and change nothing.
 */
export type AdapterPlan = {
  digest: string; origin: string | null; resourceKey: string; effects: unknown[]; readback: unknown; cleanup: unknown;
  precondition: { revision: string | null } | null;
};

/**
 * What an adapter operation (create, remove, executePlan, compareAndRemove) rejects with. Internal: apps never
 * see `precondition_failed`. The core retries the read-decide-write loop; when retries run out it surfaces
 * `provider_unavailable`. The other three codes are in the frozen consumer union and map to themselves.
 */
export type AdapterEffectError = {
  code: 'precondition_failed' | 'unsupported' | 'provider_unavailable' | 'setup_required';
  message: string;
};

/**
 * No raw secrets in facts, plans or receipts. `origin` (amendment 2) is the address the provider allocated at
 * create, or null when it allocated none; the core reads the published origin from it, never from provider-specific bodies.
 */
export type Receipt = { schemaVersion: 1; adapterId: string; resourceKey: string; generation: number; operationId?: string | null; identity: unknown; readback: unknown; origin: string | null };

/** `revision` is the provider's config revision (for example an ETag), or null when the provider has none. */
export type Observation = { present: boolean; resourceKey: string; identity: unknown; revision: string | null };

export type Verification = RouteView['verification'];

export type Removal = { removed: boolean; debt: null | { code: string; message: string } };

export type SetupResult = { state: 'complete' | 'pending' | 'blocked'; nextAction: Action | null };

/** Injected clock, read-only provider probe, challenge verifier and private configuration lookup. */
export type ReadContext = {
  /** Present only in the explicit public testing harness; operations must be declared in adapter data. */
  dispatchEffect?:(request:{kind:string;operation:string;input:unknown})=>Promise<unknown>;
  now: () => number;
  /** Canonical Gozar state home of the calling app (amendment 1: the durable plan needs it). */
  home: string;
  /** Host platform as reported by the core; adapters never read process.platform themselves (amendment 1). */
  platform: string;
  /**
   * Private configuration lookup, scoped to this adapter. It is the only path by which a secret
   * (for example a provider auth token) reaches an adapter. With ref null it returns the values the user
   * supplied through this adapter's completed `provide-secret` setup actions, keyed by action id, or null.
   * Every context may read them, because `plan` needs configured values such as a reserved address.
   * The secret must never be placed in facts, plans, receipts, errors or output, in any context.
   */
  configuration: (ref: string | null) => Promise<unknown>;
  /** Runs a read-only recipe through the engine; `ok` is the recipe parser's verdict (amendment 1). */
  probe: (recipe: unknown) => Promise<{ ok: boolean; detail?: unknown }>;
  verifyChallenge: (origin: string, target: string) => Promise<Verification>;
};

/** Adds only approved-action execution and private secret lookup. */
export type SetupContext = ReadContext & {
  executeApprovedAction: (id: string) => Promise<SetupResult>;
  withSecret: <T>(handle: string, use: (secret: Uint8Array) => Promise<T>) => Promise<T>;
};

/**
 * Adds only plan-engine-admitted create and conditional-remove operations plus generation checking.
 * Both honor `plan.precondition` / the observed revision and reject with AdapterEffectError
 * (`precondition_failed` when the provider revision moved; nothing is changed). Neither contains ownership logic.
 */
export type AdmittedEffectContext = ReadContext & {
  signal?:AbortSignal;deadlineMs?:number;attemptId?:string;operationId?:string|null;
  /** Route generation the effect is admitted for; receipts carry it (amendment 1). */
  generation: number;
  assertGeneration: () => Promise<void>;
  executePlan: (plan: AdapterPlan) => Promise<Receipt>;
  compareAndRemove: (receipt: Receipt, observed: Observation) => Promise<Removal>;
};

/** One entry of adapters/manifest.json `providers`. */
export type ManifestProvider = { id: string; module: string; definition: string };
