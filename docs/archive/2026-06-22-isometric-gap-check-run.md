# Isometric Gap-Check — Run Summary (2026-06-20 → 22)

Dated artifact recording the first full run of the `isometric-gap-check`
workflow (`.claude/workflows/isometric-gap-check.js`). Non-authoritative —
the per-gap detail is a workflow output, not a compliance ruling; verify each
finding against the linked Isometric authority before acting.

**Run:** `wf_cb2baa33-433` · 7 pinned modules/protocols · 369 requirement atoms
extracted · **cost ~329 agents / 16.5M tokens / ~2 h** (the run blew the session
limit mid-verification and needed a resume pass).

## Status caveat — read before using the numbers

The run did **not** produce a clean synthesis report. Bootstrap, all Authority
extraction, and all Coverage mapping completed, but the adversarial **Verify**
stage and final **Synthesis** partially failed on a session limit. So the raw
"252 confirmed gaps" headline is **inflated** and must not be read as 252 real
gaps. See per-module verify status below.

## Conclusion 1 — version drift on all four core pins (reliable, actionable)

Bootstrap (which completed cleanly) independently re-detected the exact drift
already tracked at [`docs/open-questions.md`](../open-questions.md) →
*"Certify-removal redesign — pinned biochar protocol behind latest certified"*:

| Module | Pinned | Latest certified | Certified |
|---|---|---|---|
| biochar (protocol) | 1.2 | **1.3** | 2026-05-22 |
| biochar-storage-soil-environments | 1.2 | **1.3** | 2026-05-22 |
| energy-use-accounting | 1.2 | **1.3** | 2026-03-13 |
| ghg-accounting | 1.0 | **1.1** | 2026-03-24 |
| biomass-feedstock-accounting | 1.3 | 1.3 | current — no drift |
| transportation | 1.1 | 1.1 | current — no drift |
| embodied-emissions | 1.0 | 1.0 | current — no drift |

The re-pin decision and per-module impact analysis already live in
`open-questions.md` (the 2026-06-18 audit entry, now annotated with this
re-confirmation). Nothing new to build here — it's a registry-side template
re-authoring decision, not a `versions.json` edit.

## Conclusion 2 — verification is load-bearing; the first pass over-flags

For the five modules whose adversarial Verify stage completed, **30–47% of
candidate gaps were refuted as false positives**:

| Module | Candidates | Confirmed | Dropped | Verify |
|---|---|---|---|---|
| storage-soil | 71 | 43 | 28 (39%) | ✅ completed |
| energy-use | 35 | 30 | 5 (14%) | ✅ completed |
| transportation | 35 | 23 | 12 (34%) | ✅ completed |
| embodied-emissions | 19 | 10 | 9 (47%) | ✅ completed |
| biomass-feedstock | 37 | 37 | 0 | ⚠️ ran but refuted 0 / flagged 0 COVERED — treat as over-flagged, manual review |
| biochar | 60 | 60 | 0 | ❌ verify failed — **unverified**, kept conservatively |
| ghg-accounting | 56 | 49 | 7 | ⚠️ verify largely failed — **mostly unverified** |

**Net:** the ~143 confirmed gaps across the four cleanly-verified modules
(storage/energy/transport/embodied) are trustworthy; the ~109 from biochar +
ghg-accounting are **not yet verified** and the biomass 37/37 needs a manual
look. The full per-finding list (statements, file refs, recommended actions)
was never synthesised — it lives only in the run journal
(`…/workflows/wf_cb2baa33-433/journal.jsonl`).

## Conclusion 3 — the run mostly re-confirmed already-tracked gaps

A walk of `open-questions.md` shows the major gap classes a check like this
surfaces are **already documented as deferred work** — a good sign the tracker
is reasonably complete:

- `<1%` sampling materiality → dropped `ghg_materiality_assessments` / P0-13
- loss accounting → dropped `loss_records`
- buffer pool / reversal risk → dropped `reversal_risk_assessments`
- transport factor vintage & round-trip → `isometric/transport-v1.1-evidence`
- co-product Procedure-4 allocation → inside the drift entry's GHGAM 1.1 analysis

## Known-gap oracle (workflow self-test)

The four user-flagged gaps the workflow checks itself against — (a) pyrolyzer CO
direct emission, (b) pyrolyzer CH₄ direct emission, (c) staff-travel period
emission (ADR 0005), (d) sampling <1% materiality (P0-13) — are all already
captured in [[isometric-emission-gaps]] / `open-questions.md`. The oracle could
not run automatically because synthesis failed; confirmed manually here.

