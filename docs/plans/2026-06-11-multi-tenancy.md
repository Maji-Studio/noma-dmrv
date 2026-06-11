# Multi-Tenancy: Organizations, Members, and Org-Scoped Data

**Date:** 2026-06-11 · **Status:** planned · **Decisions:** ADR 0010,
CONTEXT.md (Organization / Platform Admin / Member) · **Resolves:**
`auth/facility-access-model` open question (removed 2026-06-11)

## Goal

Onboard multiple biochar operator companies ("clients") onto one noma
deployment. Each **Organization** gets its own org-scoped app (dashboard
and all workflows show only its data) and manages its own users. The
platform (Maji / Dark Earth staff) manages Organizations and may enter
any org's workspace.

## Decisions (from the 2026-06-11 grilling session)

| # | Decision | Choice |
|---|---|---|
| 1 | Tenant term & shape | **Organization** owns 1..N facilities; never "client" in code |
| 2 | Platform level | Global `admin` role becomes **Platform Admin**: full lifecycle control **and** full read/write override inside any org |
| 3 | User↔org cardinality | Membership table (multi-org possible, treated as edge case; single-org UX is the default) |
| 4 | Org roles | **Owner / Admin / Member** (Better Auth org-plugin defaults). Registry-facing submissions: Admin-and-up |
| 5 | Data boundary | **Uniform: every domain row belongs to exactly one org.** Nothing shared, incl. `feedstockTypes` (orgs get a seeded starter catalog) |
| 6 | Auth tooling | Better Auth **organization plugin** (orgs, members, invitations, active org on session) |
| 7 | Scoping shape | `organizationId NOT NULL` on every domain table, enforced in `data-access/`; RLS deferred (ADR 0010) |
| 8 | Active org | Session `activeOrganizationId`, **flat routes unchanged**; org switcher only for multi-org users + Platform Admins |
| 9 | Dashboard | Org-scoped app + org name/logo in chrome. White-label deferred (open-questions) |
| 10 | Onboarding | Org creation **Platform-Admin-only** (plugin self-serve creation disabled); org Owner/Admins invite their own users; `ALLOW_SELF_SIGNUP` stays false |
| 11 | Registry creds | **Per-org Isometric credentials at launch** (each client has their own Isometric account). Encrypted DB table, entered by Platform Admin during onboarding. `ISOMETRIC_ENVIRONMENT` + upload allowlist stay global |
| 12 | Rollout | Not live → **reseed, don't backfill**: seed creates a "Dark Earth Carbon" org owning all existing seed data |

## 1. Schema

### 1.1 Auth-side (Better Auth organization plugin) — `src/db/schema/auth.ts`

Plugin-managed tables (generate via Better Auth schema CLI, then port to
Drizzle like the existing auth tables):

- `organizations` — id, name, slug, logo, metadata, createdAt
- `members` — id, organizationId, userId, role (`owner|admin|member`), createdAt
- `invitations` — id, organizationId, email, role, status, expiresAt, inviterId
- `sessions` gains `activeOrganizationId`

`users.role` keeps its current meaning, recast: `admin` = **Platform
Admin**, `user` = ordinary user whose powers come entirely from
memberships. `ensure-admin` CLI continues to bootstrap the Platform
Admin from `ADMIN_EMAIL`.

### 1.2 Domain tables — `organizationId` on every table (ADR 0010)

Add `organizationId: text NOT NULL REFERENCES organizations(id)` +
index to **all ~30 domain tables** across the schema files.
**`text`, not `uuid`:** Better Auth generates string IDs and every
existing auth table (`src/db/schema/auth.ts`) uses `text` PKs; the
plugin-generated `organizations.id` will too. Domain tables keep their
uuid PKs — only the org FK is text. (Alternative — forcing Better Auth
ID generation to UUID — rejected: touches all auth tables for no gain.)

- `facilities.ts`: facilities, reactors, storageLocations
- `parties.ts`: suppliers, customers, customerLocations, supplierLocations, drivers, operators
- `feedstock.ts`: feedstockTypes, feedstockDeliveries, feedstocks
- `production.ts`: productionRuns, productionRunReadings, samples, incidentReports, productionRunFeedstocks, productionSamples
- `products.ts`: formulations, formulationIngredients, biocharProducts
- `logistics.ts`: vehicles, orders, deliveries, transportLegs
- `application.ts`: applications, soilTemperatureMeasurements
- `credits.ts`: creditBatches, creditBatchApplications
- `compliance.ts`: stockpileEvents, powerProcurementEvidence
- `storage-inventory.ts`: biocharStorageInventory
- `documentation.ts`: documents
- `certification.ts`: certifierProjects, certifierSensors, certifierProjectEmissions, certifierGhgStatements, certifierRemovals, certificationSubmissions, certifierDocumentUploads, certifierSyncEvents

