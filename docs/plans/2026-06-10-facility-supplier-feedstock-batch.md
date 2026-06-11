# Plan — facility / supplier / feedstock feature batch

**Opened:** 2026-06-10 · **Status:** E ✅ · C ✅ · B ✅ · D ⬜ · A ⬜

Five independent workstreams, each shipped on its own branch off `staging` as a
separate PR. Sequence: **E → C → B → D → A**. E, C, and B are done; D, A remain.

## Locked decisions

1. **Facility "delete" → cascading ARCHIVE** (soft-delete, reversible). Archiving a
   facility also archives attached child data; nothing is physically removed.
2. **Lightweight Isometric connector** in the facility form (pick project → write
   `externalProjectId`; advanced binding stays in Certification Settings).
3. **Browse-only** Isometric feedstock types (read-only, no local record, no import).
4. **Per-location distance + `is_default`** on both suppliers and customers (parity).
5. **Delivery distance override lives on the delivery record** (`deliveries`).
6. **Archive = allow-with-warning** when a facility has submitted Isometric removals
   (confirm dialog warns; archive stays reversible). Not a hard block.

## Status detail

### E. Feedstock bin quick-add polish — ✅ DONE
Branch `feat/feedstock-bin-quickadd-polish`, commit `f24a8f6` (off `staging`, not
pushed). No migration. Bin-type picker restricted to feedstock/ingredient bins in
the feedstock quick-add flow, per-type descriptions, `feedstockTypeId` required for
feedstock/ingredient bins (pre-filled from parent feedstock), threaded through the
quick-add fn → insert (previously-dropped `formulationId` also fixed).

### C. Supplier/customer location model — ✅ DONE
Branch `feat/location-distance-and-default`, commit `6a6cf05` (off `staging`, not
pushed). Migration `drizzle/0039_true_hellfire_club.sql` (generated, **not applied
locally**). Added `supplier_locations.distance_from_facility_km`, `is_default` on
both location tables (one-default-per-party via partial unique index, transactional
promote/demote, first location auto-defaults), `deliveries.distance_km_override` +
`distance_note`. GPS made required on both location forms + inline/quick-add
creators. Supplier form reordered (GPS + address above the renamed "Default distance
to facility"). Delivery form gained a Transport section. Docs updated
(`docs/schema-overview.md`); deferred follow-up logged in `docs/open-questions.md`
("Wire per-location / per-delivery distance into transport-leg derivation").

### B. Facility-form Isometric connector — ✅ DONE
Branch `feat/facility-isometric-connector`, commit `47a595c` (off `staging`, not
pushed). No migration. New `FacilityIsometricConnector`
(`components/certification/facility-isometric-connector.tsx`) rendered in
`facility-form.tsx` edit mode, between "Default Durability Option" and the buttons.
Admin-only (returns null otherwise — save is admin-gated server-side); reuses
`useFacilityCertifierMapping` / `useSaveFacilityCertifierMapping` →
`saveFacilityCertifierMapping` → `upsertCertifierProject`, so all server guards
(project existence, submission-pinned mappings, production confirm) apply. Carries
over the shared-project ack + production opt-in from `FacilityCertifierDialog`;
changing project clears template/fcl_ id with an inline warning. Added
`isConfigured` to the `FacilityCertifierMapping` payload (distinguishes missing
credentials from an empty project list → disabled empty-state). "Advanced binding →
Certification Settings ↗" link in the section header.

### D. Feedstock-type General/Isometric tabs — ⬜ no migration
Tabbed `components/feedstock-types/feedstock-type-form.tsx`: **General** (existing,
minus the Registry URL field) + **Isometric** (read-only browse). Build
`listFeedstockTypes()` in `lib/isometric/` — `GET /feedstock_types` exists in
`lib/isometric/generated/certify.d.ts` but has no wrapper → `fn/` → hook →
read-only list (name, category, id), gated on the selected facility being connected.
Browse-only. The `feedstock_types.registry_url` column + `CreateFeedstockTypeData.registryUrl`
stay; removing the form field is UI-only.

### A. Facility cascading archive — ⬜ biggest, own PR, do last
Add `archived_at timestamptz NULL` (+ maybe `archived_by`) to `facilities` + the 15
directly-facility-scoped tables; grandchildren hidden transitively via archived
parent (no own column) unless proven wrong. Replace the existing block-on-children
`deleteFacility` (`data-access/facilities.ts`, `fn/facilities.ts`,
`useDeleteFacility`, `components/facilities/facility-list.tsx`) with `archiveFacility`
(stamps facility + descendants in one tx) + `restoreFacility`. **Laborious/risky
part:** add `AND archived_at IS NULL` to every list/picker query across
`data-access/*`; `FacilityContext` + facility pickers skip archived — keep this
sweep isolated. Archive-with-warning when registry removals exist (decision 6). Add
an e2e guard that archived facilities/children disappear from lists. Reseed, not
backfill.

## ⚠️ Hazards (carried from this session — read before editing)

- **Unrelated map/sensor WIP lives uncommitted in the working tree** — do NOT touch,
  stage, or revert: `src/db/schema/common.ts` (adds `sensor_data` enum value),
  `src/schemas/documents.ts`, `src/components/production-runs/production-run-form.tsx`,
  `src/components/production-runs/production-readings-documents.tsx`, `docs/storage.md`,
  `.claude/CLAUDE.md`, `docs/adr/0009-…geo.md`, `docs/plans/2026-06-10-map-integration.md`.
- **Migration contamination:** `common.ts`'s `sensor_data` change leaks an
  `ALTER TYPE … ADD VALUE 'sensor_data'` line into any `pnpm db:generate`. Before
  generating the A migration:
  `git stash push -m "park foreign sensor_data" -- src/db/schema/common.ts`, run
  `db:generate`, `cat` the SQL to confirm it contains only your changes, then
  `git stash pop`. (`db:generate` reads only `src/db/schema`, so stashing that one
  file de-contaminates fully.)
- **Always `git add` by explicit path**, never `git add -A`, so foreign WIP never
  lands in a commit.
- **Parked stash:** `stash@{0}` (registry-reconcile WIP, 5 files) on branch
  `refactor/registry-reconcile-and-pg-unique-helper` — the user's; leave it.

## Project rules worth re-stating

- `pnpm` only. Layered: component → hooks → fn → data-access → db. Every
  `data-access` fn calls an auth guard; `fn/` has `"use server"` + Zod, returns
  `ActionResult<T>`. Not live → reseed over careful migrations.
- Forms: use `@/schemas/helpers` (`requiredLatitudeSchema` etc.), never inline
  preprocess. For `z.preprocess` form schemas, call `useForm` WITHOUT the generic and
  cast at submit (else RHF Resolver type errors — hit in C).
- The deliveries data-access uses a runtime column-availability guard
  (`getDeliveryColumnAvailability`) — extend it for any new `deliveries` column.
- Commit/push only when asked. Branch `<type>/<kebab>`, commit titles
  `<type>: <lowercase imperative>`.

## Suggested skills for the remaining workstreams

- `/modify-feature` per workstream (B/D/A each extend an existing feature).
- `/add-migration` for A (mind the stash dance), then reseed.
- `/add-e2e-test` for A's archive/restore guard.
- `isometric` MCP `how_to` tool + `docs/isometric/README.md` before B and D.
