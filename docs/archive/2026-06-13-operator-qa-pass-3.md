# Operator E2E QA — Pass 3 (2026-06-13)

Browser-based operator QA against `http://localhost:3100`, authenticated as Admin
(`kenji@maji.studio`). No auth/authz bypass. Builds on two prior passes:

- `docs/archive/2026-06-13-full-browser-e2e-qa-results.md`
- `docs/archive/2026-06-13-operator-e2e-removal-ghg-plan.md`

In-progress local fixes respected (verify, don't re-report): slide-over offscreen
transform (`slide-over-panel/index.tsx` + `globals.css`), invalid-coordinate map
crash (`position-picker-map.tsx`). Open decision issues **#245 / #246 / #247** are
out of scope for re-reporting.

Goal this pass: a clean fresh-facility → final GHG statement walkthrough, finding
**new** issues (not in the two docs above or the open issue list), thinking like a
real operator under imperfect conditions.

## Edge cases planned before testing

**Auth / navigation / state**
- Fresh tab with no facility selected → dashboard empty state.
- Facility context persistence across sidebar nav, direct URL, refresh, back/forward.
- Stale `?facility=<deleted-or-foreign-id>` query param behavior.
- Browser back after a create; refresh mid-form; navigate away with unsaved edits.

**Forms — validation & boundaries**
- Submit every create form empty → required-field messaging quality.
- Required-field "Required" copy appearing before any interaction (prior UX note).
- Invalid lat/lng (91 / 181, -91 / -181) → confirm position-picker fix holds.
- Numeric boundaries: 0, negative, huge values, decimals where ints expected,
  percentages at 0 / 100 / 100.1 / negative.
- Date boundaries: today, future, reversed start/end, date-only one-day-shift
  regression (prior P0), refresh after date entry.
- Long strings / special chars in name fields; duplicate codes where auto-generated.

**Dependent selects / async**
- Change facility/type/customer parent → dependent select clears.
- "No options" flashing while dependent query still fetching (prior P1).
- Quick-add prerequisite entity then immediately use it.

**Data integrity / removals**
- Edit a record → list + detail refresh without stale rows.
- Delete/archive standalone vs downstream-referenced records.
- Feedstock split allocation over delivered mass; truck weights.
- Mass inconsistencies across delivery/order/application.
- Withdraw more from a bin than it holds (open #116).

**Certification / GHG**
- Unlinked facility hides Removals/GHG nav; direct URL redirects to Settings.
- Emission-estimate readiness vs removal-wizard gate (#246/#247 context).
- Removal wizard blockers actionable?
- GHG statement period overlap / adjacent / reversed ranges.
- GHG submit-to-verifier error surfacing (prior P0 — provider 400 body hidden).
- Zero-removal GHG statement (#245 context).

**Loading / error states**
- Rapid filter changes; refresh during async selector loads.
- Route-level error boundaries on any crash.

## Tested routes

Authenticated, against `QA Pass3 Facility` (`71bf5709-74dc-48ce-86b4-2fd21c4b0a8b`,
FAC-26-003) created fresh this pass. No route-level error boundary on any route.

`/dashboard` · `/facilities` · `/reactors` · `/storage-locations` · `/suppliers` ·
`/feedstocks` · `/production-runs` · `/biochar-products` · `/customers` · `/orders` ·
`/deliveries` · `/applications` · `/credit-batches` · `/credit-batches/[id]` ·
`/certification/settings` (Connection/Emissions tabs) · `/certification/removals` ·
`/certification/ghg-statements`. Registry-gating reconfirmed: `/certification/removals`
redirects to Settings while the facility is unlinked.

## Tested workflows

1. **Prior P0 fixes verified (both hold):** slide-over panels render fully onscreen
   and all CTAs are reachable; PositionPickerMap no longer crashes on out-of-range
   coordinates (lat 91 / lng 181 now show inline range validation, no console
   exception, no error boundary).
2. **Full fresh-facility operator chain built end-to-end** (all created this pass):
   facility → reactor (QA Kiln 01) → 3 storage bins → supplier (QA Biomass Co-op) →
   feedstock FS-26-002 → production run PR-26-002 (driven to Complete) → biochar
   product BP-26-002 → customer QA Farm Partner (+ location) → order OR-26-002 →
   delivery DL-26-002 (Delivered) → application AP-26-002 → credit batch CB-26-002.
   Inventory flowed correctly through the storage board at each step.
3. **Certification:** linked the facility to Isometric project `prj_1K9YJ33RKSBX9FFF`
   (sandbox) with the "share across facilities" safeguard, bound default removal
   template `rvt_1KS4S43VPSBXA26X`, saved emission estimates (genset yield, soil temp,
   20/60/20 process split). Settings UI updated immediately (prior "stale until reload"
   P1 appears fixed). Drove the removal wizard to its readiness gate.
4. **Final GHG statement flow** exercised through Period → Preview → Confirm on the
   linked facility (zero-removal case). Not created (would be junk data); a real
   submit-to-verifier was not reachable — see Coverage limits.
5. **Edge cases / validation:** required-field messaging, invalid lat/lng, negative bin
   capacity, moisture > 100, over-withdrawal from a bin, date-only round-tripping,
   dependent-select auto-clear/auto-derive, quick-add feedstock type, referential-
   integrity delete. Detailed under Bugs / UX / Risks.

### Coverage limits (browser-driven)

A clean removal submission could not be completed on the fresh facility because the
batch readiness gate requires inputs that depend on file uploads the in-app browser
controller cannot drive (native file picker): **production-run telemetry readings (CSV
import)** and **application geotagged visual evidence (photo)**, plus **organic carbon
content / H:Corg** which come from a biochar sample's lab analysis (not created this
pass). This matches the limitation hit in both prior passes. The certification
readiness gate itself was fully exercised and is well-structured (see UX notes).

## Bugs found

| # | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| B1 | **P0** | **Production-run date shifts one day earlier on EVERY save (compounding).** Date-only field stores as UTC midnight, displayed/persisted in a behind-UTC local tz → loses a day each write. CERT-relevant (feeds GHG period + vintage). Feedstock delivery date was already migrated to the fix (`optionalDateOnly`, issue #46) but production-run date was NOT. | Entered Delivery/Run date **13.06.2026**. Feedstock list showed correct **Jun 13, 2026**. Production run PR-26-002 list+detail+edit all showed **12/06/2026** on create; clicking Save Changes once (no edits) shifted it to **11/06/2026**. Reproducible. |
| B2 | P2 | Feedstock-bin **Feedstock Type** (a required association) auto-selects the first global type with no explicit operator choice — here it pre-filled another facility's "Operator Coffee Husk mqceboe4". Operator can save a bin bound to the wrong feedstock type without noticing. | Create Storage Bin → Feedstock Bin → Feedstock Type pre-populated with the only existing (cross-facility) type as a selected chip, not a placeholder. |
| B3 | P3 | **Allocated Wet Mass** in the feedstock bin-allocation row defaults to a stray "2" instead of empty / remaining mass. | Create Feedstock → Add Bin → Allocated Wet Mass field showed `2`. |
| B4 | **P1** | **Constraint-blocked delete leaks the raw SQL query to the UI.** Deleting an in-use entity is correctly rejected at the DB (FK), but the operator-facing error is the raw Drizzle query string incl. internal table/column names and the row UUID — not a friendly "in use" message. Reproducible. Likely affects every FK-constrained delete (shared error path returns the raw DB error rather than catching it). | Storage → delete Feedstock Bin A (referenced by PR-26-002 + feedstock alloc) → red banner: `Failed query: delete from "storage_locations" where "storage_locations"."id" = $1 params: 519992e6-cc2d-4713-b27f-2f33f5983bcd`. |
| B5 | P2 | **Credit-batch "Carbon & durability inputs complete" gate links to a fix path that can't fix it.** The "Clear this gate → Edit details" / "Edit details" affordance opens the batch metadata form (dates / durability / notes only) — it has no Organic carbon / Soil temperature / H:Corg fields. Those inputs live on the upstream biochar sample (lab data) + application soil temp, so the operator follows the prompt and reaches a dead end. | CB-26-002 batch page → Submission gate → "Edit details" → Batch details edit form contains only Start/End date, durability (read-only), notes. |
| B6 | P2 | **Facilities list flashes the "No facilities yet" empty state (with Create CTA) while the list query is pending**, then resolves to the populated list. Stat cards correctly show skeletons; the list body shows a definitive empty state. An operator on a slow load can believe no facilities exist and create a duplicate. Reproducible on reload. | `/facilities` reload → full "No facilities yet / Create your first facility" card renders, then 3 facilities appear ~2s later. |

## UX issues found

- **Feedstock-type auto-default (B2)** reads as a data-integrity trap: a required
  association silently pre-selects an arbitrary (here cross-facility) value.
- **Generic delete confirmation.** "Delete Storage Bin — This action cannot be undone"
  doesn't mention the bin holds 850 kg or is used by PR-26-002. An in-use/has-inventory
  warning (or disabling delete for in-use bins) would prevent the confusing failure in B4.
- **Removal wizard shows a transient "Link this facility to Isometric…" warning** during
  the modal's initial render even when the facility *is* linked; it self-resolves once
  data loads (~1-2s). Low impact but reads alarming for a beat.
- **Date format is inconsistent across list pages.** Feedstocks / Biochar Products /
  Orders / Deliveries / Applications / Credit Batches render `Mon DD, YYYY`
  ("Jun 13, 2026"); the **Production Runs** list renders `DD/MM/YYYY` ("12/06/2026"),
  and the biochar-product run picker uses `YYYY-MM-DD`. Pick one.
- **Empty production-run picker with no explanation.** On the Create Biochar Product
  form, the Production Run dropdown is simply empty when no run is *Complete* — no
  "no completed runs yet / mark a run Complete first" hint. (Resolved once PR-26-002
  was set Complete.)

### Positive observations (regressions that appear fixed / good patterns)

- Both prior P0s (offscreen slide-over, invalid-coordinate map crash) are fixed and hold.
- Certification Settings now reflects the project link **immediately** after saving
  (prior P1 "unlinked until reload" not reproduced).
- The **"share project across facilities" safeguard** on Link Isometric Project (explicit
  checkbox naming the other facility) is a strong guard against accidental project sharing.
- The **credit-batch Submission gate** (4 named checks + per-item "missing" detail +
  "Fix on batch page") and the **removal wizard readiness list** (enumerates exactly the
  missing fields per batch) directly address the readiness-clarity concern behind #246.
- Supplier→feedstock and customer-location→delivery **transport distances auto-derive**
  from the stored distance; supplier-position **CALC** computes road distance + reverse
  geocodes. Delivered-dry-mass / biochar-dry-mass auto-calcs show their formula inline.

## Engineering risks found

- **Date-only handling is not uniform across forms.** Production-run create+update still
  parse the date with `new Date(val)` (`src/schemas/production-runs.ts` ~L37-47 / L134-137)
  — UTC-midnight parse → one-day backward shift in a behind-UTC tz, compounding per save
  (B1). Feedstock/product/delivery/order use the date-only path and are correct. This is
  the same class as issue #46; the fix is the existing `optionalDateOnly` / date-only
  helper from `@/schemas/helpers`. CERT-relevant: the run date feeds removal vintage /
  GHG period.
- **Delete error path returns raw DB errors (B4).** The shared delete handler surfaces the
  Drizzle query string instead of catching FK violations and returning a friendly
  `ActionResult` error. Schema/internals leak; broad blast radius across entities.
- **Facility fallback soil temperature isn't applied to batch carbon readiness.** Set
  25 °C in Emission Settings, yet CB-26-002 still lists "Soil temperature" missing — the
  fallback doesn't flow into the batch's carbon inputs (relates to open #206).
- **Single-org shared catalogs persist** (suppliers, customers, feedstock types visible
  across facilities) — consistent with the documented model and #104; multi-tenancy plan
  (#multi-tenancy / ADR 0010) will change this.
- Telemetry-readings (CSV) and application geotagged-photo gates depend on real file
  uploads; no non-upload entry path exists, so these flows can't be exercised headlessly.

## Recommended fixes

1. **B1 (P0):** migrate the production-run `date` field to the date-only helper
   (`optionalDateOnly` / equivalent) in both create and update schemas; add a regression
   test that a run created/edited with date D reads back as D (no tz shift). Audit any
   other schema still using `new Date(val)` on a date-only input.
2. **B4 (P1):** catch FK/constraint violations in the delete data-access/server layer and
   return a friendly `ActionResult` ("This bin is in use by production run … and can't be
   deleted"); never surface raw query text. Add a test for delete-of-referenced-entity.
3. **B5 (P2):** point the "Carbon & durability inputs" gate's CTA at the real input
   locations (biochar sample lab fields + application soil temp), or relabel it so it
   doesn't promise an edit it can't deliver.
4. **B6 (P2):** show a list skeleton (matching the stat-card skeletons) while the
   facilities query is pending instead of the empty-state card.
5. **B2 (P2):** don't auto-select a required Feedstock Type on a new bin — leave it
   unselected and force an explicit choice (or default only when exactly one type exists
   *and* it belongs to the active facility once multi-tenancy lands).
6. **B3 (P3):** default the bin-allocation Allocated Wet Mass to empty or the remaining
   deliverable mass, not `2`.
7. Unify list-page date formatting on one format.
8. Wire the facility fallback soil temperature into batch carbon readiness (or close #206
   with the decided behavior).

## Severity & suggested owner

| Severity | Owner area | Items |
| --- | --- | --- |
| P0 | Forms / schemas (dates) | B1 production-run date one-day shift (compounding) |
| P1 | Backend / error handling | B4 raw SQL leaked on constrained delete |
| P2 | Certification UX | B5 mislabeled carbon-gate fix path; soil-temp fallback (#206) |
| P2 | Frontend / loading | B6 facilities empty-state flash |
| P2 | Forms / storage | B2 feedstock-type auto-default |
| P2 | Design system | date-format inconsistency; generic delete confirm; empty run picker |
| P3 | Forms | B3 allocated-wet-mass default |

## New GitHub issues filed

**None.** Every new finding this pass is a clear bug or UX gap to fix (recorded above),
not a product/architecture decision — so no new decision issue was warranted. The
decision-class items encountered are already open: **#245** (zero-removal GHG — re-
confirmed the wizard still allows Period→Preview→Confirm with "Predicted to be linked
(0)"), **#246** (readiness semantics — the new per-item gate/readiness UI addresses much
of this), **#247** (removal-draft-before-emission-config), **#206** (soil-temp default +
facility fallback), and **#104** (shared supplier/customer catalogs). Recommend opening a
plain bug issue for **B1** and **B4** when the team triages this doc.