## Workflow improvement made this session

The Verify stage was 313 of the 329 agents (one adversarial agent per
candidate). It is now **batched** (one verifier per ~6 candidates, default
refuted=true preserved) so a clean re-run should land ~70 agents. See
[[isometric-gap-check-workflow]].

## To get the full per-gap synthesis

Re-run the (now batched, cheaper) workflow on a fresh session:
`Workflow({ scriptPath: ".claude/workflows/isometric-gap-check.js" })`. If only
the verified-but-unsynthesised findings are wanted, mine
`journal.jsonl` from the run dir above. Add `open-questions.md` entries only for
confirmed gaps not already tracked under Conclusion 3.

---

## Update — Run 2 (2026-06-23): finish run completed

The batched workflow was re-run to completion. **Run `wf_416ab010-2b9` · 75
agents / 7.4M tokens / ~112 min** (vs. 329 agents / 16.5M on run 1 — the Verify
batching worked). Bootstrap + Authority + Coverage + Synthesis all completed and
it produced a real synthesis report. Live-template cross-check **skipped** (no
inspect-template input). Full per-gap report is **not archived here** (76k chars);
it lives in the run's task output / `journal.jsonl`.

### Numbers (402 atoms → 342 candidates → 324 confirmed) are still inflated

The 324 headline is **not** 324 real gaps. The drop rate fell to ~5% (vs run 1's
30–47%) mainly because **8 adversarial Verify batches failed on transient API
500 / socket errors** and their candidates were kept *unverified* (conservative
default: no verdict → keep):

| Module | Atoms | Cand. | Confirmed | Dropped | Verify status |
|---|---|---|---|---|---|
| biochar | 95 | 72 | 65 | 7 | ✅ all batches ran — trustworthy |
| transportation | 44 | 41 | 35 | 6 | ✅ all batches ran — trustworthy |
| biochar-storage-soil | 78 | 61 | 59 | 2 | ⚠️ batch 9/11 failed (~6 unverified) |
| energy-use-accounting | 38 | 32 | 32 | 0 | ⚠️ batch 2/6 failed (~6 unverified) |
| embodied-emissions | 23 | 22 | 22 | 0 | ⚠️ batch 3/4 failed (~6 unverified) |
| biomass-feedstock-accounting | 55 | 54 | 54 | 0 | ⚠️ ran but refuted 0 — over-flagged, manual review |
| ghg-accounting | 69 | 60 | 57 | 3 | ❌ 5 of 10 batches failed (~30 unverified) — same failure mode as run 1 |

**Trustworthy after verification:** biochar (65) + transportation (35).
**Treat as unverified / manual-review:** ghg-accounting and every 0-dropped module.
To clear the residue, re-run just the suspect modules:
`Workflow({ scriptPath: ".claude/workflows/isometric-gap-check.js", args: { modules: ["ghg-accounting","biomass-feedstock-accounting","energy-use-accounting","embodied-emissions","biochar-storage-soil-environments"] } })`.

### Version drift — re-confirmed (unchanged from Conclusion 1)

biochar 1.2→1.3, storage-soil 1.2→1.3, energy 1.2→1.3, ghg 1.0→1.1; feedstock /
transportation / embodied at latest. Already tracked in `open-questions.md`.

### One genuinely-new actionable finding (verified against code)

**`docs/isometric/schema-mapping.md` overstates coverage via tables that no longer
exist.** Migration `drizzle/0037_*.sql` dropped `ghg_materiality_assessments`,
`emission_factors`, `feedstock_sc_assessments`, `reversal_risk_assessments`,
`loss_records`, `custody_handoffs`, but the mapping table still credits coverage to
their ORM names: `ghgMaterialityAssessments.*` (line 34, marked "partial") and
`emissionFactors.*` (line 29 "full", line 40 "partial"). Real status is **missing**.
*Action:* scrub those rows in `schema-mapping.md` to "missing" so the doc stops
manufacturing false "built/partial" coverage. (The underlying capability gaps —
`<1%` materiality gate, loss accounting, reversal-risk log — are already tracked
in `open-questions.md` per Conclusion 3; only the doc-accuracy bug is new.)

Everything else in the run re-confirms gap classes already documented as deferred
work (run 1, Conclusion 3) — no new `open-questions.md` entries warranted.
