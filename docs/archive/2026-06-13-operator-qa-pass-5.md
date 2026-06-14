# Operator E2E QA — Pass 5 (2026-06-13)

Browser-based operator QA against `http://localhost:3100`, authenticated as Admin
(`kenji@maji.studio`). No auth/authz bypass. Run on branch
`fix/visual-improvements-details` (slide-over-panel + position-picker-map + globals.css
in flight). Builds on and avoids re-reporting prior passes:

- `docs/archive/2026-06-13-operator-qa-pass-3.md`
- `docs/archive/2026-06-13-operator-qa-pass-4.md`
- `docs/archive/2026-06-13-full-browser-e2e-qa-results.md`
- `docs/archive/2026-06-13-operator-e2e-removal-ghg-plan.md`

**Persona/goal:** a busy operator setting up a new facility and pushing it to a final GHG
statement under time pressure. Deliberately hunted friction, ambiguity, weak errors,
unclear disabled states, and places the app lets you proceed without understanding the
consequence. Every UI claim was reproduced in the browser; code claims are cited `file:line`.

**Verify-don't-re-report (already known, observed-as-still-present, not re-filed):**
date-only one-day shift; raw-SQL error leak (#251); whitespace/blank names (pass 4 #3);
uncapped integers (#251/pass 4 #2); reactor identifier non-unique (#252); detail routes
ignore active facility (#253); Complete-run no gate (#254); date-format inconsistency
(#248); status-badge colour semantics (#250); list-row/pagination inconsistency (#249);
zero-removal GHG (#245); readiness badge vs gate (#246); removal-draft-before-estimates
(#247); empty-state duplicate CTAs.

**Sandbox/registry note:** the deep chain (production run → … → credit batch → removal →
GHG) on a brand-new facility re-treads passes 3/4 and would mostly re-confirm known issues
and burn an Isometric-sandbox round trip per run. To get genuinely new signal under budget,
this pass: (a) ran the full **create / edit / remove / recover** loop on a **fresh facility**
(`QA Operator Pass5` / `FAC-26-007` / `81251f5b-22ce-4aae-9874-7586ca6abb79`), and (b) drove
**step 6 (final GHG statement)** on the already-provisioned `Operator Facility mqceboe4`
(`f346545f-…`) which carries a full chain + emission estimates + a submitted removal. The
coverage split is called out where relevant.

---

## Summary of new findings

| # | Severity | Finding | Layer | Issue? |
|---|----------|---------|-------|--------|
| 1 | **P1** | GHG verifier-submit 400: the Isometric rejection **reason is captured then discarded** at every layer — not logged, not persisted in attempt history, not shown. Operator *and* developer are blind to *why* it failed. (Sharper, code-located version of the prior "400 body hidden" P0.) | isometric / fn | **YES** |
| 2 | **P2** | **GPS create/update asymmetry**: create accepts a half-coordinate (only lat *or* lng); the *update* schema then refuses to save **any** later edit until GPS is repaired. Error is a non-field-anchored top banner. | schema / fn | **YES** |
| 3 | **P2** | After creating a facility the **active facility context does not switch to it**; since every form silently takes `facilityId` from context, the operator can add child records to the *wrong* facility. | UX / context | **YES** |
| 4 | **P2** | **GHG list "Submitted" badge masks `Verifier status: DRAFT`** — the statement was never accepted by the verifier (3 failed attempts) yet the list reads "Submitted". The "final" step looks done when it isn't. | cert UI | **YES** |
| 5 | **P2** | **Removals are displayed as a truncated raw UUID** (`12dba0ff…`) — no human-readable code/label, unlike every other entity (`CB-`/`R-`/`FAC-`). Operators can't tell removals apart. | cert UI | **YES** |
| 6 | **P3** | Zero-removal GHG **Confirm** step gives no warning and `CREATE` is fully enabled; **Preview never shows the computed period start**, so you evaluate "0 removals" without seeing the window it's counting. | cert wizard | refines #245 |
| 7 | **P3** | Verifier-report submission requires a **raw URL paste** — no in-app upload (despite the app's presigned-S3 `FormFileUpload` everywhere else) and no guidance on what the report must be. | cert UI | maybe |
| 8 | **P3** | GHG-statement list row is an **unlabeled `button`** (no accessible name in the a11y tree). | a11y | mechanical |

**Positive confirmations (work well; the visual-branch fixes hold):** slide-over panel
renders fully on-screen; position-picker map degrades gracefully on missing/invalid coords
and renders tiles; required-field validation is clean and inline; reactor negative-throughput
is rejected field-level; delete shows a confirmation with a constraint note; the
Isometric project-sharing guardrail is excellent (warns + names the other facilities +
disables **Link** until "I intend to share" is checked); `SANDBOX · ISOMETRIC REGISTRY`
is tagged on cert actions; `SAVING…`/disabled button states are present.

---

## Detailed findings

### Finding 1 — GHG verifier-submit 400 reason is captured, then thrown away everywhere (P1)

**Repro (browser):** `Operator Facility mqceboe4` → Certification → GHG Statements → open the
`2026-06-13 → 2026-06-30` statement → **Submit to verifier** → enter any valid-format URL
(`https://example.com/report.pdf`) → **Submit**. UI shows exactly:

```
Submit failed: Isometric POST /ghg_statements/ggs_1KT97JMH1SBXJDR4/submit → 400
```

No reason. The operator cannot tell whether the URL host is disallowed, a required field is
missing, the period is wrong, or the report is malformed. (Attempt history already shows
**3** prior failures — this has been silently un-actionable for the whole flow's life.)

**Why (code):** the rejection body *is* available and *is* dropped three times:

- `src/lib/isometric/client.ts:215` reads `bodyText`/`bodyJson` (the Isometric error body) and
  `:251–256` attaches it to `IsometricApiError.body`. **But** the failure log at `:247–249`
  logs only `{ method, path, status, attempt, code, duration_ms }` — **`bodyJson` is omitted**,
  so even server logs lack the reason.
- `IsometricApiError` (`client.ts:10`) exposes `status` and `body`, but
  `src/fn/certification/ghg-statements.ts:530` takes only `err.message`
  (`const message = err instanceof Error ? err.message : String(err)`), `:538` persists only
  that `message` into the sync-event attempt history, and `:540`
  `throw new SafeError(\`Submit failed: ${message}\`)` surfaces only that string. The
  `logger.warn` at `:491–499` logs `errorName` but not `err.status`/`err.body`.

So the literal answer to "why did my final submit fail" exists at the client boundary and is
discarded at the log, the persisted attempt record, and the UI.

**Suggested fix:** in the `catch`, special-case `IsometricApiError`: (a) log
`{ status, body }` (the in-house logger already redacts `token`/`secret`/`authorization`
keys, so a sanitized body is safe); (b) persist a sanitized `responsePayload` (not just
`errorMessage`) on the failed sync event so attempt history is diagnosable; (c) surface a
short, human reason (e.g. first validation message from the body) alongside the endpoint/status.
Add a sandbox-contract test asserting a 400 body propagates to `SafeError`.

### Finding 2 — GPS create/update asymmetry; you can create a record you then can't edit (P2)

**Repro (browser):** Facilities → **New Facility** → Name `QA Operator Pass5`, Country
`Tanzania`, Timezone `Africa/Dar_es_Salaam`, **GPS Latitude `-6.8`, leave Longitude blank** →
**Create Facility**. ✅ Created (Active Facilities 6→7) with a half-coordinate. Then **Edit**
that facility and press **Save Changes** without touching anything →

```
Validation error: Both latitude and longitude must be provided together
```

So the operator can *create* an invalid GPS pair but then can't save *any* later edit (e.g.
fixing a typo'd name) until they repair GPS they may not have set. The error is a generic
banner at the top of the panel, **not anchored to the GPS fields** — you must scroll down and
guess which field it means. Recovery (entering the missing longitude, or clearing latitude)
works and the message clears.

**Why (code):** `facilityFormSchema` (the form resolver,
`src/components/facilities/facility-form.tsx:66`) and `createFacilitySchema`
(`= facilityFormSchema`, used by `src/fn/facilities.ts:269`) have **no** both-lat/lng-together
refinement. `updateFacilitySchema` (`src/schemas/facilities.ts:194-216`) **does**. The
refinement also already exists as `facilityFormSchemaWithGpsValidation`
(`src/schemas/facilities.ts:~`) but is not the one wired to the form.

**Suggested fix:** use `facilityFormSchemaWithGpsValidation` (or fold the `.refine` into
`facilityFormSchema`) so create and update enforce the same GPS-pairing rule, and attach the
error to `path: ["gpsLongitude"]` (or render it at the GPS section) so it's field-anchored.

### Finding 3 — New facility is created but the active context doesn't switch to it (P2)

**Repro:** Create `QA Operator Pass5`; afterward the sidebar facility selector still reads
`QA Pass3 Facility`. The post-create "Link Isometric project" dialog correctly targets the new
facility, but the working context does not. Because forms never ask which facility (by design —
`facilityId` comes from context), an operator who immediately adds a reactor/feedstock/etc.
attaches it to the **previous** facility while believing they're setting up the one they just
created. This is a quiet data-integrity trap, not just friction.

**Suggested fix:** on successful create, set the new facility as the active context (update the
`?facility=` query state + localStorage) — or show an inline "Switch to QA Operator Pass5?"
affordance in the success toast / the auto-opened link dialog.

### Finding 4 — "Submitted" in the GHG list hides that the verifier step never happened (P2)

**Repro:** GHG Statements list shows the statement as **Submitted**. Opening it reveals
`Status: Submitted` (Isometric registry record exists) but `Verifier status: DRAFT`, with
"View attempt history (3)" of failed verifier submits. The list badge conflates "exists in the
registry" with "submitted to the verifier", so the operator reasonably concludes the final step
is done when the actual final step (Finding 1) has failed 3×. (Tangent to #250 colour
semantics, but this is about *which* status the badge reflects, not its colour.)

**Suggested fix:** surface verifier status in the list (e.g. `Submitted · verifier: draft`), or
badge the row by the *furthest-blocking* state so an un-verified statement doesn't read as done.

### Finding 5 — Removals shown only as a truncated UUID (P2)

**Repro:** Certification → Removals lists the row as `12dba0ff…` (raw `removals.id` prefix).
Every other entity has a human code (`FAC-26-007`, `R-26-006`, `CB-26-001`). With more than one
removal an operator cannot distinguish them; the truncated UUID is also un-searchable and
meaningless in support conversations.

**Suggested fix:** give removals a display code (e.g. `RMV-26-001`) or label them by reporting
period + linked batch(es); fall back to the Isometric `rmv_…` id rather than the internal UUID.

### Finding 6 — Zero-removal GHG: honest Preview, but no Confirm-time guard; period start hidden until Confirm (P3)

**Repro:** New GHG Statement → period end `2027-06-30` → **Next**. Preview honestly reads
"PREDICTED TO BE LINKED (0): No open removals fall within this reporting window" — **but Next
stays enabled**. Confirm then offers to create+register a year-long (`2026-07-01 → 2027-06-30`)
empty statement to the registry, and the Confirm copy never echoes "0 removals will be linked".
Also: the **computed period start is only shown at Confirm**, not at Preview — so you judge the
predicted-removal count without seeing the window that produced it.

**Suggested fix (pending #245 decision):** echo the linked-count on Confirm and require an
explicit acknowledgement for a zero-removal statement; show the resolved `start → end` range on
the Preview step where the count is evaluated.

### Finding 7 — Verifier report is a raw URL paste, no upload, no guidance (P3)

The "Submit GHG Statement" dialog has a single required **Report URL** field
(`https://example.com/report.pdf`). There is no in-app file picker — inconsistent with the
presigned-S3 `FormFileUpload` (`@/components/forms/form-file-upload`) used for every other
document in the app — and no help text on what the report must contain or how to produce it.
Combined with Finding 1, a wrong/disallowed URL fails opaquely.

**Suggested fix:** allow uploading the report via the existing storage flow (and pass the
resulting GET URL), or at minimum add hint copy + a link to the host allowlist requirement, and
validate the host client-side before the round trip.

### Finding 8 — GHG-statement list row is an unlabeled button (P3, a11y)

The clickable statement row exposes as `button` with **no accessible name** in the a11y tree
(the only label-less interactive element on the page). A screen-reader user can't tell what it
opens. Add an `aria-label` (e.g. "Open GHG statement 2026-06-13 to 2026-06-30").

---

## Workflow notes (the path a real operator walks)

1. **Create facility** → on success an opinionated **"Link Isometric project"** dialog
   auto-opens (good onboarding). Selecting a project already linked elsewhere shows a clear
   warning naming the other facilities and **disables Link until you check "I intend to share
   this project across facilities"** — a genuinely good consent gate.
2. **But** the active facility doesn't follow you to the new facility (Finding 3); you must
   open the sidebar selector and switch manually before adding anything.
3. **Infrastructure first** (Reactor) is a clean, fast form: only Identifier + Reactor Type are
   required; Sampling defaults to Method A; throughput is validated `> 0`.
4. **Edit after save** works, but the GPS-pairing asymmetry (Finding 2) can block an unrelated
   edit with a non-obvious, non-anchored error.
5. **Remove** flows are guarded: row ⋮ → Delete → confirmation dialog with a useful constraint
   note ("Reactors with associated production runs cannot be deleted").
6. **Final GHG statement** is a tidy 3-step wizard (Period → Preview → Confirm) with explicit
   sandbox tagging — but the final **Submit to verifier** fails with an opaque 400 (Finding 1),
   and the list still calls the result "Submitted" (Finding 4).

## UX issues (consolidated)

- New-facility context not adopted (F3); GPS error not field-anchored (F2); removal UUID labels
  (F5); "Submitted" overstates verifier state (F4); zero-removal Confirm has no guard and
  Preview hides the period (F6); report-URL paste with no upload/guidance (F7).
- Persisted-state cosmetics still visible: blank/whitespace facility renders as a **nameless
  card and a blank selectable row** in the facility dropdown (un-trimmed names, pass 4 #3);
  literal `Trim ⚠️ <b>QA</b>` is correctly **escaped** as text (no XSS — good).
- Date-format split persists: the GHG period input renders `dd.mm.yyyy` while the app shows ISO
  `2026-06-13` elsewhere (#248).
- "Submitted" badge is green on a removal but amber on a GHG statement (#250).

## Edge cases tested

- Empty-submit on Create Facility → 3 inline required errors (Name/Country/Timezone). ✅
- Half GPS coordinate on **create** → accepted (F2); then unrelated **edit** blocked (F2);
  recovery by completing the pair → saves. ✅
- Reactor **negative throughput** (`-5`) → field-level "Throughput must be a positive number". ✅
- Reactor **Delete** → confirmation dialog with constraint note (cancelled to preserve). ✅
- Already-linked Isometric project → share-consent guardrail + disabled Link. ✅
- GHG period **far in the future / non-overlapping** → Preview shows 0 predicted removals;
  wizard still advances to a registerable empty statement (F6).
- **Submit to verifier** with empty URL → "Enter a valid report URL" (client validation ✅);
  with a valid-format URL → opaque `→ 400` (F1).
- Country is **free text** (`z.string().min(1).max(100)`, `src/schemas/facilities.ts`) yet the
  list has an "All Countries" filter — inconsistent spellings will fragment that filter (latent
  data-quality issue; folds into the normalization discussion around #252).

## Engineering issues noticed (code-grounded)

- `IsometricApiError.body` populated then ignored: `src/lib/isometric/client.ts:247-256`,
  `src/fn/certification/ghg-statements.ts:491-499,530,538,540` (F1).
- GPS-pairing refinement present on `updateFacilitySchema` but absent from the form/create
  schema actually wired up: `src/schemas/facilities.ts`,
  `src/components/facilities/facility-form.tsx:66`, `src/fn/facilities.ts:269` (F2).
- Entity codes are a **global** sequence, not per-facility (first reactor of FAC-26-007 is
  `R-26-006`; facilities run `FAC-26-001..007`). Consistent, but worth a documented decision if
  per-facility codes are ever expected.
- Reactor row exposes **two** "Actions for R-26-006" buttons in the a11y tree (likely a
  responsive desktop+mobile dual render); harmless but duplicates interactive nodes — worth a
  glance given the responsive work on this branch.

## Suggested fixes (priority order)

1. **(P1)** Propagate the Isometric error body: log `{status, body}`, persist a sanitized
   `responsePayload` on the failed attempt, and surface a human reason in the `SafeError`.
   Sandbox-contract test for a 400.
2. **(P2)** Unify GPS validation across create/update (use
   `facilityFormSchemaWithGpsValidation` or fold the refine into the base schema) and
   field-anchor the error.
3. **(P2)** Adopt the newly-created facility as active context on success.
4. **(P2)** Show verifier status in the GHG list (don't let "Submitted" imply verified).
5. **(P2)** Give removals a human display code/label instead of a truncated UUID.
6. **(P3)** Zero-removal Confirm guard + show period range on Preview.
7. **(P3)** Allow uploading the verifier report via the existing storage flow; add guidance.
8. **(P3)** `aria-label` the GHG-statement row.

## Decision points that should become GitHub issues

- **Surface Isometric provider error bodies (P1).** Likely *new* — prior P0 framed it as "body
  hidden"; this pins it to captured-then-discarded at log + attempt-history + UI, with the fix
  shape. File as a `bug, backend` issue (or fold into the prior GHG-submit P0 if one exists).
- **Unify facility GPS validation across create/update (P2).** New; `backend, frontend`.
- **Auto-switch (or prompt to switch) to a newly-created facility (P2).** New; `frontend, decision`
  — confirm desired behavior (auto-switch vs. prompt) with the team.
- **Verifier status visibility in GHG list / badge semantics (P2).** Extends #250 but distinct
  (which status the badge reflects, not its colour).
- **Human-readable removal identifier (P2).** New; `design, frontend`.
- **Verifier report: upload vs. URL, and required-content guidance (P3).** New; `frontend, compliance`.
- (Already-open: #245 zero-removal, #248 date format, #250 badge colours, #252 identifier
  uniqueness / country normalization — observed still present, no new issue needed.)

---

*Artifacts left in the DB: facility `QA Operator Pass5` (`FAC-26-007`,
`81251f5b-22ce-4aae-9874-7586ca6abb79`, GPS `-6.8 / 39.27`, linked to
`prj_1K9YJ33RKSBX9FFF` / template `rvt_1KS4S43VPSBXA26X`) with reactor `R-26-006` "QA Kiln 01".
No GHG statement was created on the sandbox (the empty-statement wizard was cancelled at
Confirm); the verifier-submit attempt on `ggs_1KT97JMH1SBXJDR4` 400'd and changed nothing.*
