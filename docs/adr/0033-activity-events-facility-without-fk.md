# Activity events reference facilities without a foreign key

**Status: Accepted** (2026-10-15).

The [database org-scoping rule](../database.md#org-scoping--the-contract) requires a composite facility foreign key, but an activity insert's FK check takes `KEY SHARE` on the facility at the end of every save. Facility archive/restore lock the facility before its children, while a save can already hold child locks when it records activity. This lock cycle caused PostgreSQL deadlocks (`40P01`) observed in `tests/operation-lab-samples-concurrency.test.ts`.

## Decision

- Keep no FK on `activity_events.facility_id`, as approved by the owner.
- `recordActivity` checks same-org facility ownership through `requireOrgFacility` using the caller's transaction and a non-locking read. Archived facilities remain valid references.
- Facilities are never hard-deleted.

## Consequences

- Every facility-referencing activity insert must go through `recordActivity` to enforce same-org ownership.
- Re-adding the FK requires every writer to lock the facility first, or archive/restore to change their lock order.
