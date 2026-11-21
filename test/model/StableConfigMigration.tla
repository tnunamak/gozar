---------- MODULE StableConfigMigration ----------
EXTENDS Naturals, FiniteSets

CONSTANTS Atomic,         \* TRUE: one durable write creates the stable record, re-stamps refs and tombstones the old record (the code)
          ConsentBound,   \* TRUE: using a credential needs consent minted for the running registry (consent scope carries registryId)
          LineageChecked, \* TRUE: only a registry that owns the old scope (published or host-declared lineage) may adopt it
          ClaimFirst,     \* TRUE: the durable claim is renamed BEFORE any credential read; FALSE: adoption lives in memory during a read-only resolve
          UseGuarded,     \* TRUE: adoption is refused while an earlier registry's route reservation exists; FALSE: the reservation is copied
          SchemaChecked,  \* TRUE: adoption needs the provider's CURRENT declaration to name the saved input with the same role
          Retired         \* TRUE: the claim leaves the old record DATA-FREE (no bindings, no values, a fresh revision, `migratedTo`); the
                         \* current SDK refuses it and the original 0.4.0 resolver finds nothing in it. FALSE: the old record keeps the bindings

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
          badUse, foreignRead,
          oldHolds,   \* what the OLD record holds: "carried" (the migrated bindings) | "none" (data-free tombstone) | "fresh" (bindings a rollback writer saved itself)
          aRead       \* the original 0.4.0 writer (registry A) was handed the carried credential AFTER the claim

vars == << oldRec, newRec, ref, route, oldUses, newUses, registry, consent, claimed, schema, readers, badUse, foreignRead, oldHolds, aRead >>

Init == oldRec = "live" /\ newRec = "none" /\ ref = "old" /\ route \in BOOLEAN /\ oldUses = (IF route THEN 1 ELSE 0) /\ newUses = 0
        /\ registry = "A" /\ consent = "A" /\ claimed = "none" /\ schema \in {"match", "missing", "role"} /\ readers = {}
        /\ badUse = FALSE /\ foreignRead = FALSE /\ oldHolds = "carried" /\ aRead = FALSE

Authorized == registry \in {"A", "B", "C"} \/ ~LineageChecked   \* A, B, C share the declared lineage; X does not
SchemaOK == ~SchemaChecked \/ schema = "match"
UseOK == ~UseGuarded \/ oldUses = 0
\* A successor may adopt only an unclaimed, live, compatible record with no live reservation (the durable claim is the "taken" check).
Eligible == registry # "A" /\ Authorized /\ SchemaOK /\ UseOK /\ oldRec = "live" /\ newRec = "none" /\ claimed = "none"

Switch(r) == registry # r /\ registry' = r /\ UNCHANGED << oldRec, newRec, ref, route, oldUses, newUses, consent, claimed, schema, readers, badUse, foreignRead, oldHolds, aRead >>
Restart == \E r \in {"A", "B", "C", "X"} : Switch(r)
Approve == consent' = registry /\ UNCHANGED << oldRec, newRec, ref, route, oldUses, newUses, registry, claimed, schema, readers, badUse, foreignRead, oldHolds, aRead >>

\* The route made through the earlier registry ends and its exact handle is released from the record that holds it.
Release == route /\ route' = FALSE /\ oldUses' = 0
           /\ UNCHANGED << oldRec, newRec, ref, newUses, registry, consent, claimed, schema, readers, badUse, foreignRead, oldHolds, aRead >>

AdoptAtomic == Atomic /\ Eligible
               /\ newRec' = "done" /\ ref' = "new" /\ oldRec' = "tomb" /\ newUses' = (IF UseGuarded THEN 0 ELSE oldUses) /\ claimed' = registry /\ oldHolds' = (IF Retired THEN "none" ELSE oldHolds)
               /\ UNCHANGED << route, oldUses, registry, consent, schema, readers, badUse, foreignRead, aRead >>
\* Non-atomic variant: each step is its own durable write.
Restamp == ~Atomic /\ registry # "A" /\ Authorized /\ oldRec = "live" /\ ref = "old" /\ ref' = "new"
           /\ UNCHANGED << oldRec, newRec, route, oldUses, newUses, registry, consent, claimed, schema, readers, badUse, foreignRead, oldHolds, aRead >>
