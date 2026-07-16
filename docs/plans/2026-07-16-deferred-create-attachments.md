# Deferred create attachments + evidence view/edit consistency

**Date:** 2026-07-16 · **Status:** approved, not started
**Origin:** QA session on staging — "Save the X first, then reopen it to attach…" placeholders in create forms, plus editable upload dropzones rendered in *view* mode of the feedstock/delivery side sheets.

## Problem

1. **Create forms can't accept attachments.** The upload pipeline creates the `documents` row at presign time keyed to `(entityType, entityId)` (`src/hooks/use-file-upload.ts:190`, `src/fn/documents.ts` → `assertCanManageDocumentEntity`). During create there is no entity ID, so four create surfaces show "save first, then reopen it" placeholder copy. "Reopen" is actually four steps (sheet closes → find row → click → view mode → Edit → scroll).
2. **View mode mutates.** Feedstock and delivery side sheets mount the fully-editable `TransportEvidencePanel` (dropzones + delete buttons) in `viewModeChildren` only — view mode is mutable while the edit form has no evidence section at all. Samples do the exact opposite (edit-only). Two contradictory conventions.
3. **View mode hides evidence.** Sample view shows no lab-report documents at all; production-run view shows no readings CSVs (the component already supports `readOnly` but isn't mounted there).

## Decisions (settled with Kenji, do not relitigate)

- **Save = validate → persist → close, identical everywhere.** No auto-flip-to-edit, no staged/presigned-before-create uploads, no draft entities. All three were considered and rejected.
- **Create mode defers attachments client-side.** Dropzones in create forms hold real `File` objects (plus per-file metadata) in local state; nothing touches the server until Save. On Save: create entity → flush uploads/legs against the fresh ID via the **existing, unchanged** presign flow → close on full success. Zero new server machinery, no orphan cleanup, no auth changes.
- **Partial failure never closes silently.** If the entity create succeeds but a flush item fails, the sheet stays open (now in edit mode on the new entity) showing the failed items with retry and remove actions, plus an error. The user fixes it or deliberately removes the file and uploads later.
- **Transport legs get the same deferred treatment** (sample create form only — feedstock/biochar legs are auto-derived and read-only everywhere). Legs are rows, not files: deferred mode keeps them in a local array and POSTs each after create.
- **Edit mode stays instant.** Dropping a file / adding a leg in edit mode persists immediately, as today. The create-mode deferral exists only because the parent doesn't exist yet, not as a philosophy. Do not build staged deletes / dirty diffing for edit mode.
- **View mode is read-only everywhere but shows everything**: legs table + document list with open-in-new-tab links; no dropzones, no delete buttons.
- **All surfaces in one pass** (PR 2): sample, production run (readings CSV), application evidence (visual + logbook), feedstock, delivery, production-run quick-add sample.
- Closing a create sheet with held-but-unsaved files warns before discarding.

## PR 1 — `fix: evidence lives in edit mode, view mode is read-only`

Branch off `staging`. Small, ships first, independent of PR 2.

1. **`TransportEvidenceDocuments`** (`src/components/transport-legs/transport-evidence-documents.tsx`): add `readOnly` prop — render the uploaded-file list (name, type, size, open link) but hide the two dropzones and the delete buttons. Mirror how `TransportLegsSummary` wraps `TransportLegsEditor` with `readOnly`. Thread through `TransportEvidencePanel`.
2. **`SampleDocumentsPanel`** (`src/components/samples/sample-documents-panel.tsx`): same `readOnly` treatment.
3. **Feedstock** (`src/components/feedstocks/feedstock-list.tsx:501-514`, `feedstock-form.tsx`): move `TransportEvidencePanel` out of `viewModeChildren` into the **edit** form; view mode keeps `TransportLegsSummary` + gains `TransportEvidencePanel readOnly`. Follow the sample trailing-section pattern (`src/components/samples/sample-trailing-sections.tsx`): panels render **outside the `<form>` element** (they nest interactive controls; nested forms are invalid HTML) while joining the `FormSpine` rail via `SPINE_SECTION_TAG` + forwarded `__spine` meta. In create mode, PR 1 may keep a placeholder line — PR 2 replaces it.
4. **Delivery** (`src/components/deliveries/delivery-list.tsx:442-450`, `delivery-form.tsx`): identical move.
5. **Sample view** (`src/components/samples/sample-list.tsx:514-521`): add `SampleDocumentsPanel readOnly` next to the existing `TransportLegsSummary`.
6. **Production-run view** (`src/components/production-runs/production-run-list.tsx:500-515`): add `ProductionReadingsDocuments readOnly` (prop already exists) alongside the readings/samples/incidents tables.

## PR 2 — `feat: attach documents and transport legs during create`

Branch off `staging` after PR 1 merges (it touches the same panels).

### Shared mechanism

- **`FormFileUpload`** (`src/components/forms/form-file-upload.tsx`, 339 lines) already has a dual-mode design (legacy "mockup mode" captures metadata-only `FileEntry[]`; "real mode" uploads via `useFileUpload`). Add a third **deferred mode**: controlled by the parent, holds real `File` objects, emits add/remove; renders the same file rows as real mode but with a neutral "attached" state (no fake "uploaded" claim). Client-side size/type validation at drop time, same limits as real mode.
- **Deferred-attachments hook** (new file, e.g. `src/hooks/use-deferred-attachments.ts`): owns `{ key, file, documentType, extraMeta }[]` per create form, exposes `add / remove / flush(entityId)`. `flush` runs the existing `useFileUpload().upload` per file (including `applicationEvidenceRole` / `applicationLogbookEvidenceType` metadata for application evidence), returns per-item success/failure so the caller can render retries.
- **`TransportLegsEditor`** (`src/components/transport-legs/transport-legs-editor.tsx`): deferred mode — legs live in a local `TransportLegFormData[]` with the same inline add/edit/delete UI and table; parent flushes via the existing create mutation per leg after entity create.
- **Post-create orchestration** (shared helper or per-list): create → flush all deferred items → all succeeded: toast + close (today's behavior) → any failed: keep sheet open, switch to edit mode on the new entity, surface the failed items with retry/remove. Do **not** roll back the entity.
- **Close guard:** `EntitySideSheet` (`src/components/ui/entity-side-sheet/index.tsx`) has no dirty-check today. Add an optional "confirm discard" hook the create forms set when deferred items exist.

### Surfaces

| Surface | File(s) | What changes |
| --- | --- | --- |
| Sample form | `sample-trailing-sections.tsx`, `sample-form.tsx` (932 lines — extract, don't grow) | Evidence & Transport sections live in create mode: deferred docs panel + deferred legs editor replace both placeholders |
| Production run | `production-run-form.tsx:868-890`, `production-readings-documents.tsx` | Readings CSV dropzone works in create; server-side CSV parsing still triggers on the post-create upload, unchanged |
| Application | `application-form.tsx:652` (718 lines — extract), `application-evidence-panel.tsx:329` | Evidence panel works without `applicationId`: deferred files carry visual role / logbook type metadata through flush |
| Feedstock | `feedstock-form.tsx` | Create-mode evidence placeholder from PR 1 → live deferred panel |
| Delivery | `delivery-form.tsx` | Same |
| Run quick-add sample | `production-sample-form.tsx` | Same deferred docs treatment as the main sample form |

## Constraints & gotchas for implementers

- Read first: `docs/forms.md` (numeric helpers, Zod 4), `docs/design-system.md` (Canonical Page Shell, tokens, EmptyState), `docs/code-style.md` (React Compiler — no manual memo, avoid `useEffect`), `docs/storage.md` (upload flow).
- `pnpm` only; no file may exceed 1000 lines (`sample-form.tsx` at 932 and `application-form.tsx` at 718 are near the cap — extract new logic into sibling files).
- Buttons rendered inside a parent `<form>` must be `type="button"`; prefer the trailing-section outside-the-form pattern (see `sample-trailing-sections.tsx` header comment).
- `"use server"` files must not `export type` (runtime ReferenceError).
- Server contract is untouched: presign still requires an existing entity; `assertCanManageDocumentEntity` unchanged.
- E2E: `docs/testing.md`; fixtures in `tests/e2e/fixtures/auth-fixtures.ts`; `playwright.config` loads untracked `.env.test` — copy `.env.test` + `.env.local` into any worktree.

## Verification

- `pnpm lint` + `pnpm typecheck` per PR.
- E2E: extend or add specs covering (a) create-with-attachment happy path for sample + feedstock, (b) view mode shows documents read-only (no delete button), (c) partial-failure path if feasible (mock upload failure), (d) existing edit-mode upload specs stay green.
- UI verification via codex-computer-use or Playwright against the dev server (create sample with a PDF + a leg in one Save; confirm sheet closes and reopening shows both).

## Execution notes

- Implementation via codex (gpt-5.6-sol) per the model rubric; Claude orchestrates, reviews, polishes taste. Parallel codex implementation agents need `isolation: 'worktree'`.
- PR base `staging`; PR titles: PR 1 `fix: move evidence editing into edit mode, make view mode read-only`, PR 2 `feat: attach documents and transport legs during create`.
