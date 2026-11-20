---------- MODULE StableConfigMigration ----------
EXTENDS Naturals, FiniteSets

CONSTANTS Atomic,         \* TRUE: one durable write creates the stable record, re-stamps refs and tombstones the old record (the code)
          ConsentBound,   \* TRUE: using a credential needs consent minted for the running registry (consent scope carries registryId)
          LineageChecked, \* TRUE: only a registry that owns the old scope (published or host-declared lineage) may adopt it
          ClaimFirst,     \* TRUE: the durable claim is renamed BEFORE any credential read; FALSE: adoption lives in memory during a read-only resolve
          UseGuarded,     \* TRUE: adoption is refused while an earlier registry's route reservation exists; FALSE: the reservation is copied
          SchemaChecked   \* TRUE: adoption needs the provider's CURRENT declaration to name the saved input with the same role

(*
  One old configuration (stored under a registry-hashed scope) with one credential and, possibly, one live route reservation.
  Two successor lineages B and C both declare that they replace A; X is an unrelated registry. The saved input may or may not
  still exist, with the same role, in the provider's current declaration. Every reachable state is a possible crash point (a
  write is atomic: it either happened or it did not), so an invariant that holds in every state is crash safety.
  Questions: can a crash lose the binding, can a stranger or a rival successor read the bytes, can bytes be read before a
  durable claim exists, can a credential be released to a provider that no longer declares it, and can the stable record
  stay in use after the route that used it is gone.
*)

VARIABLES oldRec,     \* "live" | "tomb" | "gone"
          newRec,     \* "none" | "partial" | "done"
          ref,        \* which scope the secret metadata names: "old" | "new"
          route,      \* the live route made through the earlier registry still exists
          oldUses,    \* its reservation on the old record: 1 | 0
          newUses,    \* a reservation on the stable record: 1 | 0
          registry,   \* running registry: "A" (wrote the old config) | "B" | "C" (successor lineages) | "X" (unrelated custom)
          consent,    \* registry the user last approved
          claimed,    \* durable custodian of the stable record: "none" | "B" | "C" | "X"
          schema,     \* the provider's current declaration of the saved input: "match" | "missing" | "role"
          readers,    \* successor registries that were handed credential bytes
          badUse, foreignRead

vars == << oldRec, newRec, ref, route, oldUses, newUses, registry, consent, claimed, schema, readers, badUse, foreignRead >>

Init == oldRec = "live" /\ newRec = "none" /\ ref = "old" /\ route \in BOOLEAN /\ oldUses = (IF route THEN 1 ELSE 0) /\ newUses = 0
        /\ registry = "A" /\ consent = "A" /\ claimed = "none" /\ schema \in {"match", "missing", "role"} /\ readers = {}
        /\ badUse = FALSE /\ foreignRead = FALSE

Authorized == registry \in {"A", "B", "C"} \/ ~LineageChecked   \* A, B, C share the declared lineage; X does not
SchemaOK == ~SchemaChecked \/ schema = "match"
UseOK == ~UseGuarded \/ oldUses = 0
\* A successor may adopt only an unclaimed, live, compatible record with no live reservation (the durable claim is the "taken" check).
Eligible == registry # "A" /\ Authorized /\ SchemaOK /\ UseOK /\ oldRec = "live" /\ newRec = "none" /\ claimed = "none"

Switch(r) == registry # r /\ registry' = r /\ UNCHANGED << oldRec, newRec, ref, route, oldUses, newUses, consent, claimed, schema, readers, badUse, foreignRead >>
Restart == \E r \in {"A", "B", "C", "X"} : Switch(r)
Approve == consent' = registry /\ UNCHANGED << oldRec, newRec, ref, route, oldUses, newUses, registry, claimed, schema, readers, badUse, foreignRead >>

\* The route made through the earlier registry ends and its exact handle is released from the record that holds it.
Release == route /\ route' = FALSE /\ oldUses' = 0
           /\ UNCHANGED << oldRec, newRec, ref, newUses, registry, consent, claimed, schema, readers, badUse, foreignRead >>

