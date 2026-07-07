# E2E Operator Walkthrough — QA Findings & Fix Plan

Date: 2026-07-07 · Method: browser walkthrough as a new operator (created facility "Serengeti Char Collective" FAC-26-003) + drove the certification flows on the one registry-linked facility (Kilimanjaro FAC-26-001) + DB/code cross-checks.

**Every finding below was verified against the code before classifying.** Two "bugs" turned out to be intentional design (durability-tier lock; org-shared suppliers) — see notes. Removal/GHG UX has its own deep doc: `2026-07-07-removal-ghg-flow-redesign.md`.

Legend — Severity: **P1** ship-blocker-ish · **P2** real, fix soon · **P3** polish. Status: **NEW** (not tracked) · **TRACKED (#)** · **BY DESIGN** · **ENV** (test-harness only).

---

## A. Genuinely new (not in the backlog)

### A1 — [P2, NEW → filed #378] Whitespace-only facility name renders blank everywhere (regression of closed #361)
- Facility FAC-26-002 has `name = "   "` (3 spaces, verified in DB). Its card shows only the code (no title); the **facility selector renders blank** too — and it was the initially-selected facility, so the whole app was scoped to a nameless facility.
- #361 ("3 empty-start bugs — … **whitespace names** …") is **CLOSED** but the symptom persists. Root cause is almost certainly a `name || code` fallback that treats `"   "` as truthy.
- **Fix:** (1) name schema `.trim().min(1)` server + client (reject whitespace-only) and backfill/repair the existing row; (2) display fallback should use `name?.trim() || code` (trim before the falsy check) in the card **and** the selector. Consider reopening #361.

### A2 — [P2, NEW → filed #379] Feedstock form auto-selects a default supplier (+ cascades transport distance), risking wrong provenance
- On the brand-new Serengeti facility, the Create-Feedstock form pre-filled Supplier = "Kilimanjaro Forestry Co-op" (the only supplier in the system) and auto-derived Transport distance = 8.3 km from it.
- **Not an authz/scoping bug:** suppliers are intentionally **org-shared** (`data-access/suppliers.ts:126` "shared-data model, no per-user scoping"; `getSupplierOptions(userId)` has no facility filter). Cross-facility visibility is by design.
- **The real issue:** silently defaulting the Supplier (and its CERT-flagged transport distance) means an operator who doesn't notice logs feedstock against the wrong party — bad chain-of-custody provenance, by default.
- **Fix:** don't pre-select a supplier; require explicit choice (or only auto-select when exactly one exists **and** show it as an obvious, editable default). Re-derive transport distance only after an explicit pick. (Relates to but distinct from #104.)

---

## B. Certification flows — mostly already tracked (see redesign doc for the UX)

- **B1 — [P1] Empty GHG statement can be created & submitted.** Live: `ggs_…·v1` Submitted with **0 linked removals**; wizard's Next stays enabled at "PREDICTED TO BE LINKED (0)"; "Submit to verifier" offered on 0-removal statement. → **TRACKED #245**.
- **B2 — [P2] Same readiness check phrased oppositely across surfaces.** Removal wizard: "Carbon & durability inputs **complete**" (while incomplete); batch page: "… **missing**". → **TRACKED #246**.
- **B3 — [P2] "Submitted" status word collides** with "submit to verifier" (badge Submitted vs verifier-status DRAFT vs button Submit-to-verifier). → **TRACKED #250**.
- **B4 — [P2] 1000-year batch checklist stuck "pending inputs".** CB-26-001 "0 of 3 usable samples"; CO₂e stored "—" because R₀/non-reactive carbon absent. → **TRACKED #375**.
- **B5 — [P2] Removal wizard shows raw protocol/lab jargon with no translation, why, or inline fix** ("Mean random reflectance (R₀)", "non-reactive carbon", "geotagged spreading photo") and dead-ends when nothing is ready. → largely **TRACKED #291 / #247**; full proposal in redesign doc.
- **B6 — [P3] "Over-promise" of predicted linkage** (client-guessed period start; silently-excluded removals produce no warning). → redesign doc §5.3.

---

## C. Onboarding / CRUD forms

> **Status (2026-07-07, #380 Phase 4 — built on `feat/removal-ghg-legible-guided`):** C1 ✅ (durability tier → read-only info block, no locked false choice), C2 ✅ (energy `e.g.` placeholders), C3 ✅ (CERT tooltip shipped in Phase 1), C4 ✅ (map style-fetch failure now trips the manual-entry fallback via an error handler + 12s timeout; the original no-key symptom was already handled). **C5 — OUT OF SCOPE** for #380 (#362 first-run pass is closed; revisit as its own ticket).

- **C1 — [P2, TRACKED #348] Durability-tier selector is a jargon-heavy false choice on facility create.** "1000-YEAR — Random reflectance (R₀) + TGA non-reactive carbon (Sanei 2024)" selectable; "200-YEAR — Available later" **locked**. **BY DESIGN** (`facility-form.tsx:204`, `DEFAULT_DURABILITY_OPTION="1000_year"` — this deployment is a 1000-year client; 200-year unlocks "when a 200-year client onboards"). *Fix (UX only):* on a single-tier deployment, present the tier as **read-only info with plain-language explanation**, not a selectable radio with a locked option that reads as a choice. Fold into #348.
- **C2 — [P2] Production-run Energy fields use bare-number placeholders "50 / 25 / 10 / 100"** (verified `value=""`, `placeholder="50"`), unlike every other field's "e.g. 500". With the helper "a blank field reads as missing, not zero", an empty energy field *displaying* "50" can be misread as filled → operator skips CERT-critical emission inputs → silent downstream block. **Fix:** use "e.g. 50" placeholders **and** make missing-vs-zero explicit (these feed the emissions calc). **NEW** (minor).
- **C3 — [P3] "CERT" badge appears ~10×/form, unexplained.** Give it one tooltip ("counts toward certification") or a clearer treatment. **NEW** (minor).
- **C4 — [P3] Facility create map degrades to a perpetual "LOADING MAP…" + "Address search unavailable"** when geo keys are absent (local). Show an explicit "Map unavailable — enter GPS manually" state instead of an infinite loading label. **NEW** (minor; local-only symptom, but the empty state reads as broken).
- **C5 — [P3] First-run dashboard has no "start here" guidance** for a brand-new facility (empty KPIs only). Note: **#362 (first-run pass) is CLOSED** — likely considered done; re-confirm whether a get-started checklist was in scope.

---

## D. Positives worth keeping

- Consistent `EmptyState` (icon + "No X yet / Create your first X" + CTA) across every list route.
- Storage-bin selector is correctly facility-scoped with inline "+ Add New Bin" quick-add — the right pattern (Supplier should mirror it re: not auto-selecting).
- Reactor auto-selects the facility's own reactor on the run form (correct scoping).
- Registry-link gate is clean: cert routes redirect to Settings, cert nav items hide until linked.
- FormSpine numbered rails + side-sheet detail mirrors are coherent.

---

## E. Test-environment caveats (not app bugs)

- **E1 — Claude-in-Chrome window hard-locked at 686×440 CSS (DPR 2)**; `resize_window` is a no-op, `cmd+0`/`cmd+-` zoom ignored. All testing happened in the app's **narrow/responsive layout** — a **true-desktop-width UX pass is still owed** (esp. dense cert screens). Narrow layout itself rendered fine (sidebar persists at 686px; side-sheets size correctly).
- **E2 — Render scale flipped unpredictably (686↔1568↔1779) mid-session**, making pixel-clicks unreliable (one misclick dismissed the feedstock sheet). Ref-based interaction (`read_page`→`form_input`) was the reliable path.
- **E3 — Extension disconnected twice** (transient; recovered via `tabs_context_mcp`).
- Routes not individually screenshotted this session (share the verified shell/EmptyState pattern): chain-of-custody, formulations, biochar-products, storage-locations, energy, suppliers, customers, orders, deliveries, applications, samples, production-processes, admin.

---

## Suggested order of attack
1. **B1 (#245)** empty-statement guard — highest correctness risk (junk registry records).
2. **A1** whitespace-name regression + **A2** supplier auto-select — quick, correctness-preserving.
3. **B2/B3 (#246/#250)** readiness copy + status vocabulary — cheap, high legibility win.
4. **Redesign doc §4–5** removal/GHG operator-friendly layer (rides on #291) — the big one; decide direction first (redesign doc §7).
5. **C1–C4** onboarding polish.
