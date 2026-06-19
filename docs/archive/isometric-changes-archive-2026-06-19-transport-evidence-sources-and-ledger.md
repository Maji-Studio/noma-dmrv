# 2026-06-19 Isometric transport evidence Sources and ledger

Archived from `docs/isometric/changes.md` to keep the live Isometric docs
focused on evergreen guidance.

## Transport evidence ledger — auto-generated + mirrored as a Source at submit

Builds on the transport-leg -> Sources work below. Per-leg bills of lading reach
the registry one file at a time; this adds a single **calc-summary ledger PDF**
that reconciles every leg's `mass_distance` contribution to the submitted
scalars, generated from the removal's live legs and mirrored as a Source on every
Submit/Resubmit (no manual upload).

- **Renderer** — new `src/lib/certification/evidence-ledger/` (`types.ts` /
  `build-model.ts` / `fonts.ts` / `pdf.ts`). `buildLedgerModel` is pure: per-leg
  `t·km = round2(distanceKm × loadMassKg ÷ 1000)`, subtotals = Σ rounded legs, so
  the displayed "Σ legs = subtotal = total" reconciliation is exact by
  construction. `pdf.ts` renders with **`@react-pdf/renderer`** (chosen over
  HTML+Chromium to avoid a ~50 MB headless binary on Fluid/Vercel), using
  `createElement` (no JSX) so it renders identically under Next and a plain
  Node/tsx verifier. **Glyph gotcha:** the bundled DM Sans/Mono latin subset has
  no `→ ✓ Σ` — the renderer uses `›` for route arrows, a green `•` status dot,
  and `scalar = SUM ( distance × mass )`; any new text must stay in the subset.
- **Server-side storage put** — `StorageProvider.putObject(key, body,
  contentType)` added (S3 `PutObjectCommand`; local-fs atomic temp+rename +
  `.meta.json` sidecar). Objects the server generates itself no longer need a
  presigned round-trip.
- **Core flow** — `src/fn/certification/evidence-ledger.ts` (non-`"use server"`
  core): load context → `buildLedgerModel` → render → `sha256` → `putObject` →
  `insertDocument` on a member **credit_batch** (so the existing candidate-doc
  lineage walk finds it with zero new `source_ids` plumbing) → mirror. The mirror
  body was extracted into `mirrorDocumentToSourceForUser(userId, input)` in
  `sources.ts` (thin `withAction` wrapper retained) so the submit pipeline can
  mirror with an explicit userId instead of re-deriving the session.
- **Idempotency / supersede (decided with the user)** — the ledger is
  content-hashed over its legs/totals **excluding the render timestamp**, so an
  unchanged-legs resubmit reuses the same Source (no-op). When legs change, a new
  document + Source is created and **every prior ledger for the removal is retired
  locally** (delete the `certifier_document_uploads` mapping first — FK is
  RESTRICT — then the `documents` row, then best-effort the storage object). The
  prior registry Source is deliberately left on Isometric: it stays immutable
  evidence for any already-submitted snapshot that referenced it — which is why
  retirement is a direct local delete, not `unlinkDocumentSource` (whose
  snapshot-reference guard would refuse). Alternatives (filter-latest-in-resolve;
  one canonical Source with re-uploaded bytes) were rejected — the latter mutates
  bytes a past certified snapshot referenced.
- **Submit hook** — `submitRemoval` calls
  `ensureTransportEvidenceLedgerSourceFromContext(userId, removalId, ctx)` just
  before candidate documents are collected (reusing the already-loaded context to
  avoid a second Isometric-touching load), before the claim transaction. The
  list/create/retire sequence is serialized with the same per-removal
  certification-artifact advisory lock used by submission claiming. Best-effort:
  a render/mirror hiccup logs a warning and submits without the ledger; the next
  submit regenerates it.
- **Font tracing** — `outputFileTracingIncludes` added to `next.config.ts`; the
  TTFs are read via a dynamic `process.cwd()` path the tracer can't follow.
  Unverifiable locally -> flagged for first-deploy verification
  (`isometric/evidence-ledger-font-tracing` in `docs/open-questions.md`).
