// Gozar adapter boundary, version 1 (frozen in C0).
//
// One adapter is one directory plus one `{id, module, definition}` entry in adapters/manifest.json
// `providers`. Types only: no runtime behaviour is declared here. Opaque effect, readback and
// identity bodies stay provider-specific; core validates the envelope and the admission.
import type { Action, Properties, RouteView, Ingress, Usage, Requirements, Disclosure } from './route-contract.js';

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
  setup(ctx: SetupContext, actionId: string, secretHandle?: string): Promise<SetupResult>;
  plan(ctx: ReadContext, request: AdapterRequest): Promise<AdapterPlan>;
  create(ctx: AdmittedEffectContext, plan: AdapterPlan): Promise<Receipt>;
  observe(ctx: ReadContext, request: AdapterRequest): Promise<Observation>;
  verify(ctx: ReadContext, receipt: Receipt): Promise<Verification>;
  remove(ctx: AdmittedEffectContext, receipt: Receipt, observed: Observation): Promise<Removal>;
  runtimeFacts(ctx: ReadContext, receipt: Receipt): Promise<{ properties: Properties; ingress: Ingress | null; limits: RouteView['limits'] }>;
}

export type AdapterDefinition = {
  schemaVersion: 1;
  id: string;
  label: string;
  capabilities: Properties;
  supportedKinds: ('session' | 'attached' | 'durable')[];
  disclosure: Disclosure;
};

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

/** No raw secrets in facts, plans or receipts. */
export type Receipt = { schemaVersion: 1; adapterId: string; resourceKey: string; generation: number; identity: unknown; readback: unknown };

/** `revision` is the provider's config revision (for example an ETag), or null when the provider has none. */
export type Observation = { present: boolean; resourceKey: string; identity: unknown; revision: string | null };

export type Verification = RouteView['verification'];

export type Removal = { removed: boolean; debt: null | { code: string; message: string } };

export type SetupResult = { state: 'complete' | 'pending' | 'blocked'; nextAction: Action | null };

/** Injected clock, read-only provider probe, challenge verifier and private configuration lookup. */
export type ReadContext = {
  now: () => number;
  configuration: (ref: string | null) => Promise<unknown>;
  probe: (recipe: unknown) => Promise<unknown>;
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
  assertGeneration: () => Promise<void>;
  executePlan: (plan: AdapterPlan) => Promise<Receipt>;
  compareAndRemove: (receipt: Receipt, observed: Observation) => Promise<Removal>;
};

/** One entry of adapters/manifest.json `providers`. */
export type ManifestProvider = { id: string; module: string; definition: string };
