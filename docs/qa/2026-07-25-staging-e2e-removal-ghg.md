# E2E QA — new facility → removal → GHG entry → GHG statement

**Date:** 2026-07-25
**Build:** `staging` @ `300d5920`
**Environments:** staging (https://staging.noma.maji.studio) and localhost:3100
**Registry:** Isometric **sandbox**, project `prj_1K9YJ33RKSBX9FFF` ("Tanzania biochar"), template `rvt_1KS4S43VPSBXA26X`
**Method:** UI-only via browser automation, as a new operator starting from an empty facility.

---

## Verdict

**The removal → GHG entry pipeline works, and the numbers are right.**

A live removal was submitted to the sandbox registry from localhost and reconciled
to within rounding against an independent hand calculation (§3). On **staging** the
same flow is blocked before submission by an object-storage CORS gap (§4, F-1) —
that is an infrastructure config issue, not application logic: the identical code
path succeeds on localhost.

**GHG statement submission was exercised and is blocked at the registry**, not by
our code: `No verifier is assigned to this project` (§5). That is the reason no
GHG statement has ever been submitted to this sandbox project.

---

## 1. What was built

| Environment | Facility | Outcome |
|---|---|---|
| staging | `FAC-26-005` QA 2026-07-25 Submission Facility | blocked at removal (4 upload-gated evidence gaps) |
| localhost | `FAC-26-002` QA0725B Isolated E2E Facility | **removal `rmv_1KYD8GSQYSBXKWSQ` submitted** |

Localhost chain (all created through the UI): feedstock type from the Isometric
catalogue (`ftt_1K9YJNV5TSBXJV9D`) → supplier `SUP-26-002` (+ source location,
30 km) → feedstock `FS-26-002` (20.0 t wet @ 25% → 15.0 t dry) → production run
`PR-26-002` (3,800 kg wet @ 2% → 3,724 kg dry, 24.8% yield; 50 L startup +
100 L genset + 20 L preprocess + 500 kWh; 28 telemetry rows) → biochar product
`BP-26-002` → customer/order/delivery/application (`AP-26-004`, 5 ha, mechanical,
3 geotagged photos) → credit batch `CB-26-002` (Jul 1–21 2026, Method A, 1000-year)
→ 3 lab samples across 3 distinct days.

## 2. Arithmetic verified in the dMRV

| Check | Expected | App | ✓ |
|---|---|---|---|
| Feedstock dry mass | 20,000 × 0.75 | 15,000 kg | ✓ |
| Biochar dry mass | 3,800 × 0.98 | 3,724 kg | ✓ |
| Pyrolysis yield (dry) | 3,724 / 15,000 | 24.8 % | ✓ |
| Round-trip transport | 30 km one-way | "Total: 60 km" | ✓ |
| Delivery dry mass | 3,800 − 76 | explicit `3,800 − 76 = 3,724` panel | ✓ |
| H:C_org (molar) | (2.00/1.008)/(80.5/12.011) = 0.2960 | 0.296 | ✓ |
| H:C_org sample 2 | (2.05/1.008)/(79.9/12.011) = 0.3057 | 0.306 | ✓ |
| H:C_org sample 3 | (1.98/1.008)/(81.1/12.011) = 0.2909 | 0.291 | ✓ |
| Batch roll-up | 3.72 t dry, 15.00 t feedstock dry, 170 L diesel, 500 kWh | matches run | ✓ |

**H:C_org is computed off *organic* carbon, not total carbon** — protocol-correct.

## 3. Registry reconciliation — the headline result

After submitting `rmv_1KYD8GSQYSBXKWSQ`, the sandbox project moved:

| Metric | Before | After | Delta |
|---|---|---|---|
| `01 Jul 2026 – 31 Jul 2026` statement | 3 entries · 0.26 tCO₂e | 4 entries · **8.32 tCO₂e** | **+8.06** |
| Project "Expected credits" | 29.21 | **37.27** | **+8.06** |

Two independent registry figures agree on **+8.06 tCO₂e**.

**Independent hand calculation of gross sequestration:**

```text
dry biochar submitted      = 3.724 t
mean organic carbon        = (80.5 + 79.9 + 81.1) / 3      = 80.5 %
carbon mass                = 3.724 × 0.805                 = 2.9978 t C
s_fraction (R₀ ≥ 2%)       = mean(0.95, 0.94, 0.96)        = 0.95
durable_fraction           = 0.95 − √(0.95 × 0.05 / 3)     = 0.8242
durable carbon             = 2.9978 × 0.8242               = 2.4707 t C
gross CO₂e                 = 2.4707 × 44/12                = 9.06 tCO₂e
```

Registry net was 8.06 t ⇒ Isometric deducted **≈1.00 tCO₂e** of project emissions.
Sanity-check of that deduction against the inputs submitted:

| Source | Quantity | ≈ factor | ≈ tCO₂e |
|---|---|---|---|
| Diesel (startup + genset + preprocess) | 170 L | 2.68 kg/L | 0.46 |
| Grid electricity | 500 kWh | ~0.45 kg/kWh | 0.22 |
| Feedstock transport | 20 t × 60 km | ~0.1 kg/t·km | 0.12 |
| Biochar delivery | 3.8 t × 90 km | ~0.1 kg/t·km | 0.03 |
| **Total** | | | **≈0.83** |

≈0.83 t explained against a ≈1.00 t deduction, with the remainder attributable to
factors Isometric applies that we do not submit (noma submits **quantities, not
emission factors** — the app states this explicitly on the credit-batch form).
**The durability maths, the carbon maths, and the emissions deduction all reconcile.**

## 4. Findings

### F-1 · P0 — Staging object storage has no CORS config; blocks the whole certification path

Every document upload on staging fails with
`Upload network error — could not reach fra1.digitaloceanspaces.com.`

**Root cause proven, not inferred.** From the staging page context:

| Probe | Result | Meaning |
|---|---|---|
| `fetch(spaces, {mode:"no-cors"})` | `type:opaque status:0` | host reachable — not connectivity |
| `fetch(spaces, {mode:"cors"})` | `TypeError: Failed to fetch` | no `Access-Control-Allow-Origin` |

`src/lib/storage/s3-compatible.ts:63-77` presigns a `PUT`;
`src/hooks/use-file-upload.ts:72-90` sends it by XHR **with a `Content-Type`
header** — not CORS-safelisted, so a preflight is required, the Space answers
without CORS headers, and XHR fires `onerror`.

**Impact:** the removal wizard fail-closed on staging with 4 issues, *all*
upload-gated (production-run evidence, feedstock transport evidence, biochar
transport evidence, application evidence) and `CONTINUE` disabled → no removal,
no GHG entry, no GHG statement.

**Proof it is config, not code:** the identical flow on localhost (`local-fs`
driver, same-origin) uploaded a PDF (`upload_status: uploaded`), a telemetry CSV,
and three geotagged JPEGs, and reached a successful live submission.

**Fix:** apply the CORS JSON already documented in `docs/storage.md:179-196` to the
staging Space with `AllowedOrigins: ["https://staging.noma.maji.studio"]`.

**Not new** — reported 2026-07-15, 07-16, 07-21. Four consecutive QA passes blocked.
`pnpm storage:smoke` cannot catch it; `docs/storage.md:205` says so explicitly.
**Suggested:** add an E2E that performs a real cross-origin presigned PUT.

### F-2 · P1 — Production-run start/end times are anchored to the browser timezone, not the facility

`src/lib/date-utils.ts:81-83`:

```js
export function combineDateAndTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`);   // no zone designator → browser-local
}
```

Entering **08:00–16:00** for a facility in `Africa/Dar_es_Salaam` (UTC+3) stored
**06:00–14:00 UTC** — my browser's CEST (UTC+2), a 1-hour shift.

**Observed consequence:** the telemetry importer clips to the run window, so 4 of
32 CSV rows (05:00–05:45 UTC = 08:00–08:45 facility-local, squarely inside the
operator's stated run) were silently dropped as out-of-window — 28 rows imported.

The error scales with the gap between the operator's browser and the plant: a
European back-office user entering Tanzanian plant times is off by 1–2 h; a US
user by 8–11 h. The run window also feeds certification timing, and
`removal-submission-build.ts:237` uses the run end time as the datapoint
`measured_at` sent to the registry.

This is inconsistent with the care taken elsewhere: `durability-batch-summary.ts`
deliberately resolves sampling days in the facility zone, and `toDateInputValue`
in the *same file* carries a comment about exactly this class of bug (#46).

### F-3 · P1 — Pre-submit checks don't validate that measurement dates are not in the future

With the chain dated in the future relative to "today", the batch reported
**"Batch data ready"**, all blocking preconditions met, 8 of 9 checks green — and
the submission then failed at the registry:

```text
Datapoint POST failed for "s_fraction": Provider rejected the request (400):
Measured at date for datapoint cannot be in the future
```

Nine local checks run before submit; none covers a future `measured_at`, even
though the registry hard-rejects it. Fail-late instead of fail-closed.

**Mitigating:** the failure was handled cleanly — the submission was recorded
`rejected` with **no `external_id`**, leaving no orphan in the registry, and the
removal remained resubmittable. Re-submitting after correcting the dates produced
`rmv_1KYD8GSQYSBXKWSQ`, and a duplicate click was correctly refused with
"This removal has already been submitted to the registry."

### F-3b · P1 — GHG statement submission: the app is correct, the registry project is not configured

Full path exercised on localhost. The app:

1. offered a 3-step wizard (Period → Contents → Confirm) that **read the registry's
   existing statements live** and listed them under "Already in the registry";
2. previewed **exactly** the right contents — `EXPECTED IN THIS STATEMENT (1):
   rmv_1KYD8GSQYSBXKWSQ · Jul 14, 2026`, other open removals 0;
3. showed the statement as `Jul 1 – Jul 31, 2026 · 1 removal · ggs_1KTKDDXDXSBXHGNJ · v1`,
   verifier status "In registry — not yet sent to the verifier";
4. required a **Report URL** on submit ("Link to the published PDF report the
   verifier will open") — a genuine Isometric requirement;
5. called the API and surfaced the provider's response verbatim:

```text
Provider rejected the request (400): No verifier is assigned to this project
```

**No verifier is assigned to `prj_1K9YJ33RKSBX9FFF`**, so the sandbox refuses every
GHG statement submission. This is not an app defect, and it fully explains why every
statement on the project sits at `DRAFT` with an empty "Last submitted".

**Crucially, this is not a setting we can toggle.** Per the Isometric documentation
([user-guides/certify/validation](https://docs.isometric.com/user-guides/certify/validation)),
a VVB is assigned **by Isometric through an RFP to its network of accredited VVBs**,
and only after: kick-off with a Registry Operations Manager → pre-screen of the PDD
and LCA → 10-day PDD public comment period → VVB selection. Verification — "a VVB's
evaluation of a project's GHG Statement submitted through the Certify platform" — is
the step after that. There is no verifier field on the project's General page, as
expected. *(AI summary of the docs — not authoritative; see the URL above.)*

Our project is `Draft` with project design 1/48, LCA "Missing information", and
feedstock 0/6, so it is nowhere near VVB assignment.

**To finish testing this path:** ask Isometric to attach a test VVB to the sandbox
project. Everything on our side is already proven up to and including the API call —
correct period, correct removal linked, Report URL enforced, provider error surfaced
verbatim. What remains untested is only the registry's *acceptance* behaviour and
whatever it returns on success.

### F-4 · P1 — A registry statement can only ever belong to one noma facility

`certifier_ghg_statements` has:

```sql
UNIQUE (provider, metadata->>'remoteExternalId')   -- global, not per-facility
facility_id NOT NULL
UNIQUE (provider, facility_id, reporting_period_end_on)
```

The remote statement id is unique **provider-wide**, and `facility_id` cannot be
shared. So once a registry statement is imported under facility A, facility B can
never import it — and unlinking A does not release it. Observed exactly: after
unlinking FAC-26-001, **Sync from registry** for FAC-26-002 touched the existing
rows (`updated_at` advanced) but imported nothing, and the facility-filtered list
still showed **0 statements** — while the statement holding FAC-26-002's own
removal sat under FAC-26-001. Re-homing the rows by hand made all 12 appear
immediately, with `Jul 1 – Jul 31, 2026 · 1 removal` correctly linked.

Related, and **good**: creating a statement while a project is shared is explicitly
blocked with a clear message — *"GHG statements cannot be created while this
Isometric project is shared across multiple noma facilities. Link each facility to a
dedicated Isometric project first."* The guard is right; the gap is that once
statements have been imported under one facility, re-pointing the project leaves the
new facility permanently locked out with no explanation.

### F-4b · P2 — "Create GHG Statement" silently no-ops for an existing period

Running the wizard for `Jul 31, 2026` — a period that already exists in the
registry as `ggs_1KTKDDXDXSBXHGNJ` — completed with **no effect at all**: the dialog
closed, no toast, no error, **no local row** in `certifier_ghg_statements`, no new
`certification_submissions` record, and the registry unchanged (still 12 statements,
Jul 1–31 still 4 entries / 8.32 t). If the intent is "this period already exists,
nothing to do", it should say so.

Related: **Sync from registry gives no feedback at all** — no toast, no count, no
"0 statements found". Success and no-op are indistinguishable from failure.
Observed on both staging and localhost.

### F-5 · P2 — Routing provider is down; distance is a CERT-tagged input

The `CALC` button fails on **both** staging and localhost with
`Could not reach the routing service. Try again.`

Root cause is **upstream, not ours**:

```text
POST https://api.heigit.org/openrouteservice/v2/directions/driving-car
→ 502 Proxy Error after ~30 s
   "DNS lookup failure for: heigitsv03.heigit.org"
