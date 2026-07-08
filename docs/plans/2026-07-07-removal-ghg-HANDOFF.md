# HANDOFF — Removal & GHG "legible + guided" redesign

Read this first. It's the entry point for a fresh session continuing this work.

## What happened
An e2e operator walkthrough of noma-dmrv (2026-07-07) QA'd the certification flows and produced a redesign. Two planning docs + three GitHub issues came out of it. Implementation has **not started** (only analysis + file-location scouting).

## Where things are
- **Branch:** `feat/removal-ghg-legible-guided` (branched off `staging`). No code changed yet.
- **Docs (in `docs/plans/`, committed on this branch):**
  - `2026-07-07-removal-ghg-flow-redesign.md` — deep analysis + phased plan (§9) + file targets + Slice 1. **The plan.**
  - `2026-07-07-e2e-qa-findings.md` — prioritized QA fix list (findings A1–E3), each validated against code.
  - this handoff.
- **Issues:** epic **#380** (rolls up #291, #245, #246, #247, #250, #348, #375 + new **#378** whitespace name, **#379** feedstock supplier default).
- **Decisions taken (user):** aim = **legible + guided** (not "simplified" — 1000-yr lab burden is inherent); removal flow = **readiness workspace**; deliver a **phased plan + connective epic** (done → #380).

## Guardrail (do not violate)
Do NOT touch the fail-closed submission logic in `src/fn/certification/submit-removal.ts` (config preflight, §8.6.2 front-loading, TOCTOU re-asserts, idempotency/supersede). This work changes **what the operator sees and how gaps are resolved**, never the credit-integrity gates. Follow the layered pattern (schemas → data-access → fn → hooks → components → e2e).

## Start here — Slice 1 (low-risk, self-contained)

### 1. #378 — whitespace facility name renders blank
**Finding refinement (already verified):** the name schema ALREADY trims on every write path — `src/schemas/facilities.ts:152` (form), `:206` (update), `:307` (quick-add). **Do NOT re-add validation.** The `"   "` row (FAC-26-002, id `f9e6158f-dd02-4590-b057-6efd48439c05`) is stray legacy/manual test data. The real fix is a **defensive display fallback**:
- `src/components/facilities/facility-card.tsx:58` — `{facility.name}` → render `facility.name?.trim() || facility.code`.
- `src/components/navigation/facility-selector.tsx` — same fallback where the selected/opt name renders.
- Check `src/components/navigation/sidebar-content.tsx` + `facility-provider.tsx` for the selected-facility label.
- Optional: normalise the stray row (or leave it — it's test data; the fallback makes it render its code).
- Add/adjust an e2e assertion that a blank-name facility shows its code.

### 2. #379 — feedstock form auto-selects a default supplier
- Suppliers are intentionally **org-shared** (`src/data-access/suppliers.ts:126`) — do NOT "scope" them. The bug is the **silent default selection** on the create-feedstock form (it pre-picks the only supplier + cascades its CERT transport distance).
- Find where the supplier EntitySelect gets its default in the feedstock form (`src/components/feedstock/*` / the feedstock create form) and **remove the auto-pick**; require explicit choice. Gate transport-distance auto-derivation on an explicit supplier pick.

### 3. Phase 0 scaffolding — one readiness source (fixes the worst copy bug first)
- In `src/lib/certification/readiness.ts` extend each check with `requirementLabel` (plain), `whyDetail` (protocol § behind ⓘ), `fixTarget` (deep link).
- Make the removal step-1 card (`src/components/certification/new-removal-dialog/select-batches-step.tsx`) and the batch checklist (credit-batch detail page) render `requirementLabel`. This kills the contradiction where the removal wizard says "Carbon & durability inputs **complete**" while the batch page says "…**missing**".
- e2e: assert the same batch shows identical gap strings on both surfaces.

## Testing notes
- **Only `FAC-26-001 Kilimanjaro` (id `a348cbb3-8482-4307-aa0f-d1e8d15ea326`) is registry-linked** — the only place cert flows render. Its batch `CB-26-001` is 1000-year and not-ready (needs R₀ reflectance + non-reactive carbon). A new facility can't reach `/certification/*` (redirects to Settings until an Isometric project is linked).
- e2e requires `DISABLE_RATE_LIMIT=true` in `.env.local` + copy `.env.test`/`.env.local` into any worktree (see memory / CLAUDE.md).
- **Owed:** a true-desktop-width UX pass — this session's browser was hard-locked to a narrow 686px layout (harness limitation), so wide-viewport rendering of the dense cert screens was not verified.

## Full detail
Everything above is expanded in `2026-07-07-removal-ghg-flow-redesign.md` (§4–5 redesign, §9 phased plan + file targets) and `2026-07-07-e2e-qa-findings.md`.