- **Tests** — `tests/transport-evidence-ledger-model.test.ts` (pure
  reconciliation / basis / ref numbering) and
  `tests/transport-evidence-ledger-source.test.ts` (create / reuse / supersede /
  legs-removed / no-mapping with faked boundaries).
- **End-to-end verification (2026-06-19, seeded sandbox, removal CB-26-001 /
  `prj_1K9YJ33RKSBX9FFF`)** — exercised the real path **in-process** (real PDF
  render → local-fs `putObject` → `insertDocument` → real Isometric `POST
  /sources` + content upload), driven through a temporary dev-server-internal
  route (since the live submit's many pre-hook gates were not the thing under
  test). **9/9 checks passed:** create writes a private `pdf` doc on the member
  credit_batch + a real Source (`src_...`) and that Source rides into the
  resolved `source_ids`; an unchanged-legs rerun **reuses** the same doc/Source
  (no new registry object); mutating a leg's distance **supersedes** — new doc +
  Source, prior doc + mapping deleted locally, new Source in `source_ids` and the
  old one out. The three structured signals (`generated` / `reused` / `retired
  prior transport evidence ledgers`, op `removal:evidence-ledger`) fired as
  designed. The stored PDF validated: `%PDF-1.3`, byte length + `sha256` match
  the `documents` row, and extracted text shows the per-category mass·distance
  scalars reconciling (feedstock 492.30, biochar 476.20, sample 1.23, total
  969.73 t·km for the mutated-leg case — `(51×4500 + 29×3200 + 34×5000)/1000 =
  492.30`, exact). **Caveat:** a *cross-process* CLI verifier cannot complete the
  mirror's storage read-back when `STORAGE_SIGNING_SECRET` is unset — each
  process mints its own ephemeral local-fs presign secret, so the dev server
  rejects the CLI-signed download URL; this is a test-harness artifact, not a code
  path the real submit (single process) hits. The actual `submitRemoval` UI
  submit was **not** driven (browser automation was unavailable this session);
  the hook wiring is covered by code review + the core function proven against
  the live submission context above. Verification artifacts (the temp route, the
  generated doc/PDF) were removed; the per-run sandbox Sources remain on the
  registry as orphan clutter to delete.

## Transport-leg evidence -> Sources + restore the Sources mirror UI

Two-part fix so per-transport-leg evidence (bills of lading / weigh-scale
tickets) can actually reach the registry. Transport legs are aggregated into one
`mass_distance` scalar per category (no LIST transport blueprint — see
[[transport-legs-distance-based]]), so a leg's data can't ride to the verifier as
data; its uploaded evidence must arrive as a **Source** on the datapoint.

- **Candidate-document walk now includes transport legs** —
  `fn/certification/sources.ts` adds `transport_leg` to the `LineageEntityType`
  union and a shared `collectTransportLegEntities` helper wired into **both** the
  panel walk (`collectLineageEntities`) and the submit walk
  (`collectCandidateDocumentIdsForRemoval`). Legs hang off chain entities
  polymorphically; the helper resolves them via `getTransportLegsForEntities` off
  the feedstock / biochar-product / sample entities already in the set. **Gotcha
  pinned by tests:** `transport_legs.entityType` is its own enum
  (`feedstock | biochar | sample`) — `"biochar"` != the document/lineage
  `"biochar_product"`. New pure-logic tests in
  `tests/isometric-transport-leg-sources.test.ts`.
- **Restored the Sources mirror UI** — the 2026-06-04 certify redesign deleted
  `components/certification/removal-review/evidence-step.tsx`, orphaning
  `SourcesPanel`: nothing rendered it, so the candidate set was never consumed and
  `source_ids` was always empty (submit is **resolve-only** — it never
  auto-mirrors). `SourcesPanel` is re-homed into `removal-detail-sheet.tsx` (the
  Removals-tab quick view, which always has a valid `removalId`), replacing a
  misleading "Evidence & sources ->" link that dead-ended in the wizard. This
  resolves the `certification/removal-detail-deep-link` open question.
- **Telemetry deferred** — `TelemetryPanel` (reactor temp/pressure ->
  `DataUploadSubmission`, ADR 0006) was deleted in the same commit and stays
  orphaned; a distinct concern, tracked as
  `certification/telemetry-panel-orphaned` in `docs/open-questions.md`.
