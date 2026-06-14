# Operator E2E QA — Pass 4 (2026-06-13)

Destructive-but-safe browser QA against `http://localhost:3100`, authenticated as Admin
(`kenji@maji.studio`), no auth/authz bypass. Builds on prior passes:

- `docs/archive/2026-06-13-full-browser-e2e-qa-results.md`
- `docs/archive/2026-06-13-operator-e2e-removal-ghg-plan.md`
- `docs/archive/2026-06-13-operator-qa-pass-3.md`

**Goal:** find *new* edge cases (not in the three docs above or the open issue list),
hammering facilities → related records → removals → GHG with unusual-but-realistic
input. To avoid colliding with the parallel review (camped on the two data-rich
facilities), all destructive tests ran in an **isolated sandbox facility created for
this pass**: `DupSubmit QA4 Race` / `FAC-26-006` (`6ad45b8c-b38b-46b4-8a3f-1c4d3462d351`).

**Verify-don't-re-report (already known):** slide-over offscreen (fixed), invalid
lat/lng crash (fixed), date-only one-day-shift, GHG submit-400 body hidden, readiness
badge vs wizard gate (#246), removal-draft-before-estimates (#247), zero-removal GHG
(#245), GHG period-overlap validation, cert-link stale-until-reload, delivery-edit
blank date, async "no options" flash, bin over-withdrawal (#116), supplier-picker-
shows-customers (#104), lost-update/optimistic (#226/#229), empty-state duplicate CTAs,
plausibility-warnings (#193), derive-delivered-mass-from-weighing (#190),
position-picker fixtures.

Code-layer claims were cross-checked against the repo (file:line cited). UI claims were
reproduced in the browser with screenshots.

---

## Summary of new findings

| # | Severity | Finding | Layer | Issue? |
|---|----------|---------|-------|--------|
| 1 | **P1** | Raw DB error (full SQL `INSERT` + column names + parameter values incl. internal UUIDs) leaked verbatim to the operator UI on any unexpected error — `error.message` passthrough in **14 of 27 `fn/` files** | fn / errors | **YES (cross-cutting)** |
| 2 | **P2** | Uncapped `integer` columns (`residence_time_minutes`, `r0_measurement_count`) accept values > 2,147,483,647 → Postgres `integer out of range`; no Zod `.max()`. Triggers finding #1. | schema / db | with #1 |
| 3 | **P2** | Text name/identifier fields are **not trimmed** and accept **whitespace-only** values → blank-named & lookalike-duplicate entities (facility, supplier, customer, reactor, storage) | schema | mechanical |
| 4 | **P2** | **Reactor identifier is not unique within a facility** → two indistinguishable "QA Reactor 1" rows; ambiguous reactor selector → wrong-reactor attribution | schema / db | decision |
| 5 | **P3** | No upper bound / plausibility cap on numeric inputs (bin capacity, masses) — 1e15 kg accepted, rendered without separators. Mostly folded into #193. | schema | (defer #193) |
| 6 | **P3** | No `endTime > startTime` refinement on production-run schema → negative-duration runs possible (code-observed; not browser-confirmed) | schema | mechanical |

---

## Detailed findings

### Finding 1 — Raw database error + SQL leaked to the client UI (P1, cross-cutting)

**Steps to reproduce**
1. Sandbox facility with a reactor. Open **Production Runs → New Production Run**.
2. Status `Draft` (default). Reactor, Date, Start Time are pre-filled (the only required fields).
3. Enter **Residence (min) = 3000000000** (any value > 2,147,483,647 works). Submit.
4. The drawer stays open and shows an error banner containing the **raw query**:

```
Failed query: insert into "production_runs" ("id", "code", "facility_id", "date",
"status", "start_time", "end_time", "reactor_id", "operator_id", "feeding_rate_kg_hr",
"residence_time_minutes", ...) values (default, $1, $2, ...) returning ...
params: PR-26-003,6ad45b8c-…-3462d351,2026-06-12,draft,2026-06-13T15:46:00.000Z,
2026-06-13T15:46:00.000Z,5d37876f-9923-4c2e-8e2f-0190e9dc35dd,,,3000000000,,,,,,,,,,
```

The POST returns **HTTP 200** with `ActionResult { success:false, error:<raw message> }`,
so no error boundary catches it — the raw string renders in `ServerError`.

**Expected:** a sanitized, human-readable message (e.g. "Residence time is too large")
and a structured server-side log; never the SQL statement, column list, parameter
values, or internal UUIDs.

**Actual:** the full Drizzle/Postgres error — including table/column schema and every
bound parameter (facility id, reactor/operator id, PR code, the offending value) — is
shown to the operator.

**Why it matters:** (a) information disclosure — leaks schema internals and internal
record IDs to any user who triggers a DB error; (b) violates the project's
"never leak / log IDs not prose" posture; (c) operators see an incomprehensible wall of
SQL instead of an actionable message. This fires on **any** unexpected DB error
(constraint violation, overflow, etc.), not just this contrived input — see Finding 4
for a realistic trigger.

**Layer & root cause:** `fn/` error handling. Catch blocks return
`error instanceof Error ? error.message : "Failed to …"`, passing the raw DB error string
straight through as the `ActionResult` error. Confirmed in **14 of 27** `fn/` files,
including every core mutation:
- `src/fn/production-runs.ts:304` (create), `:399` (update) — and read paths `:71,94,133,155,178,203,231`
- `src/fn/facilities.ts:303` (create), `:351` (update)
- `src/fn/feedstocks.ts:212` (create), `:252` (update)
- `src/fn/samples.ts:270` (create), `:370` (update)
- (plus credit-batches and others)

**Suggested fix:** centralize error handling so `fn/` never returns `error.message` for
unexpected errors. Return a stable sanitized string + an error code; log the full error
server-side via `@/lib/log` with `userId`/entity ids only. Keep `error.message` only for
*intentional* domain errors (validated, user-safe). Consider a `toActionError(err)` helper
in `src/lib/errors.ts` used by all catch blocks.

---

### Finding 2 — Integer-overflow on uncapped `integer` columns (P2)

**Steps to reproduce:** as Finding 1 (Residence ≥ 2,147,483,648). Also reproducible on
**Sample → R0 measurement count** (`r0_measurement_count`).

**Expected:** client/Zod validation caps the value (e.g. residence time ≤ a sane domain
max) with a friendly message before any DB call.

**Actual:** value passes Zod and reaches Postgres `int4`, which throws `integer out of
range`, surfaced via Finding 1.

**Layer:** schema + db.
- `src/schemas/production-runs.ts:97,173` — `residenceTimeMinutes: z.number().int().positive()` (**no `.max()`**)
- `src/db/schema/production.ts:44` — `residence_time_minutes integer`
- `src/schemas/samples.ts:111-116` — `r0MeasurementCount: z.number().int().min(0)` (**no `.max()`**)
- `src/db/schema/production.ts:218` — `r0_measurement_count integer`

**Suggested fix:** add domain-appropriate `.max()` to these `.int()` fields (e.g.
residence-time minutes capped to a day or two; R0 count to a few thousand). Independent
of #193 (which is about *plausibility warnings* for mass drift, not hard overflow caps).

---

### Finding 3 — No trim + whitespace-only names accepted (P2)

**Steps to reproduce (a — untrimmed):**
1. Facilities → New Facility. Name = `  Trim ⚠️ <b>QA</b>  ` (leading/trailing spaces).
2. Save. Card title renders the literal `<b>QA</b>` (HTML correctly escaped — **no XSS**,
   good), but the stored value is `"  Trim ⚠️ <b>QA</b>  "` verbatim — confirmed via DOM
   `textContent` (length 21, spaces intact).

**Steps to reproduce (b — whitespace-only → blank):**
1. New Facility. Name = `"     "` (5 spaces), Country `Tanzania`, Timezone set. Save.
2. **Facility is created with a completely blank name** (`FAC-26-005`, empty card title;
   active-facility count incremented). `.min(1)` passes because 5 spaces has length 5.

**Expected:** names are trimmed and rejected when empty after trim (`.trim().min(1)`).

**Actual:** no trim, no non-whitespace check → blank-named entities and visually-identical
lookalikes (`"Foo"` vs `" Foo"` vs `"Foo "`) that are distinct rows.

**Why it matters:** a blank-named facility renders empty in the sidebar **facility
selector** — operators can't identify or safely pick it. Lookalike names corrupt search,
sort, and selection across the chain.

**Layer:** schema. No shared trimmed-string helper in `src/schemas/helpers.ts`; trim is
applied ad-hoc (only incidents/transport-legs/geo/isometric normalize). Affected create
schemas (no trim, `.min(1)` only):
- `src/schemas/facilities.ts:147-150`, suppliers `src/schemas/suppliers.ts:20-23`,
  customers `src/schemas/customers.ts:43-47,82-86`, reactors `src/schemas/reactors.ts:42,65`,
  storage `src/schemas/storage-locations.ts:64`.

**Suggested fix:** add a shared `trimmedString` helper (`z.string().trim().min(1, …)`) in
`@/schemas/helpers` and apply to all human-entered name/identifier fields.

---

### Finding 4 — Reactor identifier not unique within a facility (P2)

**Steps to reproduce:**
1. Sandbox facility. Create reactor identifier `QA Reactor 1` (Rotary Kiln). Save → `R-26-003`.
2. Create another reactor identifier `QA Reactor 1` (Auger). Save → `R-26-004`.
3. Reactors list shows **two rows with identical identifier "QA Reactor 1"** in the same facility.

**Expected:** a per-facility uniqueness guard on reactor identifier (or an explicit
product decision that duplicates are allowed).

**Actual:** duplicates silently accepted; only the auto-generated `R-26-NNN` code is
unique. The production-run **reactor selector** then lists two indistinguishable
"QA Reactor 1" options → an operator can attach a run to the wrong reactor, mis-attributing
sampling method / throughput / chain-of-custody lineage.

**Layer:** schema/db — no unique constraint on `(facility_id, identifier)`. Likely also
applies to feedstock-type, supplier, customer, and storage-bin names.

**Decision needed:** should human identifiers be unique per-facility, globally, or
intentionally non-unique? → candidate GitHub decision issue.

---

### Finding 5 — No upper bound / plausibility cap on numeric inputs (P3)

Storage-bin capacity accepts `1,000,000,000,000,000` kg → rendered "0% of
1000000000000.0 t" (kg→t conversion is **correct**; verified 5000 kg → "5.0 t"). No
upper `.max()` on any `real` mass/capacity field; values render without thousands
separators. **Largely covered by #193** (plausibility warnings) — recording for
completeness; recommend folding into that issue rather than a new one.

`src/db/schema/facilities.ts:80` (`capacity_kg real`), `src/schemas/storage-locations.ts:71-74`
(`.positive()`, no max). Negative (`-50`) and the empty/0 cases **are** correctly rejected
("Capacity must be a positive number").

---

### Finding 6 — No end-time > start-time validation on production runs (P3, code-observed)

`src/schemas/production-runs.ts` defines `startTime`/`endTime` but has **no `superRefine`
asserting `endTime > startTime`** → a run with end before start (negative duration) is not
blocked at the schema layer, which would corrupt duration-derived throughput/energy
intensity. Not reproduced in the browser this pass (draft runs may legitimately omit end
time); flagged as a code-observed risk for a focused check + refinement.

---

## Verified-good (checked, no bug — recording so they aren't re-tested)

- **Required-field validation** on facility/storage/reactor create (inline messages). ✓
- **HTML/script escaping** — `<b>`/markup in names renders as literal text; no stored XSS. ✓
- **Negative / zero numeric inputs** rejected where `.positive()` applies (bin capacity `-50`). ✓
- **Feedstock cross-field validation** is solid: moisture `0–100` (`feedstocks.ts:32-33`),
  **dry mass is derived/read-only**, truck masses validated (`departure ≤ arrival`, both
  ≥ 0 — `src/schemas/truck-weighing.ts:14-40`). Note: delivered-vs-wet-mass plausibility is
  the known #190/#193 gap, not re-reported.
- **Double-submit on facility create** — two rapid Create clicks produced exactly one
  facility (count 5→6); submit is guarded. ✓
- **Invalid / malformed `?facility=` param** — `00000000-…-000000000000` and
  `not-a-real-uuid-12345` both fall back gracefully to the last-selected facility, rewrite
  the URL, and never reach a Postgres UUID cast; no crash, no console errors. ✓
- **Facility context** switches cleanly via `?facility=<id>` in the URL. ✓

---

## Test artifacts left in the dev DB (sandbox)

Created during this pass (safe to `pnpm db:reset`): facilities `FAC-26-004` ("Trim …"),
`FAC-26-005` (blank name), `FAC-26-006` ("DupSubmit QA4 Race" — sandbox); under FAC-26-006:
storage bins `SL-26-007` (1e15 cap), `SL-26-008` (5000), reactors `R-26-003` & `R-26-004`
(duplicate identifier). No production run persisted (the overflow insert rolled back).

## New GitHub issues filed

- **#251** (cross-cutting) — `fix: sanitize server-action errors — raw SQL + params leak to client UI` (Findings 1 + 2). labels: bug, security, backend.
- **#252** (decision) — `Decide uniqueness policy for human identifiers within a facility (reactor identifier, entity names)` (Finding 4). labels: decision, backend.

Mechanical fixes (no issue — captured here for direct action): trimmed-string helper for name fields (Finding 3), `.max()` caps on `residence_time_minutes` / `r0_measurement_count` (Finding 2), `endTime > startTime` refinement (Finding 6). Finding 5 → fold into #193.
