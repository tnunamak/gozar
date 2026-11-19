---------- MODULE StableConfigMigration ----------
EXTENDS Naturals

CONSTANTS Atomic,         \* TRUE: one durable write creates the stable record, re-stamps refs and tombstones the old record (the code)
          ConsentBound,   \* TRUE: using a credential needs consent minted for the running registry (consent scope carries registryId)
          LineageChecked  \* TRUE: only a registry that owns the old scope (published or host-declared lineage) may adopt it

(*
  One old configuration (stored under a registry-hashed scope) and one credential it binds. A new registry release
  starts reading the same home/owner/provider. Questions: can a crash or restart lose the binding, can a live
  route lose its use record, can a stranger registry take the credential, can the credential be used without
  fresh consent after the registry changed.
  Every reachable state is a possible crash point, so an invariant that holds in every state is crash safety.
*)

VARIABLES oldRec,     \* "live" | "tomb" | "gone"
          newRec,     \* "none" | "partial" | "done"
          ref,        \* which scope the secret metadata names: "old" | "new"
          uses,       \* live route reservations still recorded on the old config: 1 | 0 (carried to the new record when adopted)
          newUses,
          registry,   \* running registry: "A" (the one that wrote the old config) | "B" (a new release) | "X" (unrelated custom)
          consent,    \* registry the user last approved: "A" | "B" | "X" | "none"
          badUse, foreignRead

vars == << oldRec, newRec, ref, uses, newUses, registry, consent, badUse, foreignRead >>

Init == oldRec = "live" /\ newRec = "none" /\ ref = "old" /\ uses = 1 /\ newUses = 0
        /\ registry = "A" /\ consent = "A" /\ badUse = FALSE /\ foreignRead = FALSE

\* A new release or a stranger registry starts. Existing approval names the old registry.
Upgrade == registry = "A" /\ registry' = "B" /\ UNCHANGED << oldRec, newRec, ref, uses, newUses, consent, badUse, foreignRead >>
Stranger == registry = "A" /\ registry' = "X" /\ UNCHANGED << oldRec, newRec, ref, uses, newUses, consent, badUse, foreignRead >>
Approve == consent' = registry /\ UNCHANGED << oldRec, newRec, ref, uses, newUses, registry, badUse, foreignRead >>

Authorized == registry \in {"A", "B"} \/ ~LineageChecked   \* A and B share the published lineage; X does not

AdoptAtomic == Atomic /\ registry # "A" /\ oldRec = "live" /\ newRec = "none" /\ Authorized
               /\ newRec' = "done" /\ ref' = "new" /\ oldRec' = "tomb" /\ newUses' = uses
               /\ UNCHANGED << uses, registry, consent, badUse, foreignRead >>
\* Non-atomic variant: each step is its own durable write.
Restamp == ~Atomic /\ registry # "A" /\ Authorized /\ oldRec = "live" /\ ref = "old" /\ ref' = "new"
           /\ UNCHANGED << oldRec, newRec, uses, newUses, registry, consent, badUse, foreignRead >>
Create == ~Atomic /\ registry # "A" /\ Authorized /\ newRec = "none" /\ newRec' = "partial"
          /\ UNCHANGED << oldRec, ref, uses, newUses, registry, consent, badUse, foreignRead >>
DropOld == ~Atomic /\ oldRec = "live" /\ newRec # "none" /\ oldRec' = "gone"
           /\ UNCHANGED << newRec, ref, uses, newUses, registry, consent, badUse, foreignRead >>
Finish == ~Atomic /\ newRec = "partial" /\ newRec' = "done" /\ newUses' = uses
          /\ UNCHANGED << oldRec, ref, uses, registry, consent, badUse, foreignRead >>

\* The credential is used or read by the running registry.
Use == ((ref = "old" /\ oldRec = "live") \/ (ref = "new" /\ newRec = "done"))
       /\ Authorized /\ (consent = registry \/ ~ConsentBound)
       /\ badUse' = (badUse \/ consent # registry)
       /\ foreignRead' = (foreignRead \/ registry = "X")
       /\ UNCHANGED << oldRec, newRec, ref, uses, newUses, registry, consent >>
Done == UNCHANGED vars

Next == Upgrade \/ Stranger \/ Approve \/ AdoptAtomic \/ Restamp \/ Create \/ DropOld \/ Finish \/ Use \/ Done

TypeOK == oldRec \in {"live", "tomb", "gone"} /\ newRec \in {"none", "partial", "done"} /\ ref \in {"old", "new"}
          /\ registry \in {"A", "B", "X"} /\ consent \in {"A", "B", "X", "none"}
\* The credential stays reachable in every state, so a crash anywhere loses nothing.
SecretReachable == (ref = "old" => oldRec \in {"live", "tomb"}) /\ (ref = "new" => newRec = "done")
\* A live route's use record survives somewhere that still guards the configuration.
UseRecordKept == uses = 1 => (oldRec # "gone" \/ newUses = 1)
NoUseWithoutConsent == ~badUse
NoForeignRead == ~foreignRead
====
