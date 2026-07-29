# A registry GHG statement's local identity is scoped per organization and facility

> **Current status: Accepted and implemented** (reviewed 2026-07-29).
> The schema owns the organization/facility-scoped remote identity and the
> GHG-statement-specific submission-ledger unique index in
> `src/db/schema/certification.ts`. Facility-identity and reconciliation
> behavior is covered by `tests/ghg-statement-facility-identity.test.ts`.

Historical status: accepted (2026-07-25)

A **GHG Statement** discovered in (or created against) the Isometric registry is
mirrored by a `certifier_ghg_statements` row whose identity key is now
`(provider, organization_id, facility_id, metadata->>'remoteExternalId')`. The
same registry statement id may therefore appear once per facility — and once per
tenant — instead of once globally. The submission ledger follows: for
`submission_type = 'ghg_statement'`, remote-id uniqueness is scoped to
`(provider, organization_id, local_entity_id, external_id)` rather than the
table-wide `(provider, submission_type, external_id)` rule every other
submission type keeps.

This resolves a contradiction between two deliberate earlier decisions. Migration
`0016` dropped `certifier_projects`' `(provider, external_project_id)` unique
constraint on purpose: real operators register several physical sites under one
Isometric project, because Isometric's data model has no facility concept. But
migration `0091` then made statement identity **globally** unique per provider —
not scoped by facility, and not even by organization. The two cannot both hold.
In practice the global key meant that once a registry statement was imported
under facility A, facility B could never import it; unlinking A did not release
it, because `deleteCertifierProject` removes only the `certifier_projects` row
and never touches `certifier_ghg_statements`. The unscoped key was also a
cross-tenant collision surface: two organizations could not hold the same
registry id at all.

[ADR 0004](./0004-ghg-statement-as-independent-artifact.md) remains **accepted
and unchanged**. Its `certifier_ghg_statements_facility_period_unique` invariant
— one GHG statement per `(provider, facility, reporting-period end)` — is
untouched, as is the idempotency of `getOrCreateGhgStatementDraft`. This ADR
narrows a *different* key: the registry-discovery identity introduced later,
which ADR 0004 does not describe.

## Considered options

- **Per (organization, facility) identity (chosen).** Each facility keeps its
  own local mirror of a shared registry statement, and each tenant is isolated.
  It is the smallest key that makes shared projects and statement identity
  consistent, it needs no change to ADR 0004's period constraint, and removals
  keep linking to their own facility's local row — so nothing about membership
  reconciliation, the `FOR UPDATE` no-steal rule, or the facility guard in
  `reconcileRemovalMembership` has to move.
- **Scope identity by Isometric project instead.** One local row per
  `(provider, external_project_id, remote id)`, shared by every facility on that
  project. Closer to Isometric's own model, but it would **supersede ADR 0004**:
  a project-scoped statement cannot also be facility-scoped, so the
  facility-period constraint, the facility-anchored ledger key, and every
  facility-scoped read (`listGhgStatementsForFacility`, the mapping lock's
  `facilityId` guard) would all have to be re-cut. Rejected as a much larger
  change to close a bounded bug.
- **Re-home the local row when a project is re-linked.** Keep the global key and
  transfer the existing `certifier_ghg_statements` row to the new facility on
  unlink/relink. Rejected: it rewrites history (a statement's facility is part
  of what was submitted), it silently mutates rows that removals already point
  at, and it still leaves two facilities *simultaneously* sharing one project
  unable to both hold the statement.

## Consequences

- A shared Isometric project yields **one local row per facility** for the same
  registry statement. That is intended: each facility's row carries its own
  reporting window, its own ledger row, and its own linked removals. Operators
  reading the registry's total will see it once; noma shows it per site.
- `getSubmissionByExternalId` is ambiguous for GHG statements and must not be
  used on that path. `getGhgStatementSubmissionForFacility`
  (`src/data-access/certifier-ghg-statements.ts`) is the facility-scoped
  replacement, and every reconcile path asks "does *this* facility hold this
  remote statement?" rather than "does anyone?".
- Registry sync no longer silently drops a remote statement owned by another
  facility's local row. Ownership is re-tested against the same
  membership/unique-project heuristics as a fresh discovery, and **every** skip
  is counted (`ReconcileRegistryGhgStatementsResult.skippedCount`) and surfaced
  in the sync toast, so "synced 0" is distinguishable from "nothing to do".
- `cert_submissions_external_unique` becomes a *partial* index excluding
  `ghg_statement`. Removals, telemetry, and documents keep the original global
  rule — a Removal belongs to exactly one facility, so nothing legitimate
  collides there.
- Migration `0093` is index-only and non-destructive to data: it drops and
  recreates the two unique keys. Pre-existing rows satisfy the wider keys by
  construction, so no backfill is needed.