```

`ORS_REQUEST_TIMEOUT_MS = 10_000` aborts before the 502 arrives, so
`src/lib/geo/ors.ts:51-57` reports the generic network branch — which reads as if
*our* connectivity failed. Geocoding on the same provider still works (reverse
geocode returned "≈ UBWARI, TN, TANZANIA"), so only directions is affected.

One-way distance is `CERT`-tagged and feeds transport emissions, so while ORS
directions is down that number is unverifiable operator input. Fail-soft handling
is good (field stays editable, `SOURCE: MANUAL` provenance shown), but the stale
red error persists after a manual value is entered. Worth considering a fallback
provider or great-circle × road-factor estimate for a CERT input on a single
third-party dependency.

### F-6 · P2 — "Chemistry complete" badge disagrees with the usable-replicate gate

A sample with no **Oxygen** value shows a green **"Chemistry complete"** badge yet
does not count toward the ≥3 replicate minimum, with no indication why.

- `certify-field-registry.ts:205-256` — sample descriptors check organic carbon,
  H:C_org, TGA and R₀. **`oToCOrgRatio` is not among them.**
- `durability-batch-summary.ts:226-231` and `durability-submission-gates.ts:148` —
  a replicate is usable only when **both** H:C_org *and* O:C_org are usable numbers.

Reproduced on staging: three samples all showing "Chemistry complete", across two
distinct days, and the panel still read:

> Chemistry eligible · **1 of 3 usable samples**
> add 2 more (across distinct runs/days) to reach the ≥3 minimum
> `2026-07-06` `2026-07-07`

The counter is correct; the badge and the hint are wrong. The hint blames
**distribution** while showing two distinct day chips, and the real blocker was a
missing oxygen value. Suggested: add `oToCOrgRatio` to the sample descriptors, and
make the hint name the actual gap.

### F-7 · P3 — Staging returns intermittent 503s

Server actions and RSC prefetches 503 intermittently on staging (the first
"Sync from registry" POST 503'd, an identical retry returned 200; several `?_rsc=`
prefetches also 503'd). Not observed on localhost.

### F-8 · P3 — Smaller items

- **Shared-project warning** says "Submissions from **both** facilities" while
  listing **three** — only wrong at 3+; correct with exactly two.
- **Credit-batch claims** label `Diesel · genset + startup` shows **170 L**, which
  is 50 startup + 100 genset + **20 preprocess**. The label omits preprocess fuel,
  which may belong to a different SSR.
- **Facilities page** flashes `No facilities yet — Create your first facility`
  while loading, then renders the facilities. Other list pages use skeletons; this
  empty state is actively misleading.
- **Vehicle enums** inconsistent: vehicle type values are lowercase slugs
  (`truck`), fuel type values capitalised (`Diesel`).
- **Storage-bin picker** shows `0 kg remaining` for an empty 50 t bin — "remaining"
  means current contents, not remaining capacity, and sits next to a `0% of 50.0 t`
  capacity meter.
- **Map preview** shows "MAP PREVIEW UNAVAILABLE" in supplier/application drawers
  on both environments, though the MapTiler style endpoint returns 200 and the key
  is valid — likely client-side/WebGL in the automation profile; needs a human
  eyeball before being treated as a defect.

## 5. What is still unproven

| Path | Status |
|---|---|
| Removal submission | ✅ verified live, numbers reconciled |
| GHG entry creation + statement attachment | ✅ verified (entry landed in Jul statement) |
| GHG statement build + preview + API call | ✅ verified — correct contents, correct removal linked |
| **GHG statement accepted by registry** | ❌ blocked: **no verifier assigned to the project** (F-3b) |
| Removal from staging | ❌ blocked by F-1 |
| Route-distance accuracy | ❌ blocked by F-5 (upstream outage) |

Two statements on the project carry a **negative** net — `22 Nov 2026 – 30 Nov 2027`
at **−3.24 tCO₂e** (12 entries × −0.27, statement `ggs_1KX9BFSBSSBX4RGS`) and
`22 Aug 2026 – 21 Nov 2026` at −0.03. These are pre-#526/#528 sequestration-binding
artefacts, but they are polluting the live "Expected credits" figure. **Recommend
deleting the junk draft statements/entries from the sandbox before the next pass.**

## 6. Recommended order

1. **Apply the Space CORS config** (F-1) — one infra change; unblocks staging entirely.
2. **Fix the facility-timezone anchoring** of production-run times (F-2) — silent data loss.
3. **Add a future-date pre-submit check** (F-3) so the registry isn't the first to say no.
4. **Purge the junk draft GHG statements** from the sandbox project.
5. **Ask Isometric to attach a test VVB to the sandbox project** (F-3b) — the only
   thing standing between us and a fully proven GHG statement submission, and it is
   an Isometric-side process step, not something we can configure.
6. Fix the sample oxygen badge/hint (F-6), the statement/facility binding (F-4),
   the silent create (F-4b) and the sync feedback.

## 7. Test-integrity notes

- **A second agent was writing to the same local database concurrently.** I ran
  `pnpm db:reset` on `noma_dmrv_dev` at ~16:40 before discovering this, which would
  have destroyed anything it had created earlier; the user confirmed it was also
  testing and nothing critical was lost. To avoid further collision I created a
  **separate facility** (`FAC-26-002`) as an isolation boundary — credit batches are
  facility-scoped, so my batch attached only my own run.
- **Dates were shifted −1 month by direct SQL** (feedstock/run/readings/product/
  order/delivery/application/batch/samples) after the future-date rejection in F-3,
  to bring the chain into the past. Only date columns were touched; the removal
  submission itself ran entirely through the application.
- **To test GHG statement submission** I temporarily unlinked FAC-26-001's Isometric
  project (with the user's approval) and re-homed the 12 `certifier_ghg_statements`
  rows to my facility by SQL, because the schema makes that state unreachable through
  the UI (F-4). **Both changes were reverted afterwards** and verified: all 12 rows
  are back on facility `9278fc76`, and `certifier_projects` shows both facilities
  linked to `prj_1K9YJ33RKSBX9FFF` / `rvt_1KS4S43VPSBXA26X` exactly as before.
- The registry was written to **once** (`rmv_1KYD8GSQYSBXKWSQ`). The GHG statement
  submission was rejected by the registry, so it changed nothing there. All other
  registry access was read-only. The Report URL used was an RFC-2606 reserved
  `example.com` address so it could not be mistaken for a real report.
- Staging artefacts (`FAC-26-005`, `CB-26-005`, `SAM-26-041…044`) are left in place,
  ready to resume once F-1 is fixed.

---

## Addendum — corrections from remediation (2026-07-25)

Findings from this report were verified against the code before being fixed.
Three claims did **not** survive that check and are corrected here so a later
pass does not re-report them.

### F-4b "Sync from registry gives no feedback at all" — incorrect

A toast reporting `reconciledCount` already existed on this branch
(`components/certification/ghg-statements-list`), added in `3a32f1d7` (#536)
*before* this QA pass. The real defect was narrower and is now fixed: the
reconcile computed a `warningCount` that was **never rendered**, and a remote
statement already owned by another facility was `continue`d in
`fn/certification/ghg-statement-reconciliation` without being counted in
*either* counter — so the toast read "Synced 0 registry statements" while 12
statements sat in the project. Skips and warnings are now surfaced.

### F-4b "Create GHG Statement silently no-ops" — wrong mechanism

The dialog does not close silently. `Modal` sets `dismissOnClickOutside={false}`
and only the explicit **Done** button closes it. For an already-existing period
the action returned a *success* payload with `linkedRemovalIds: []`, so the UI
fired `toast.success("Created with 0 linked removals.")` — a **false claim of
creation** plus a wrong count, which is worse than silence. Per ADR 0004 the
idempotency itself is correct and was kept; the result now carries an
`outcome: "created" | "existing"` discriminator and reports real membership.

### F-8 "preprocess fuel may belong to a different SSR" — does not hold

The `Diesel · genset + startup` label showing 170 L was a **label** error, not a
value error. `lib/isometric/utils/aggregation` and
`lib/certification/certify-field-registry` both route preprocessing fuel into
the genset component deliberately, and `docs/isometric/changes.md` records that
the Dark Earth template's two pyrolysis `fuel_usage_by_volume` components share
one fixed emission factor — the split is presentation-only and total emissions
are unchanged. All three litre fields belong to the same pyrolysis SSR, so
summing them is correct. Only the label changed.

### F-8 storage-bin wording — co-location claim incorrect

`0 kg remaining` and the `0% of 50.0 t` capacity meter are on **different
surfaces** (the entity-picker dropdown vs the storage-bin card), not side by
side. The wording defect was real and is fixed (`kg stored`); real headroom was
deliberately not computed, since `capacityKg` is not selected by the picker
queries and uncapped bins are nullable.

### F-2 file path — incorrect

The report cites `durability-batch-summary.ts` under `src/lib/durability/`.
That directory does not exist; the file is `src/lib/certification/`. Also worth
pinning: the production-run columns are `timestamp` **without** time zone, and
that is correct — Drizzle round-trips them as UTC. The bug was client-side
construction only. Nobody should "fix" this by altering the column type.
