---- MODULE WatchObserver ----
(*
  A host that declared `acknowledgeOrigin` opens a proof call (an explicit check) on one route. The library asks the
  host to acknowledge the route's origin for one attempt, then rechecks eligibility, then starts the proof.
  A watch polls the same route. Under `Observing` it reads recorded state only (durable-route.mjs, statusRoutes
  with `observe`): no acknowledgment, no proof, no publication, no lease renewal, no target challenge.
  Without it (the c5 behavior) a poll ran the whole proof path itself.

  Real boundary, stated honestly: in verifyRecord the eligibility recheck (`await eligible()`: a read of the record, then a
  read of the stop tombstone) is followed by the proof start. A cancel committed by another process can land between
  the last read and the proof start, and the unlocked status path holds no reservation lock. `CheckStartAtomic = FALSE`
  models that window; the cost is one read-only challenge request for a route that has just been cancelled.
*)
EXTENDS Naturals

CONSTANTS Observing, CheckStartAtomic

VARIABLES call, phase, attemptOwner, ackOutsideCall, cancelled, proofAfterCancel, wrote

vars == << call, phase, attemptOwner, ackOutsideCall, cancelled, proofAfterCancel, wrote >>

\* call: whether the host currently has a proof call open. phase: the explicit check's progress.
Init == call = FALSE /\ phase = "idle" /\ attemptOwner = "none" /\ ackOutsideCall = FALSE
        /\ cancelled = FALSE /\ proofAfterCancel = FALSE /\ wrote = FALSE

HostOpensCheck == phase = "idle" /\ ~call /\ call' = TRUE /\ phase' = "opened"
                  /\ UNCHANGED << attemptOwner, ackOutsideCall, cancelled, proofAfterCancel, wrote >>
CheckAcks == phase = "opened" /\ attemptOwner = "none" /\ attemptOwner' = "check" /\ phase' = "acked"
             /\ UNCHANGED << call, ackOutsideCall, cancelled, proofAfterCancel, wrote >>
\* The eligibility recheck after the acknowledgment.
CheckRechecks == phase = "acked" /\ ~cancelled /\ phase' = "eligible"
                 /\ UNCHANGED << call, attemptOwner, ackOutsideCall, cancelled, proofAfterCancel, wrote >>
CheckProves == phase = "eligible" /\ phase' = "proved" /\ proofAfterCancel' = cancelled
               /\ UNCHANGED << call, attemptOwner, ackOutsideCall, cancelled, wrote >>
HostClosesCheck == phase = "proved" /\ call /\ call' = FALSE /\ phase' = "idle" /\ attemptOwner' = "none"
                   /\ UNCHANGED << ackOutsideCall, cancelled, proofAfterCancel, wrote >>
\* A cancel (close, stop, release, generation change) commits from another process at any time before the proof.
Cancel == ~cancelled /\ phase \in {"opened", "acked", "eligible"} /\ cancelled' = TRUE
          /\ (CheckStartAtomic => phase # "eligible")
          /\ UNCHANGED << call, phase, attemptOwner, ackOutsideCall, proofAfterCancel, wrote >>

\* One poll of the watch.
WatchPoll == IF Observing
  THEN UNCHANGED vars \* reads recorded state: nothing the host or the provider can see changes
  ELSE /\ ackOutsideCall' = (ackOutsideCall \/ ~call)         \* it asked the host, possibly outside any call
       /\ attemptOwner' = IF call /\ attemptOwner = "check" THEN "watch" ELSE attemptOwner  \* or took the check's attempt
       /\ wrote' = TRUE                                        \* and may renew a lease or publish
       /\ UNCHANGED << call, phase, cancelled, proofAfterCancel >>

Done == phase = "idle" /\ cancelled /\ UNCHANGED vars
Next == HostOpensCheck \/ CheckAcks \/ CheckRechecks \/ CheckProves \/ HostClosesCheck \/ Cancel \/ WatchPoll \/ Done

TypeOK == call \in BOOLEAN /\ phase \in {"idle", "opened", "acked", "eligible", "proved"}
          /\ attemptOwner \in {"none", "check", "watch"} /\ ackOutsideCall \in BOOLEAN /\ cancelled \in BOOLEAN
          /\ proofAfterCancel \in BOOLEAN /\ wrote \in BOOLEAN
NoAckOutsideCall == ~ackOutsideCall
AttemptNeverStolen == attemptOwner # "watch"
WatchWritesNothing == ~wrote
NoProofAfterCancel == ~proofAfterCancel
====
