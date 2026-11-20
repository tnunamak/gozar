---------- MODULE PostAckFence ----------
EXTENDS Naturals

CONSTANT Fenced   \* TRUE: the proof rechecks eligibility right after the acknowledgment (the code); FALSE: the pre-fix code

(*
  A durable proof on the unlocked status path (durable-route.mjs, verifyRecord): the host acknowledgment is
  awaited, then the proof starts. A legitimate cancel (close, stop, release, generation change) can commit at
  any time while the acknowledgment is held, because the status path holds no reservation lock.
  Paths that hold the reservation lock cannot interleave a cancel at all: every cancelling mutation takes the
  same exclusive lock, so Cancel is simply not enabled while they run (modelled by `locked`).
*)

VARIABLES phase, cancelled, locked, proofAfterCancel

vars == << phase, cancelled, locked, proofAfterCancel >>

Init == phase = "idle" /\ cancelled = FALSE /\ locked \in {TRUE, FALSE} /\ proofAfterCancel = FALSE

AskAck  == phase = "idle" /\ phase' = "acking" /\ UNCHANGED << cancelled, locked, proofAfterCancel >>
\* A cancel commits at any moment before the proof starts, unless the call holds the lock.
Cancel  == ~cancelled /\ ~locked /\ phase \in {"idle", "acking", "acked"} /\ cancelled' = TRUE /\ UNCHANGED << phase, locked, proofAfterCancel >>
AckBack == phase = "acking" /\ phase' = "acked" /\ UNCHANGED << cancelled, locked, proofAfterCancel >>
\* The proof starts after the acknowledgment returned. The fence is the eligibility recheck.
StartProof == phase = "acked" /\ (Fenced => ~cancelled)
              /\ phase' = "proving" /\ proofAfterCancel' = cancelled /\ UNCHANGED << cancelled, locked >>
Done == (phase = "proving" \/ (Fenced /\ phase = "acked" /\ cancelled)) /\ UNCHANGED vars

Next == AskAck \/ Cancel \/ AckBack \/ StartProof \/ Done

TypeOK == phase \in {"idle", "acking", "acked", "proving"} /\ cancelled \in BOOLEAN /\ locked \in BOOLEAN /\ proofAfterCancel \in BOOLEAN
\* No proof starts for a route whose cancel had already committed.
NoProofAfterCancel == ~proofAfterCancel
====
