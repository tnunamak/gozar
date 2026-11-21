---- MODULE WatchObserver ----
(*
  A host that declared `acknowledgeOrigin` opens a proof call (an explicit check) on one route. The library asks the
  host to acknowledge the route's origin for one attempt, then rechecks eligibility, then starts the proof.
  A watch polls the same route. Under `Observing` it reads recorded state only (durable-route.mjs, statusRoutes
  with `observe`): no acknowledgment, no proof, no publication, no lease renewal, no target challenge.
  Without it (the c5 behavior) a poll ran the whole proof path itself.

  Real boundary, stated honestly: in verifyRecord the eligibility recheck (a read of the record, then a read of the stop
  tombstone) is followed by the proof start. A cancel committed by another process can land between the last read and the
  proof start unless something excludes it. Every cancelling mutation takes the home-wide reservation lock, so the fix holds
  that lock from the recheck through the proof (the acknowledgment stays outside it). `LockedRecheck = FALSE` is the earlier
  code (the counterexample: the close commits, then the challenge starts); TRUE is the fixed code. A cancel waits for the
  lock, so it commits before the recheck (which then refuses) or after the proof.
*)
EXTENDS Naturals

CONSTANTS Observing, LockedRecheck,
          ObserveKinds   \* TRUE: the attached and generic-session watch also uses the authenticated controller `observe` command (the code); FALSE: it called status

VARIABLES call, phase, attemptOwner, ackOutsideCall, cancelled, proofAfterCancel, wrote, lockHeld,
          kind,       \* the watched handle: "durable" | "attached" | "session"
          drift,      \* a durable route's consent facts now differ from what the person approved (environment choice, fixed)
          withdrew    \* the watch persisted a fail-closed withdrawal (the ONE deliberate write of an observation)

vars == << call, phase, attemptOwner, ackOutsideCall, cancelled, proofAfterCancel, wrote, lockHeld, kind, drift, withdrew >>

\* call: whether the host currently has a proof call open. phase: the explicit check's progress.
Init == call = FALSE /\ phase = "idle" /\ attemptOwner = "none" /\ ackOutsideCall = FALSE
        /\ cancelled = FALSE /\ proofAfterCancel = FALSE /\ wrote = FALSE /\ lockHeld = FALSE
        /\ kind \in {"durable", "attached", "session"} /\ drift \in BOOLEAN /\ withdrew = FALSE

HostOpensCheck == phase = "idle" /\ ~call /\ call' = TRUE /\ phase' = "opened"
                  /\ UNCHANGED << attemptOwner, ackOutsideCall, cancelled, proofAfterCancel, wrote, lockHeld, kind, drift, withdrew >>
CheckAcks == phase = "opened" /\ attemptOwner = "none" /\ attemptOwner' = "check" /\ phase' = "acked"
             /\ UNCHANGED << call, ackOutsideCall, cancelled, proofAfterCancel, wrote, lockHeld, kind, drift, withdrew >>
\* The eligibility recheck after the acknowledgment.
CheckRechecks == phase = "acked" /\ ~cancelled /\ ~lockHeld /\ phase' = "eligible" /\ lockHeld' = LockedRecheck
                 /\ UNCHANGED << call, attemptOwner, ackOutsideCall, cancelled, proofAfterCancel, wrote, kind, drift, withdrew >>
CheckProves == phase = "eligible" /\ phase' = "proved" /\ proofAfterCancel' = cancelled /\ lockHeld' = FALSE
               /\ UNCHANGED << call, attemptOwner, ackOutsideCall, cancelled, wrote, kind, drift, withdrew >>
HostClosesCheck == phase = "proved" /\ call /\ call' = FALSE /\ phase' = "idle" /\ attemptOwner' = "none"
                   /\ UNCHANGED << ackOutsideCall, cancelled, proofAfterCancel, wrote, lockHeld, kind, drift, withdrew >>
\* A cancel (close, stop, release, generation change) commits from another process at any time before the proof.
\* A cancel commits only while the reservation lock is free.
Cancel == ~cancelled /\ ~lockHeld /\ phase \in {"opened", "acked", "eligible"} /\ cancelled' = TRUE
          /\ UNCHANGED << call, phase, attemptOwner, ackOutsideCall, proofAfterCancel, wrote, lockHeld, kind, drift, withdrew >>

\* One poll of the watch. A kind whose watch observes reads recorded state only. The one deliberate exception is DEFENSIVE: a durable
\* observation reads the route's current consent facts and, when they differ from what was approved, persists a withdrawal
\* (fail-closed); it never creates authority. A kind whose watch still asked for fresh status ran the whole proof path itself.
Passive == Observing /\ (kind = "durable" \/ ObserveKinds)
WatchPoll == IF Passive
  THEN IF kind = "durable" /\ drift
       THEN /\ withdrew' = TRUE
            /\ UNCHANGED << call, phase, attemptOwner, ackOutsideCall, cancelled, proofAfterCancel, wrote, lockHeld, kind, drift >>
       ELSE UNCHANGED vars
  ELSE /\ ackOutsideCall' = (ackOutsideCall \/ ~call)         \* it asked the host, possibly outside any call
       /\ attemptOwner' = IF call /\ attemptOwner = "check" THEN "watch" ELSE attemptOwner  \* or took the check's attempt
       /\ wrote' = TRUE                                        \* and may renew a lease or publish
       /\ UNCHANGED << call, phase, cancelled, proofAfterCancel, lockHeld, kind, drift, withdrew >>

Done == phase = "idle" /\ cancelled /\ UNCHANGED vars
Next == HostOpensCheck \/ CheckAcks \/ CheckRechecks \/ CheckProves \/ HostClosesCheck \/ Cancel \/ WatchPoll \/ Done

TypeOK == call \in BOOLEAN /\ phase \in {"idle", "opened", "acked", "eligible", "proved"}
          /\ attemptOwner \in {"none", "check", "watch"} /\ ackOutsideCall \in BOOLEAN /\ cancelled \in BOOLEAN
          /\ proofAfterCancel \in BOOLEAN /\ wrote \in BOOLEAN /\ lockHeld \in BOOLEAN
          /\ kind \in {"durable", "attached", "session"} /\ drift \in BOOLEAN /\ withdrew \in BOOLEAN
NoAckOutsideCall == ~ackOutsideCall
AttemptNeverStolen == attemptOwner # "watch"
WatchWritesNothing == ~wrote
NoProofAfterCancel == ~proofAfterCancel
\* The defensive withdrawal happens only for real drift of a durable route, and is the only observation write.
WithdrawOnlyOnDrift == withdrew => (kind = "durable" /\ drift)
====
