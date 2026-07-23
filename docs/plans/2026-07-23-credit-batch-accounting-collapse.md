# Credit-batch accounting collapse — 2026-07-23

Source: architecture review (2026-07-22), candidate 01, deferred as "out of scope" by
`docs/plans/2026-07-22-architecture-remediation.md` (its Phases 1–3 landed as #506, #507,
#510 — do NOT redo candidates 02/05 or the targeted 3a/3b/3c fixes; they are done).
This plan is the deferred remainder: collapse the credit-batch accounting read behind one
deep module, plus a short revisit-check of the other deferred items.

## Preconditions (do not start until all hold)

- `fix/credit-batch-auto-association` is merged to staging and no other credit-batch WIP
  exists (`git status` clean on a fresh staging checkout).
- Re-verify the seam map below against the code first — the area churns fast and this doc
  is a snapshot of 2026-07-23 (`credit-batches.ts` at 991 lines, `certify-context-core.ts`
  at 941, both just under the 1000-line cap).

## Verified seam map (why this is leaked assembly)

Callers pre-load lineage facts and pass them back into the implementation to avoid
duplicate walks, so the interface exposes how the read is assembled:

- `src/data-access/credit-batches.ts:315–348` — `getCreditBatchById` takes
  `options.lineageFacts` / `skipPreview` and falls back to its own
  `loadCreditBatchLineageFacts` call when not supplied.
- `src/fn/certification/certify-context-core.ts:326,332,378,855` — preloads facts, threads
  `lineageFactsByBatch` into per-batch context builds.
- `src/fn/certification/selectable-batches.ts:57–103` — loads facts once per wizard render
  (PR #510 Phase 3b) and threads them into `getCo2eStoredPreviews` + per-batch scope.
- `src/data-access/credit-batch-previews.ts:122` — optional `lineageFacts` param.
- `src/data-access/chain-of-custody-batch.ts:90` — loads facts directly for traceability.
- Roll-up/applied-weight helpers spread across `credit-batch-lineage-facts.ts` (329 lines),
  `credit-batch-production-runs.ts` (198), `credit-batch-previews.ts` (306).

Alignment: ADR 0019 (aggregates stay derived on read — the derivation gains locality, no
persisted roll-ups) and ADR 0014 (credit batch as production cohort — re-read after the
auto-association branch, it is being amended there).

## Ground rules

Same per-phase PR loop as `2026-07-22-architecture-remediation.md`: branch
`refactor/<slug>` off fresh staging · implement via codex-implementation, Claude verifies
diff · gates (`pnpm lint` · `pnpm typecheck` · Vitest root + colocated · affected E2E) ·
PR base staging · two independent review comments (codex-review + opus-4.8) · remediate
with per-finding verification · merge, next phase off updated staging. Read
`docs/architecture.md` + `docs/code-style.md` + `docs/database.md` first.

## Phase 1 — Deep module: credit-batch accounting read

**Branch** `refactor/credit-batch-accounting-read` · **Goal**: one set-based module owns
lineage walk, applied weight, chemistry, and CO₂e preview assembly; callers request the
read, nothing threads facts outward.

1. New `src/data-access/credit-batch-accounting.ts`: batch-set interface, roughly
   `loadCreditBatchAccounting(ctx, batchIds) → Record<batchId, { lineageFacts,
   appliedWeight, chemistry, co2ePreview }>` — one walk per call, org-scoped via
   `requireOrgScope`. Absorb `credit-batch-lineage-facts.ts`,
   `credit-batch-previews.ts`, and the roll-up parts of
   `credit-batch-production-runs.ts` as internals (fold or re-export; delete the public
   threading types).
2. This IS the file split the 1000-line cap has been waiting for: `credit-batches.ts`
   keeps CRUD/list; its preview/facts assembly moves into the new module.
3. Migrate callers so no `lineageFacts`/`lineageFactsByBatch` option survives on any
   public signature: `getCreditBatchById`, `getCo2eStoredPreviews`,
   `certify-context-core.ts`, `selectable-batches.ts`, `chain-of-custody-batch.ts`.
4. **Do not regress #510 Phase 3b**: the contract test pinning exactly one
   lineage-facts load per wizard render must survive, re-pointed at the new module
   (one accounting walk per render). The batch-set interface is what preserves this —
   per-batch lookups inside a loop would reintroduce the fan-out.
5. Tests: existing lineage/preview suites re-point at the one interface; add a contract
   test that detail, wizard, certification context, and traceability all produce their
   numbers through `loadCreditBatchAccounting` (grep-style guard or spy) so facts cannot
   leak outward again.

Acceptance: behavior-identical numbers on all four read surfaces; no public signature
accepts pre-loaded facts; every touched file under 1000 lines; deletion test holds (the
chain walk exists exactly once).

Risk: this feeds certification math (applied weight, CO₂e stored). Mitigation: migrate
one caller per commit with the existing suites green between commits; compare wizard
preview + detail numbers on seeded data before/after (codex-computer-use smoke).

## Phase 2 — Revisit check for the other deferred items (timeboxed, likely no-op)

Half-day max, verdicts written to `docs/open-questions.md`, code changes only if trivial:

- Candidate 03 as written (unified bin-stock mutation seam): #510 Phase 3a contained the
  escape flags; confirm no new direct `bin-stock-guards` calls with caller-set flags have
  appeared outside `*-stock-locks.ts`. Expected verdict: seam exists, no action.
- Candidate 04 residue (production-run lifecycle interface): #510 Phase 3c unified the
  outcome rules; check whether the form still coordinates allowed-transitions +
  end-time-inclusion via separate lifecycle calls and whether that is actually costing
  anything. Expected verdict: acceptable — lifecycle stays pure per layer rules; do NOT
  give it persistence.

## Out of scope

- Any change to how aggregates are persisted (ADR 0019 stands: derived on read).
- Evidence-method module, create-with-evidence hook, stock-lock wrappers — done
  (#506/#507/#510); only regression-guard, never rework.