Rules:
- Stamped **server-side from the session's active org** on create —
  never accepted from client input; never in Zod form/action schemas.
- Unique constraints that are business keys become org-scoped where
  appropriate (e.g. `facilities.code` unique → unique per
  `(organizationId, code)`; same review for feedstock codes, party
  codes). Sweep every `unique()` in the schema files.
- **Cross-org FK integrity (required, not optional).** Stamping
  `organizationId` from the session is not enough: an insert/update can
  be stamped Org A while a supplied `facilityId`/`productId`/`customerId`
  points at Org B's row. Every client-supplied FK must be proven to
  belong to `ctx.organizationId`, via one of:
  - composite FK `(fkId, organizationId)` → `parent(id, organizationId)`
    (parent gets a `UNIQUE (id, organization_id)` to target) — use on
    hot paths: productionRuns, creditBatches, certifierProjects, orders,
    deliveries, applications;
  - `assertSameOrg(ctx, table, id)` data-access helper (one indexed
    lookup) for the long tail. The CI scoping check (§2.3) also flags
    inserts/updates whose FK inputs have neither.

### 1.3 Registry credentials — `certification.ts`

```text
certifierCredentials
  id uuid PK
  organizationId text NOT NULL → organizations
  provider certifier_provider NOT NULL
  accessTokenEncrypted text NOT NULL
  clientSecretEncrypted text NOT NULL
  createdAt / updatedAt
  UNIQUE (organizationId, provider)
```

- AES-256-GCM via new `src/lib/crypto/secrets.ts`, keyed by a new env
  var `CREDENTIALS_ENCRYPTION_KEY` (32+ bytes, Zod-validated in
  `env.ts`, sourced from 1Password like all secrets).
- Global `ISOMETRIC_ACCESS_TOKEN` / `ISOMETRIC_CLIENT_SECRET` are
  retired as runtime config. The seed script reads them (if present) to
  populate the Dark Earth org's credentials in dev. `env.ts`
  both-or-neither rule moves to the seed path. `ISOMETRIC_ENVIRONMENT`
  and `ISOMETRIC_UPLOAD_HOST_ALLOWLIST` stay global.
- Never returned to the client; admin UI shows set/not-set + last-4
  only. Logger redaction already covers `token`/`secret` keys.

## 2. Auth layer

### 2.1 Plugin config — `src/lib/auth/better-auth.ts`

- Enable `organization` plugin: roles owner/admin/member; **creation
  restricted to Platform Admins** (`allowUserToCreateOrganization: false`
  / creation guarded server-side); invitation expiry ~7 days;
  `sendInvitationEmail` wired to the existing Resend setup (console
  fallback in dev, no PII in logs).
- Session hook: on sign-in, if the user has exactly one membership,
  auto-set `activeOrganizationId`. Multi-org users land on a chooser.
- Platform Admins: active org defaults to none → they pick from the org
  switcher. **The plugin's `setActiveOrganization` rejects non-members**,
  and Platform Admins deliberately have no memberships — so their switch
  goes through a dedicated server action `setActiveOrgAsPlatformAdmin`:
  `requirePlatformAdmin()` → verify org exists & not suspended → write
  `sessions.activeOrganizationId` directly (no shadow memberships;
  membership rows must keep meaning "real org user").

### 2.2 Guards — `src/lib/auth/server.ts` + `src/data-access/utils.ts`

New context object, resolved once per request in `fn/`:

```ts
type OrgContext = {
  userId: string;
  organizationId: string;
  orgRole: "owner" | "admin" | "member" | null; // null for platform-admin override
  isPlatformAdmin: boolean;
};
```

- `requireOrgContext(): Promise<OrgContext>` — session → active org →
  membership lookup. Platform Admin passes without membership
  (override per CONTEXT.md). No active org → redirect to org chooser /
  SafeError in actions.
