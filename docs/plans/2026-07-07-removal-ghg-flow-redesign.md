# Removal & GHG-Statement Flow — Deep Analysis + Operator-Friendly Redesign

Date: 2026-07-07 · Author: e2e QA + design pass (Claude) · Status: **built — Phases 0–4 on `feat/removal-ghg-legible-guided`, ready for PR to `staging`** (see [Implementation status](#implementation-status-as-of-2026-07-07))
Scope: `/certification/removals` (New-removal wizard + detail sheet) and `/certification/ghg-statements` (create wizard + detail sheet).

> Grounding note: Isometric protocol/registry facts below are cross-checked against the `isometric` MCP (`key-certify-concepts`, biochar protocol v1.3, ghg-accounting module v1.1). Any interpretation of Isometric docs is **non-authoritative** — verify against the linked registry docs before changing credit logic.

---

## Implementation status (as of 2026-07-07)

Branch **`feat/removal-ghg-legible-guided`** (off `staging`), epic **#380**. **All phases built; whole branch (Slice 1 + Phases 0–4) is one PR-ready unit to `staging`.** The §9 plan below is the authoritative task spec; this section records what shipped.

| Phase | State | Notes |
|---|---|---|
| **Slice 1** — #378 facility-name fallback, #379 explicit supplier pick | ✅ shipped | Low-risk quick wins. |
| **Phase 0** — one readiness source (#246) | ✅ shipped | `src/lib/certification/requirement-labels.ts` (`CERT_REQUIREMENT_META`) attached to every check type. |
| **Phase 1** — plain language + ⓘ "Why?" (#291 partial) | ✅ shipped | `whyDetail` behind `InfoHint`; CERT-badge tooltip. Template-driven field *visibility* (#291 core) deferred — see below. |
| **Phase 2** — removal readiness workspace (#247) | ✅ shipped | Step 1 = ready-lead / not-ready-collapsed; every gap deep-links to its fix; no dead-end Continue. |
| **Phase 3** — GHG honesty + empty-statement guard (#245/#250) | ✅ shipped | Server guards for 0-in-window / 0-linked; honest "expected in this statement" framing; one status ladder. |
| **Phase 4** — onboarding / CRUD polish (#348 + QA C1–C5) | ✅ shipped | **C1/#348** durability tier → read-only info block (no locked "Available later" false choice); **C2** energy `e.g.` placeholders; **C3** CERT tooltip (already Phase 1); **C4** map style-fetch failure now trips the manual-entry fallback (error handler + 12s timeout). |

**Decisions closing Phase 4:**
- **C5** (first-run dashboard "start here") — **OUT OF SCOPE** for #380; #362 (first-run pass) is closed and this is a separate P3. Revisit as its own ticket if wanted.
- **Deferred (not built):** #291 template-driven field *visibility* — ~10 open stakeholder questions; do not build speculatively.

**Next step:** PR the whole branch to `staging` (Slice 1 + Phases 0–4). No further Phase-4 code work is open.

---

## 0. TL;DR

The removal + GHG flows feel like "expert tools" for **three separable reasons**, only two of which are fixable in-product:

1. **Inherent method complexity (can't remove, must make legible).** This deployment is a **1000-year** durability client (DEC). The 1000-year method genuinely requires specialised lab data — random reflectance (R₀) + TGA non-reactive carbon (Sanei 2024), ≥3 replicate samples across distinct runs/days. That burden is real and protocol-mandated; the UI's job is to make it *understandable and guided*, not to hide it.
2. **App-imposed complexity (removable).** Protocol/registry jargon shown raw, the same check phrased differently on 3 screens, "fix it elsewhere" ping-pong, a wizard that only *diagnoses* and can't move forward, and a GHG flow that lets you submit an empty statement and over-promises what will link. **This is the bulk of the pain and it is entirely ours to fix.**
3. **Model mismatch (must design *with*, not against).** A GHG statement's membership is decided **server-side by reporting period** — the operator picks a date, the registry decides what's inside. That is an Isometric constraint, not an app choice. The current UI hides/over-promises this; the fix is to make the date→contents relationship *transparent and honest*, not to invent operator-side removal-picking that the registry doesn't support.

The redesign below keeps every protocol guarantee but re-frames both flows around **one operator question at a time, in plain language, with the fix always one click away and never a dead end.**

Most of the concrete fixes are **already filed** (#291, #245, #246, #247, #250, #348, #375). This doc is the connective UX layer + the sequencing, and flags the 2 genuinely-new items.

---

## 1. What the operator actually has to do vs. what the app makes them confront

From the code map (`fn/certification/submit-removal.ts`, `certify-context-core.ts`, `removal-submission-build.ts`) the removal is a **selection + confirmation** flow. The operator's real inputs are tiny:

| Operator genuinely provides | Where | Registry / app derives automatically |
|---|---|---|
| Which complete credit batches to group | Removal wizard step 1 | Weighted batch chemistry, per-run mass attribution (§8.6.2), transport mass·distance + coverage, emissions datapoints, reporting window, CO₂e stored, soil-temperature reference, durability gate |
| A submit click (+ prod confirm) | Step 2 | Everything on the GHG-entry payload |
| Optional evidence mirroring | Detail sheet | Idempotency, supersede, source ids |

Everything that *determines whether you can submit* is entered **upstream** — credit-batch page, samples, deliveries, facility settings. The removal wizard **surfaces the resulting gaps but cannot fix them**, so the operator ping-pongs between the modal and 4+ other pages.

**The core insight:** the removal wizard is 95% *diagnosis* and 5% *action*, but it's dressed as an action ("New removal" → wizard → Submit). It should be honest about being a **readiness/assembly step**, and every gap it shows should be **actionable in place or one click from its fix**.

---

## 2. Evidence from the live walkthrough (Kilimanjaro, the one linked facility)

### 2.1 Removal wizard, step 1 — the jargon wall
CB-26-001 rendered as an incomplete card:
- **"Carbon & durability inputs complete"** → "Missing: Mean random reflectance (R₀), Std dev of R₀, Mean non-reactive carbon, Std dev of non-reactive carbon"
- **"Entity certifier fields complete"** → "Missing: Production run PR-26-001: Telemetry readings, Application AP-26-001: geotagged stockpile photo, …"
- "0 of 1 batches ready", Continue disabled → **dead end**.

Problems, in order of severity:
1. **Positively-phrased check names next to "Missing:"** ("… complete" while incomplete) read as a contradiction. On the batch page the *same* check reads "Carbon & durability inputs **missing**". Same fact, opposite words. (→ #246 one-shared-readiness-source.)
2. **Raw protocol/lab vocabulary, no translation, no why, no how.** "Mean random reflectance (R₀)", "non-reactive carbon", "telemetry readings", "geotagged spreading photo".
3. **No forward motion** for the common not-ready case.

### 2.2 GHG create wizard — the empty-statement trap
- Step 2 "Predicted removals": "PREDICTED TO BE LINKED (0) — No open removals fall within this reporting window." **Next stays enabled.**
- Step 3 confirms: "Isometric derives the period start and links the matching Removals." (there are none) — **no warning.**
- Result observed live: an existing statement `ggs_…·v1`, STATUS **Submitted**, **LINKED REMOVALS 0** — a registry record that rolls up nothing, and (per the sheet) "can't be withdrawn". (→ #245.)

### 2.3 GHG detail sheet — clashing status words
- Top badge **"Submitted"** vs field **VERIFIER STATUS "DRAFT"** vs button **"SUBMIT TO VERIFIER"**. "Submitted" here means "created in the registry," not "submitted to the verifier." One word, two meanings, one screen. (→ #250 rename to "In verification".)
- "SUBMIT TO VERIFIER" is offered on a 0-removal statement.
- Withdraw note points to "removals above" that don't exist for an empty statement.

---

## 3. Why it feels "expert" — root-cause taxonomy

| Symptom | Root cause | Fixable in UI? |
|---|---|---|
| R₀ / non-reactive carbon / ≥3 replicates | 1000-year method is genuinely rigorous | **Legible, not removable** |
| "registry submission unit", "GHG entry", "datapoint", "blueprint", "s_fraction" | Registry vocabulary shown raw | **Yes** — translate, tuck citations behind "why" |
| Same check worded 3 ways across batch/removal/badge | 3 surfaces, drifting copy | **Yes** — one readiness source (#246) |
| "Fix on batch page" ping-pong | Wizard diagnoses, fixes live elsewhere | **Yes** — inline/guided fixes |
| Can create+submit an empty GHG statement | No 0-removal guard | **Yes** (#245) |
| "Predicted to be linked" then 0 actually link | Client guesses the period start; registry decides post-POST | **Yes** — honest framing (§5) |
| Operator can't choose which removals attach | Registry decides membership by period | **Design *with* it** — transparency, not control |

---

## 4. Redesign — Removals

**Principle: the removal flow is a *readiness workspace*, not a form.** Rename the mental model from "fill out a removal" to "get a batch ready, then ship it."

### 4.1 Replace the diagnosis-only wizard step 1 with an actionable readiness list
- Each not-ready batch shows a **plain-language checklist with an inline action per gap**, not a paragraph of missing protocol terms. Example rewrite:
  - Raw today: *"Carbon & durability inputs complete — Missing: Mean random reflectance (R₀), Std dev of R₀, Mean non-reactive carbon, Std dev of non-reactive carbon"*
  - Proposed: **"Lab chemistry incomplete"** → "This batch needs reflectance (R₀) and non-reactive carbon results from your lab, for at least 3 samples. **[Add lab results]**" with a **ⓘ "Why?"** that expands the protocol detail (Sanei 2024, std-dev for uncertainty) for the curious. (The building blocks — `InfoHint`, `SectionLabel hint` — already exist per `docs/forms.md`.)
- Every gap row is a **button that deep-links to the exact fix** (batch → samples, run → readings CSV, application → photo upload), returning to the workspace. No dead-end "Continue disabled".
- Verdict copy states the **requirement**, with an explicit ✓/✗ — never "… complete" while incomplete (#246).

### 4.2 Make "ready" batches the happy path
- When ≥1 batch is ready, lead with them; collapse not-ready batches under "Not ready yet (N)".
- For the **1:1 ready case**, the detail sheet already offers one-click **Submit** — keep that as the primary fast path and de-emphasise the wizard.

### 4.3 Translate the step-2 requirements checklist + submit gate
- The 5-row registry checklist ("Facility linked…", "Transport legs aggregate cleanly", "Sampling & durability eligibility met") → plain outcomes with "why" tuck-aways. Protocol section numbers (§8.3, §8.6.2) move behind "Learn more".
- Keep the fail-closed server layers exactly as-is (they are correct and protect credit integrity) — only change how their *blocked reasons* are phrased for the operator.

### 4.4 This is largely **#291** (template-driven fields) + **#246** (one readiness source) + **#247** (prereq check before create)
The redesign is mostly a **copy + sequencing + deep-link** layer on top of those. It does **not** require touching the submission/idempotency/gate logic.

---

## 5. Redesign — GHG statements

**Principle: be honest that the *date defines the contents*, and never let an empty statement reach the registry.**

### 5.1 Reframe step 1 from "pick an end date" to "confirm what this period contains"
- Lead with the **plain sentence**: "A GHG statement bundles the removals you've already submitted this period so a verifier can review them. Pick the period end — we'll show you exactly which removals fall inside."
- Show the derived window and, immediately, the **actual open removals** that will (predictably) fall in it — before the operator commits.

### 5.2 Kill the empty-statement trap (**#245**)
- If **0 removals** fall in the window: **block Next / Create** with "This period has no submitted removals yet — a statement now would be empty. Submit a removal first, or pick a period that includes one." (Allow an explicit, clearly-labelled nil-return only if the protocol ever needs it.)
- Never offer **Submit to verifier** on a 0-removal statement.

### 5.3 Stop over-promising "Predicted to be linked"
- The client computes membership from a **guessed** period start; the registry's is authoritative only post-POST. Reword "**Predicted** to be linked" → "**Expected** in this statement (confirmed after you create it)", and after creation surface any **delta** ("You expected 3; the registry linked 2 — here's the one it placed in the prior period and why"). Today a silently-excluded removal produces **no** warning (`ghg-entry-membership.ts` only warns about returned-but-unmatched ids) — add the "expected-but-excluded" case.

### 5.4 Fix the status vocabulary (**#250**)
- "Submitted" (created in registry) vs "Submitted to verifier" collide. Adopt #250's "In verification" rename and show a **single, linear status ladder**: Draft → In registry → In verification → Verified → Issued. One word per state.

### 5.5 Accept the model, expose it
- Do **not** build operator-side removal-picking — Isometric decides membership by period (confirmed: create API takes only `{project_id, end_on}`; membership reconciled from `ghg_entry_ids` post-fetch). Instead make the period→contents mapping the **centre** of the UI so the operator always sees cause and effect.

---

## 6. Cross-cutting copy + component work

- **One readiness source of truth** feeding batch page, removal wizard, and badges with identical strings (#246).
- **Plain-language dictionary** for every protocol term surfaced to operators; raw protocol terms + § citations live behind ⓘ "Why?" (leverages #291's template-driven field metadata to know *which* fields even show).
- **"CERT" badge** appears ~10×/form unexplained — give it a single tooltip ("counts toward certification") or replace with a clearer affordance.
- **Env banner** ("Sandbox · rehearse the workflow") is good — keep.

---

## 7. Open decisions for you (grill me back)

1. **Readiness workspace vs. wizard.** Do you want the removal flow reframed as an always-visible *readiness workspace* on the batch/removal pages (gaps + inline fixes), with "Submit" as the terminal action — or keep the modal wizard and just fix its copy/dead-ends? (I recommend the former; it kills the ping-pong.)
2. **How much protocol vocabulary is allowed on the primary surface?** My proposal hides §-citations + Latinate terms behind "Why?". Is there a verifier/audit reason operators must see raw protocol terms up front?
3. **1000-year is the only tier here (intentional).** Since the method's lab burden is inherent, the win is *legibility + guided lab-data entry*, not simplification. Agree? (If a 200-year client is near, the tier selector should become a real choice; today it shows a locked "200-year — Available later" that reads as a false choice — fold into #348.)
4. **Empty GHG statements** — block entirely (my rec, #245), or allow an explicit nil-return draft that just can't be submitted?
5. Should I turn §4–5 into a phased implementation plan and file the connective UX issue that links #291/#245/#246/#247/#250, or is #291 the right home?

---

## 8. Issue map (what's already tracked)

| Finding | Existing issue |
|---|---|
| Raw protocol fields shown; should derive from template | **#291** |
| Empty GHG statement can be created/submitted | **#245** |
| Same check worded differently across surfaces | **#246** |
| Removal wizard should check prereqs before create | **#247** |
| "Submitted" status word collision | **#250** |
| Durability tier fields/tooltips (200 vs 1000) | **#348** |
| 1000-year batch checklist stuck "inputs missing" | **#375** |
| Cert submit not facility-scoped (IDOR) | **#277** |
| Whitespace-name regression of closed #361 | **#378** (new) |
| Feedstock auto-selects wrong-provenance supplier | **#379** (new) |

---

## 9. Decisions taken + phased implementation plan

**Decisions (2026-07-07):**
- **Aim = "legible + guided", not "simplified".** The 1000-year method's lab burden is inherent; the redesign makes it understandable and guided, and keeps every protocol guarantee. (200-year tier strategy is out of scope for now.)
- **Removal flow = readiness workspace,** not a modal wizard: gaps become inline actions deep-linking to their fix; "Submit" is the terminal step; no dead-ends.
- Tracked by **one connective UX issue** linking #291 / #245 / #246 / #247 / #250 (+ new #378/#379).

**Guardrail:** none of this touches the fail-closed submission logic in `fn/certification/submit-removal.ts` (config preflight, §8.6.2 front-loading, TOCTOU re-asserts, idempotency/supersede). We change *what the operator sees and how gaps are resolved*, never the credit-integrity gates. Every phase follows the layered checklist (schemas → data-access → fn → hooks → components → e2e) from `.claude/CLAUDE.md`.

### Phase 0 — One readiness source of truth (rides #246)
- Single readiness model feeding the batch-detail checklist, the removal readiness view, and the dashboard/badges — identical strings everywhere (kills the "…complete" vs "…missing" divergence).
- Each check carries three fields: `requirementLabel` (plain), `whyDetail` (protocol § + citation, shown behind ⓘ), `fixTarget` (deep link).
- Exit test: the same batch shows byte-identical gap text in all three surfaces.

### Phase 1 — Plain-language + template-driven fields (rides #291)
- A term map: protocol/registry vocabulary → operator language; raw terms + § citations move behind ⓘ "Why?" (`InfoHint`, `SectionLabel hint` already exist).
- Which fields/checks even render is derived from the **active removal template's components** (#291), so operators never see inputs their template doesn't use.
- Apply to: removal readiness checklist, batch checklist, GHG copy, the "CERT" badge (one tooltip).

### Phase 2 — Removal readiness workspace
- Reshape New-removal step 1 into a readiness view: ready batches lead; not-ready batches collapse under "Not ready yet (N)".
- Every gap row is a **button** deep-linking to its exact fix (batch→samples, run→readings CSV, application→geotagged photo) and returning to the workspace. Remove the "Continue disabled" dead-end.
- Keep the 1:1 one-click **Submit** fast path from the detail sheet.
- Translate the step-2 requirements checklist + disabled-submit tooltip (copy only; server gates unchanged).

### Phase 3 — GHG honesty + empty-statement guard (rides #245, #250)
- Block create/submit when **0 removals** fall in the window; never offer "Submit to verifier" on a 0-removal statement.
- Reframe step 1 as "confirm what this period contains" — show the actual open removals in-window before commit.
- "Predicted to be linked" → "Expected in this statement (confirmed after you create it)"; after create, surface the **expected-but-excluded** delta (today it warns only about returned-but-unmatched ids).
- Status vocabulary → one linear ladder (Draft → In registry → In verification → Verified → Issued), adopting #250's rename.

### Phase 4 — Onboarding / CRUD polish
- Durability tier as **read-only info** (plain-language) on single-tier deployments, not a radio with a locked option (#348).
- Energy placeholders → "e.g. …" + explicit missing-vs-zero affordance (QA C2); one "CERT" tooltip (C3); map-unavailable state (C4).
- Ship the two quick correctness fixes: #378 (whitespace name), #379 (supplier default).

### Sequencing
Phase 0 → 1 unblock everything (shared model + plain-language). Phase 2 (removals) and Phase 3 (GHG) are parallelisable once 0/1 land. Phase 4 is independent and can ship anytime. Quick wins (#378/#379) need not wait.

Tracking epic: **#380**.

### File targets (from the code maps — start points, not exhaustive)
- **Readiness model (Phase 0):** `src/lib/certification/readiness.ts` (`deriveRemovalReadiness`, `buildRemovalRequirementsChecklist`), `src/lib/certification/batch-health.ts` (`deriveBatchHealth`), `src/lib/certification/readiness-facts.ts`. Add `{ requirementLabel, whyDetail, fixTarget }` to each check type here so all surfaces read one shape.
- **Plain-language / template-driven (Phase 1):** term map in `src/lib/certification/` (new); consume via `InfoHint`/`SectionLabel hint`; field visibility from the active template resolver used by `submit-removal`/#291.
- **Removal workspace (Phase 2):** `src/components/certification/new-removal-dialog/{select-batches-step,submit-step,index}.tsx`, `removal-detail-sheet.tsx`; batch checklist on the credit-batch detail page (`src/app/(app)/credit-batches/[id]` + `src/components/credit-batches/*`). Deep-link targets already exist (`/credit-batches/<id>`, samples, readings, applications).
- **GHG (Phase 3):** `src/components/certification/{ghg-statement-create-drawer,ghg-statements-list,ghg-statement-detail-sheet,ghg-statement-submit-dialog}.tsx`; membership/warnings in `src/lib/isometric/utils/ghg-entry-membership.ts`; server `src/fn/certification/ghg-statements.ts` (guard 0-removal in `createGhgStatementDraft` + block submit in `submitGhgStatementToVerifier`). Status ladder: certification status-badge component + `chooseGhgSubmitMode`.
- **Onboarding/CRUD (Phase 4):** `src/components/facilities/facility-form.tsx` + `src/components/certification/durability-tier-select.tsx` (tier as read-only info); production-run form energy placeholders; feedstock form supplier default (#379); facility name schema `src/schemas/facilities.ts` + display fallbacks (#378).

### Slice 1 — start here (low-risk, self-contained, no gate changes)
1. **#378** — `src/schemas/facilities.ts` name → `.trim().min(1)`; card + selector fallback `name?.trim() || code`; normalise the existing `"   "` row. (+e2e)
2. **#379** — feedstock form: remove silent supplier pre-select; derive transport distance only after explicit pick. (+e2e)
3. **Phase 0 scaffolding** — extend the readiness check type with `requirementLabel`/`whyDetail`/`fixTarget`; make the removal step-1 card and the batch checklist render `requirementLabel` (fixes the "…complete" vs "…missing" contradiction as the first visible win). (+e2e asserting identical strings across surfaces)

These three land independently, prove the shared-readiness direction, and don't touch `submit-removal` fail-closed logic.
