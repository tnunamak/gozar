import type { Action, Observation, RunSetupActionRequest, SetupConsentScope } from './route-contract.js';

/** An optional descriptor on an existing setup Action. Action.kind still selects the input or UI control. */
export type SetupStep = {
  actor: 'machine' | 'owner' | 'administrator' | 'trusted-client';
  permission: { id: string; label: string };
  verification: 'provider' | 'host' | 'trusted-client';
  purpose: 'authorize' | 'configure' | 'provision' | 'reconcile'
    | 'stop-connector' | 'remove-resource' | 'revoke-credential';
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

export type RunSetupOperationRequest = Omit<RunSetupActionRequest, keyof SetupOperationRef | 'approval'> &
  SetupOperationRef & {
    /** Zero reserves without input or approval. A later command names the exact revision that offered its action. */
    expectedSetupRevision: number;
    /** Omit for an observation or a machine drive with previously granted exact authority. */
    approval?: RunSetupActionRequest['approval'];
  };

export type SetupOperation = {
  schemaVersion: 1;
  operationId: string;
  revision: number;
  scope: Pick<SetupConsentScope, 'registryId' | 'scopeId' | 'providerId' | 'configurationRevision' | 'draftId'>;
  state: 'authorization-required' | 'pending' | 'denied' | 'expired' | 'blocked'
    | 'reconciling' | 'complete' | 'cancelled';
  evidence: SetupEvidence;
  nextAction: (Action & { step: SetupStep; consent: NonNullable<Action['consent']> }) | null;
  resources: SetupResource[];
};