- `requireOrgRole(ctx, "admin")` — role gate; Owner ⊃ Admin ⊃ Member;
  Platform Admin always passes. Used for member management, org
  settings, and **all registry-facing submissions** (decision #4).
- `requirePlatformAdmin()` — replaces `requireAdmin*` semantics for the
  admin panel (organizations CRUD, credentials, cross-org tools).
- Data-access signature change: every function takes `ctx: OrgContext`
  as its first parameter instead of `userId: string`; the old truthy
  `requireAuth(userId)` is deleted so **every call site fails to
  compile until migrated** — the compiler is the audit.

### 2.3 Enforcement convention (the auditable rule)

Every `data-access/` query on a domain table includes
`eq(table.organizationId, ctx.organizationId)`; every insert stamps
`organizationId: ctx.organizationId`. Add a CI grep/lint check:
no `db.select/insert/update/delete` on a domain table in
`src/data-access/` without `organizationId` in the same statement.
Fixes the known `getSupplierOptions` leak class by construction.

## 3. Server actions (`fn/`)

Each action resolves `const ctx = await requireOrgContext()` (or
`requirePlatformAdmin()`) after Zod validation and passes `ctx` down.
No `organizationId` ever read from action input. `ActionResult<T>`
unchanged.

## 4. Client state & UI

### 4.1 Org switching

- `OrgSwitcher` in the sidebar above `FacilitySelector` — rendered only
  when (memberships > 1) or Platform Admin. Single-org users never see
  tenancy (decision #8).
- On switch: members call plugin `setActiveOrganization`; Platform
  Admins call `setActiveOrgAsPlatformAdmin` (§2.1 — the plugin endpoint
  rejects non-members). Then `queryClient.clear()` + `router.refresh()`,
  and reset facility
  context (stored facility likely belongs to the old org). Keeps
  `organizationId` out of every query key; the nuclear invalidation is
  correct because *all* data changes.
- `FacilityProvider` unchanged in shape — `useFacilities()` now returns
  only the active org's facilities via the scoped data-access.

### 4.2 Org identity

Org name + logo in the sidebar header and dashboard greeting. Logo
upload reuses `<FormFileUpload>` + existing storage flow.

### 4.3 Admin panel (Platform Admin) — `src/app/(app)/admin/`

- `/admin/organizations` — list/create/edit/suspend orgs; per-org
  detail: members, pending invitations, facilities count, registry
  credentials (set/rotate, masked), seed-starter-catalog action.
- `/admin/users` — replace the stub: cross-org user directory,
  invite-to-org, deactivate.
- Suspension = soft flag on organization (blocks members at
  `requireOrgContext`); **no hard org delete** (MRV records are
  audit-relevant).

### 4.4 Org settings (org Owner/Admin) — `/settings/organization`

Members list (role change, remove — plugin enforces last-owner
protection), invite by email + role, pending invitations
(resend/revoke), org profile (name, logo).

### 4.5 Invitation accept flow

`/(auth)/accept-invitation/[id]`. The plugin's `accept-invitation`
endpoint requires an **authenticated session whose email matches the
invite**, while `ALLOW_SELF_SIGNUP` stays false — so the bootstrap is
an explicit server-side sequence in one action:

1. Validate invitation id: pending, unexpired, email taken **from the
   invitation row** (never from client input).
2. No account for that email → create it server-side
   (`auth.api.signUpEmail` with the invitee's chosen name + password);
   the invitation token is the authorization, so this path bypasses the
   `ALLOW_SELF_SIGNUP` gate — gate stays enforced on the public signup
   route only. Existing account → prompt sign-in instead.
3. Establish the session (sign in the new account), then call the
   plugin's accept-invitation → membership activates → set active org →
   land on the org dashboard.

Email via Resend.

## 5. Isometric integration

- Client factory: `getIsometricClientForOrg(organizationId)` decrypts
  `certifierCredentials` and constructs the client; all call paths in
  `src/lib/isometric/` (submissions, ghg-statements, sensors, sources,
  links) resolve the org from the `certifierProject.organizationId`
  they're acting for. No module-level env client remains.
- Webhooks: `certifierProjects.webhookSecret` already per-facility;
  handler resolves org from the matched project row.
- `isometric-health.yml`: read-only ping needs a credential source —
  use the Dark Earth org's sandbox creds via a dedicated env pair
  scoped to the workflow (document in `docs/security.md`).
- Memory note (`certify-live-submit-prereqs`): readiness checks now
  also require org credentials present — add to the readiness
  checklist.

## 6. Seed, migration, E2E

- Migration adds all tables/columns (`pnpm db:generate`). Decision #12
  ("reseed, don't backfill") refers to **data quality**, not migration
  mechanics: `migrate.yml` auto-runs `pnpm db:migrate` on every schema
  push to `staging`/`main`, and a bare `NOT NULL` org column fails on
  any non-empty table before anyone can reset. So the PR-2 migration is
  hand-edited to be **self-sufficient**: insert a bootstrap
  "Dark Earth Carbon" org row (fixed id constant), add columns nullable,
  `UPDATE … SET organization_id = <bootstrap id>`, then `SET NOT NULL`.
  Runs clean on empty *and* populated databases; local/staging still
  follow up with `pnpm db:reset` / `reset-seed-staging` for proper seed
  data, but the auto-migrate job never breaks.
- Seed: create org "Dark Earth Carbon", Platform Admin user (existing
  `ensure-admin`), an org Owner user, all existing seed entities
  stamped with the org id, starter feedstock-type catalog as part of
  org creation (`seedOrgDefaults(organizationId)` — also called from
  admin org-create).
- E2E (`tests/e2e/`): fixtures gain `seededOrg`; `seed-chain-data.ts`
  stamps org ids; auth fixture sets active org after API sign-in. New
  specs:
  - `org-isolation.spec.ts` — **the critical regression test**: user in
    Org B sees none of Org A's facilities/suppliers/runs; direct
    record-URL access 404s; option queries (EntitySelect sources)
    return only org-scoped rows.
  - `org-members.spec.ts` — invite → accept → role change → remove;
    last-owner protection.
  - `admin-organizations.spec.ts` — Platform Admin creates org, enters
    its workspace via switcher, suspends it.

## 7. Documentation updates (same release)

- `docs/auth.md` — replace "single-org / shared-data" section with the
  org model, guards, invitation flow.
- `docs/security.md` — tenancy boundary, Platform Admin override
  (explicit: isolation is policy toward other orgs, not the platform),
  credentials encryption, CI scoping check.
- `docs/schema-overview.md` — new tables + org column convention.
- `.claude/CLAUDE.md` — **fix stale refs** (`requireProjectMember()`,
  `[projectId]` routes — removed in migration 0037); add OrgContext
  guard pattern + "organizationId never in form schemas" rule.
- `CONTEXT.md` / ADR 0010 / open-questions — already updated 2026-06-11.

## 8. Phasing (PR sequence)

1. **`feat: organization foundation`** — plugin + auth tables, guards
   (`requireOrgContext`/`requireOrgRole`/`requirePlatformAdmin`),
   session active-org, org switcher, admin organizations CRUD,
   invitation flow + accept page, org settings page. App still
   functions with a single seeded org.
   **Isolation gate:** until PR 2 lands, a second org would see *shared*
   domain data — so PR 1 ships with second-org creation blocked
   server-side (org-create action refuses when an org already exists,
   with a pointer comment; removed in PR 2). Cheap, compiler-visible,
   and closes the window even if PR 1 deploys alone.
2. **`feat: org-scope domain data`** — `organizationId` on all domain
   tables (self-sufficient migration, §6), data-access signature sweep
   (compiler-driven), cross-org FK integrity (composite FKs +
   `assertSameOrg`, §1.2), unique-key review, seed rework, CI scoping
   check, `org-isolation` E2E, **remove the PR-1 second-org gate**.
   Largest PR; mechanical after #1 defines `OrgContext`.
3. **`feat: per-org registry credentials`** — `certifierCredentials`,
   crypto helper + env key, admin creds UI, isometric client factory,
   readiness-check addition, health-workflow adjustment.
4. **`chore: tenancy docs and polish`** — docs sweep, org identity in
   chrome, deep-link org-mismatch UX for Platform Admins
   ("record belongs to Org X — switch?"), CLAUDE.md fixes.

## 9. Risks & watch items

- **The data-access sweep is the risk center.** Mitigations: compiler
  break via signature change, CI grep, `org-isolation.spec.ts`, and a
  one-time `reviewer-authz`-style audit pass after PR 2.
- **Query-key staleness on org switch** — mitigated by
  `queryClient.clear()`; verify no module-level caches (entity-select
  `seedEntityCache`) survive a switch.
- **Storage keys** are not org-prefixed today; documents are DB-scoped
  by org but object keys are flat. Prefix new uploads with
  `org/<organizationId>/…` in PR 2 (cheap now, painful later).
- **Plugin coupling**: Better Auth org plugin owns invitation/member
  semantics; customizations (platform-admin bypass, creation lock) live
  in our guard layer, not forks of the plugin.
- Deferred (tracked in `docs/open-questions.md`): white-label
  dashboards (`tenancy/white-label`), Postgres RLS (`tenancy/rls`).
