# Shared schema with organizationId on every domain table

Multi-tenancy (one Organization per biochar operator, each owning its
facilities, users, and master data) is implemented as a **shared
database with an `organizationId NOT NULL` column on every domain
table**, enforced in the `data-access/` layer — not database-per-tenant,
not schema-per-tenant, and not "column on root tables only, derive for
children via joins".

The column is deliberately denormalized (a production run's org is also
derivable through its facility) because the enforcement point is ~211
data-access functions checked by convention: a uniform, greppable
`WHERE organizationId = ctx.orgId` is auditable; per-table bespoke join
chains are not, and that class of missed-join leak has already occurred
once (`getSupplierOptions`). `organizationId` is always stamped
server-side from the session's active organization, never accepted from
client input.

## Considered options

- **Database/schema-per-tenant** — rejected: N migration targets, N
  pools, N Isometric configs for a handful of clients; ops burden far
  exceeds the isolation benefit.
- **Org column on roots only, derived for children** — rejected: every
  child query gets a structurally different authz join; unauditable at
  this call-site count.
- **Postgres RLS now** — deferred, not rejected: the chosen schema is
  RLS-ready with zero schema change, so RLS can be added later as
  defense-in-depth if a client requires hard isolation guarantees.
  No tooling blocker: Drizzle has first-class RLS on our pinned versions
  (`pgPolicy` since drizzle-kit 0.27 auto-enables RLS on the table) —
  adopting it is a policy-design task, not an upgrade
  (verified 2026-06-12, https://orm.drizzle.team/docs/rls).

## Consequences

- Nothing is shared across Organizations — including catalogs like
  `feedstockTypes`; new Organizations are seeded with a starter set.
- Platform Admins bypass org-membership checks (full read/write
  override); org isolation is policy toward other organizations, not
  toward the platform.