Create == ~Atomic /\ registry # "A" /\ Authorized /\ newRec = "none" /\ newRec' = "partial" /\ claimed' = registry
          /\ UNCHANGED << oldRec, ref, route, oldUses, newUses, registry, consent, schema, readers, badUse, foreignRead, oldHolds, aRead >>
DropOld == ~Atomic /\ oldRec = "live" /\ newRec # "none" /\ oldRec' = "gone"
           /\ UNCHANGED << newRec, ref, route, oldUses, newUses, registry, consent, claimed, schema, readers, badUse, foreignRead, oldHolds, aRead >>
Finish == ~Atomic /\ newRec = "partial" /\ newRec' = "done" /\ newUses' = oldUses
          /\ UNCHANGED << oldRec, ref, route, oldUses, registry, consent, claimed, schema, readers, badUse, foreignRead, oldHolds, aRead >>

\* Credential bytes reach the running registry. The claimant reads its durable record; with a read-only resolve that adopts only
\* in memory (ClaimFirst = FALSE) an unclaimed eligible successor reads too, and nothing records that it did.
ReadBytes == /\ \/ (registry = "A" /\ ref = "old" /\ oldRec = "live")
                \/ (registry = "A" /\ oldRec = "tomb" /\ oldHolds = "carried")   \* the 0.4.0 resolver ignores `migratedTo`: it reads whatever the old record still holds
                \/ (registry # "A" /\ Authorized /\ ref = "new" /\ newRec = "done" /\ claimed = registry)
                \/ (~ClaimFirst /\ Atomic /\ Eligible)
             /\ (consent = registry \/ ~ConsentBound)
             /\ badUse' = (badUse \/ consent # registry)
             /\ foreignRead' = (foreignRead \/ registry = "X")
             /\ readers' = (IF registry = "A" THEN readers ELSE readers \cup {registry})
             /\ aRead' = (aRead \/ (registry = "A" /\ claimed # "none"))
             /\ UNCHANGED << oldRec, newRec, ref, route, oldUses, newUses, registry, consent, claimed, schema, oldHolds >>
\* Downgrade or rollback: the original writer saves its OWN configuration into the old scope. It cannot put the carried bindings
\* back (the successor holds them) and it never touches the stable record.
RollbackWrite == registry = "A" /\ oldRec = "tomb" /\ oldHolds # "fresh" /\ oldHolds' = "fresh"
                 /\ UNCHANGED << oldRec, newRec, ref, route, oldUses, newUses, registry, consent, claimed, schema, readers, badUse, foreignRead, aRead >>
Done == UNCHANGED vars

Next == Restart \/ Approve \/ Release \/ AdoptAtomic \/ Restamp \/ Create \/ DropOld \/ Finish \/ ReadBytes \/ RollbackWrite \/ Done

TypeOK == oldRec \in {"live", "tomb", "gone"} /\ newRec \in {"none", "partial", "done"} /\ ref \in {"old", "new"}
          /\ registry \in {"A", "B", "C", "X"} /\ consent \in {"A", "B", "C", "X", "none"} /\ claimed \in {"none", "B", "C", "X"}
          /\ oldHolds \in {"carried", "none", "fresh"} /\ aRead \in BOOLEAN /\ readers \subseteq {"B", "C", "X"} /\ oldUses \in {0, 1} /\ newUses \in {0, 1} /\ route \in BOOLEAN
\* The credential stays reachable in every state, so a crash anywhere loses nothing.
SecretReachable == (ref = "old" => oldRec \in {"live", "tomb"} /\ oldHolds = "carried") /\ (ref = "new" => newRec = "done")
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
\* Retirement: once the stable record owns the credential, the registry that wrote the old record is never handed those bytes again
\* (the original 0.4.0 writer after a reopen or rollback, or the current SDK of an earlier registry). The physical secret is not
\* deleted and bytes a trusted old host already read before the claim are not recalled: this states only what the claim stops.
NoOldReadAfterClaim == ~aRead
\* A rollback writer's own bindings are never the carried ones, and the successor keeps its record whatever the old writer does.
RollbackIsolated == oldHolds = "fresh" => newRec = "done" /\ ref = "new"
====
