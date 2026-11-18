import type { Action, Observation, RunSetupActionRequest, SetupConsentScope } from './route-contract.js';

/** An optional descriptor on an existing setup Action. Action.kind still selects the input or UI control. */
export type SetupStep = {
  actor: 'machine' | 'owner' | 'administrator' | 'trusted-client';
  permission: { id: string; label: string };
  verification: 'provider' | 'host' | 'trusted-client';
  purpose: 'authorize' | 'configure' | 'provision' | 'reconcile'
    | 'stop-connector' | 'remove-resource' | 'revoke-credential' | 'disconnect';
  prerequisites?: string[];
  /** Opaque choice values for a provide-value action. */
  options?: { value: string; label: string }[];
  /** On an offered open-url action. Its href is transient browser handoff data. */
  browser?: { expiresAt: string; pollAfterMs: number };
  /** Exact resource subject for provision, reconciliation and removal offers. */
  resourceHandle?: string;
};

export type SetupEvidence = Observation<{
  stepId: string;
  source: SetupStep['verification'];
  observedAt: string;
  summary: string;
}>;

/** The handle identifies a journal entry. It carries neither provider identity data nor deletion authority. */
export type SetupResource = {
  handle: string;
  kind: 'connector' | 'tunnel' | 'dns' | 'credential' | 'other';
  label: string;
  presence: Observation<boolean>;
} & (
  | { ownership: 'owned'; removal: 'required' | 'unconfirmed' }
  | { ownership: 'owned'; removal: 'confirmed'; presence: { known: true; value: false } }
  | { ownership: 'adopted' | 'foreign'; removal: 'retained' }
  | { ownership: 'unknown'; removal: 'unconfirmed' }
);

export type SetupOperationRef = { home: string; owner: string; providerId: string; operationId: string };

type SetupOperationCommand = Omit<RunSetupActionRequest,
  keyof SetupOperationRef | 'approval' | 'value' | 'secretHandle'> & SetupOperationRef;
type SetupOperationInputs = Partial<Pick<RunSetupActionRequest, 'approval' | 'value' | 'secretHandle'>>;

/**
 * Literal zero reserves without approval or input. A dynamic number still needs
 * runtime integer/range and zero-input validation; TypeScript cannot prove it positive.
 */
export type RunSetupOperationRequest<Revision extends number = number> =
  Revision extends 0
    ? SetupOperationCommand & { expectedSetupRevision: 0; approval?: never; value?: never; secretHandle?: never }
    : SetupOperationCommand & { expectedSetupRevision: Revision } & SetupOperationInputs;

type SetupActionFields = Omit<Action, 'consent' | 'review' | 'step' | 'href'> & { review?: never };
type SafeSetupLocation =
  | { step?: Omit<SetupStep, 'browser'> & { browser?: never }; href?: string }
  | { step: SetupStep & { browser: NonNullable<SetupStep['browser']> }; href?: never };

/** Public consent actions are leaf projections: no raw review, nested consent or browser href. */
export type SafeSetupAction = SetupActionFields & SafeSetupLocation & { consent?: never };
type SetupOffer = SetupActionFields & SafeSetupLocation &
  { step: SetupStep; consent: NonNullable<Action['consent']> };

export type SetupOperation = {
  schemaVersion: 1;
  operationId: string;
  revision: number;
  scope: Pick<SetupConsentScope, 'registryId' | 'scopeId' | 'providerId' | 'configurationRevision' | 'draftId'>;
  /** Complete reflects the adapter's setup workflow. Route publication requires separate consent and proof. */
  state: 'authorization-required' | 'pending' | 'denied' | 'expired' | 'blocked'
    | 'reconciling' | 'complete' | 'cancelled';
  /** Setup observation in this operation, which may be unknown when the workflow is complete. */
  evidence: SetupEvidence;
  nextAction: SetupOffer | null;
  resources: SetupResource[];
};

export type InteractiveSetupOperation = Omit<SetupOperation, 'nextAction'> & {
  nextAction: (Omit<Action, 'review' | 'consent'> & { review?: never; step: SetupStep; consent: NonNullable<Action['consent']> }) | null;
};