AdoptAtomic == Atomic /\ Eligible
               /\ newRec' = "done" /\ ref' = "new" /\ oldRec' = "tomb" /\ newUses' = (IF UseGuarded THEN 0 ELSE oldUses) /\ claimed' = registry
               /\ UNCHANGED << route, oldUses, registry, consent, schema, readers, badUse, foreignRead >>
\* Non-atomic variant: each step is its own durable write.
Restamp == ~Atomic /\ registry # "A" /\ Authorized /\ oldRec = "live" /\ ref = "old" /\ ref' = "new"
           /\ UNCHANGED << oldRec, newRec, route, oldUses, newUses, registry, consent, claimed, schema, readers, badUse, foreignRead >>
Create == ~Atomic /\ registry # "A" /\ Authorized /\ newRec = "none" /\ newRec' = "partial" /\ claimed' = registry
          /\ UNCHANGED << oldRec, ref, route, oldUses, newUses, registry, consent, schema, readers, badUse, foreignRead >>
DropOld == ~Atomic /\ oldRec = "live" /\ newRec # "none" /\ oldRec' = "gone"
           /\ UNCHANGED << newRec, ref, route, oldUses, newUses, registry, consent, claimed, schema, readers, badUse, foreignRead >>
Finish == ~Atomic /\ newRec = "partial" /\ newRec' = "done" /\ newUses' = oldUses
          /\ UNCHANGED << oldRec, ref, route, oldUses, registry, consent, claimed, schema, readers, badUse, foreignRead >>

\* Credential bytes reach the running registry. The claimant reads its durable record; with a read-only resolve that adopts only
\* in memory (ClaimFirst = FALSE) an unclaimed eligible successor reads too, and nothing records that it did.
ReadBytes == /\ \/ (registry = "A" /\ ref = "old" /\ oldRec = "live")
                \/ (registry # "A" /\ Authorized /\ ref = "new" /\ newRec = "done" /\ claimed = registry)
                \/ (~ClaimFirst /\ Atomic /\ Eligible)
             /\ (consent = registry \/ ~ConsentBound)
             /\ badUse' = (badUse \/ consent # registry)
             /\ foreignRead' = (foreignRead \/ registry = "X")
             /\ readers' = (IF registry = "A" THEN readers ELSE readers \cup {registry})
             /\ UNCHANGED << oldRec, newRec, ref, route, oldUses, newUses, registry, consent, claimed, schema >>
Done == UNCHANGED vars

Next == Restart \/ Approve \/ Release \/ AdoptAtomic \/ Restamp \/ Create \/ DropOld \/ Finish \/ ReadBytes \/ Done

TypeOK == oldRec \in {"live", "tomb", "gone"} /\ newRec \in {"none", "partial", "done"} /\ ref \in {"old", "new"}
          /\ registry \in {"A", "B", "C", "X"} /\ consent \in {"A", "B", "C", "X", "none"} /\ claimed \in {"none", "B", "C", "X"}
          /\ readers \subseteq {"B", "C", "X"} /\ oldUses \in {0, 1} /\ newUses \in {0, 1} /\ route \in BOOLEAN
\* The credential stays reachable in every state, so a crash anywhere loses nothing.
SecretReachable == (ref = "old" => oldRec \in {"live", "tomb"}) /\ (ref = "new" => newRec = "done")
\* A live route's reservation survives somewhere that still guards the configuration.
UseRecordKept == oldUses = 1 => (oldRec # "gone" \/ newUses = 1)
\* The stable record is never held by a route that no longer exists (an old release cannot strand it).
NoPhantomUse == ~route => newUses = 0
NoUseWithoutConsent == ~badUse
NoForeignRead == ~foreignRead
\* Bytes go only to the one registry that holds a durable claim: no read before a claim, never two readers.
OnlyClaimantReads == readers # {} => (claimed # "none" /\ readers = {claimed})
\* Bytes never go to a successor when the provider's current declaration lacks the input or changed its role.
NoSchemaMismatchRead == readers # {} => schema = "match"
====
