# Isometric sandbox blockers: fixes and retest, 7 September 2026

**Outcome: partial live success; the Removal end-to-end flow remains blocked.** January now passes the Production Batch naming conflict and includes all four reviewed Application PDFs in its new submission snapshot. It stops safely because Isometric does not expose Biochar Application Source IDs in its create/read responses. Statement report generation, approval, resubmission, registry reconciliation, and completion dismissal succeeded through the normal app UI. External verifier access to the local report is not established.

## Environment and preservation

- Branch: `codex/fix-isometric-sandbox-blockers`.
- Aligned the worktree with the original QA baseline `b1068dd3` through merge `4f185842`. The merge reconciled duplicate Biochar Application association work already present on both histories.
- App: `http://localhost:3101`. Original checkout and app on port 3100 were left intact.
- QA database: `noma_dmrv_retest_20260907`, restored from the original local development database. Tests use a separate database, `noma_dmrv_tests_20260907`. No shared staging reset.
- Original uncommitted `pdf.ts` and `pdf.test.ts` changes were copied intact and byte-compared with the original checkout after testing. They are preserved work, not newly authored report styling in this fix.
- The two original Removals and protected registry records were retained. No sandbox deletions were performed. The original eight Statement Entries remain; this retest added one Entry, giving nine.
- All fixture uploads are synthetic sandbox QA documents. Credentials and controlled-link tokens are excluded from evidence files.
- Earlier QA reference: original checkout `docs/qa/2026-09-07-local-january-february-complex-production.md`.

## Changes and observed behavior

| Problem | Implemented behavior | Live result |
| --- | --- | --- |
| Local batch codes collide with older sandbox records | Namespace display names with the deterministic supplier reference, respecting the registry length limit. Reuse existing resources only through the existing reference and physical-payload checks. Recognize the earlier display-name hash for already registered batches. | Accepted `CB-26-001 (nm-ptb-e9063b545fc3)` as `ptb_1M1XSPPEESBX0Y5N`. No record adopted by display name. |
| Files added after a failed attempt silently appear ready | Mark files excluded from the saved evidence tuple. Offer an explicit evidence review for an interrupted draft without a registry Entry. Reconcile remotely under the existing locks before selecting a new version. | UI showed four excluded PDFs; Review new evidence selected them; Submit review showed four file uploads. |
| Safe recovery must preserve history and reservations | Keep the original snapshot/hash immutable. Create a new version with the reviewed additions. Permit production-claim reservation transfer only from that reviewed predecessor for the same Removal. | Original January v1 snapshot/hash match the original database exactly. V2 owns the retry and contains the four PDF Source IDs plus two ledger Sources. |
| Application editing and upload persistence are unclear | Read-only fields when certification lineage is locked. Supporting uploads remain independently available, with immediate-persistence and late-evidence copy. | AP-26-001 had no field Edit control. A synthetic upload persisted after Close and reopen. Removal detail explicitly excludes it from the registry-backed v2 attempt and explains that an amendment is required. |
| Biochar Application creation can be mistaken for evidence attachment | Require every requested Source ID to be observable in the remote response, on both creation and reconciliation. Missing or partial readback stops submission. | Remote Application was created, but both response/readback omit `source_ids`; January remains interrupted. The app does not claim its PDFs are attached. |
| Pending changes lose precedence to awaiting verification | A non-null finite pending total, including zero, selects resubmit and the Pending changes badge before awaiting-verification handling. Live metadata overlay updates pending totals even if status is unchanged. | Statement initially showed Pending changes with eight Entries; after January, nine. Updated report resubmission cleared pending total and showed In verification. |
| Registry membership differs from local history | Distinguish registry Entry count from locally linked Removals. Allow report generation from fully reconciled remote membership independently of local lineage rollup. Hide empty local carbon rollup copy. | Report included all nine registry Entries despite zero finalized locally linked Removals. No local provenance was invented. |

## January identity and evidence ledger

| Item | ID / result |
| --- | --- |
| Local facility | `2c6ee717-d238-4e2f-bf09-269de6e0c6ef` |
| Sandbox project | `prj_1K9YJ33RKSBX9FFF` |
| Local January Removal | `34757148-d092-4e66-bc22-4497db2fac81` |
| Preserved v1 submission | `ea6c964e-0d37-417d-b7c6-c33c806ec88d` |
| New v2 submission | `3940d160-5a48-455e-b4b2-fdf97ff68970`, draft/interrupted |
| New GHG Entry | `rmv_1M1XSPT85SBXNSTN` |
| New Production Batch | `ptb_1M1XSPPEESBX0Y5N` |
| First Biochar Application | `bse_1M1XSPX9RSBXVA1N` |
| AP-26-001 PDF Source | `src_1M1XSJKEKSBX480W` |
| AP-26-002 PDF Source | `src_1M1XSJYDBSBXQWWH` |
| AP-26-003 PDF Source | `src_1M1XSK9B4SBXBHR6` |
| AP-26-004 PDF Source | `src_1M1XSJ7Z8SBXGK57` |
| Transport ledger Source | `src_1M1X5APZ0SBXV3DV` |
| Durability ledger Source | `src_1M1X5B256SBXER9G` |
| Later upload-persistence fixture | Document `f514e7bf-54f3-4e81-963a-bed08a85cd07`, excluded from v2, not mirrored |

The first v2 run exposed a production reservation still owned by v1. The same-Removal reviewed-predecessor transfer fixed that gate. The next normal UI retry completed all six inputs and three durability inputs, registered the namespaced batch and Entry, then stopped on Biochar Application evidence readback. Its failure dialog closed normally.

The remote Application readback also has `ghg_entry_id: null`. Only the first of four intended Applications reached creation before the evidence check stopped the loop. Neither association nor evidence attachment is declared complete. Further unchanged retries were avoided once this external blocker was confirmed.

## Statement report and resubmission

- Local Statement: `637865b5-2a77-4078-9fe3-f5ec67b6e62e`.
- Registry Statement: `ggs_1M14F95JZSBXJEZJ`, reporting period 1 July to 31 August 2026.
- Report v1: `29415193-ae02-4dad-a71f-b3cf2e129d38`; document `69314f11-8d80-45de-a2c7-20bd6133ff16`.
- Generated from the live registry through the app dialog, opened for review, rendered locally, and approved through the app.
- All nine IDs reconciled. Exact net total: **4505.836798053771 kg CO₂e**, displayed in the PDF as **4505.837 kg**. Registry rounded total: **4510 kg / 4.51 t**. Projected allocation: **4417 kg supplier, 93 kg buffer**.
- PDF render inspected: no overlap or clipping. It is the existing **data-summary/reconciliation report**, not proof of complete methodology reporting or completed Application evidence.
- Resubmission summary explicitly identified this as sandbox QA, described the nine Entries, disclosed the missing local history, and stated that the local URL is not externally reachable.
- Normal UI Resubmit completed all progress steps, showed GHG Statement submitted, and Done dismissed the modal.
- Independent API read: `AWAITING_VERIFICATION`, `pending_total_co2e_removed_kg: null`, nine Entries. Registry UI separately confirmed the same status and 4.51 tCO₂e.
- Registry report link points to the new controlled app route. Unauthenticated capability read from this machine returned HTTP 200, `application/pdf`, 21,527 bytes, and the exact reviewed PDF checksum: `709f921d05e2dfe5ba5dfca968ca96469a8f9a46f35a5a922a310f6e8c904842`.
- **Delivery limitation:** the origin is `http://localhost:3101`. This verifies controlled-link correctness locally, not external verifier access. No tunnel, public deployment, or substituted staging URL was created.

## External blocker and unfinished scenarios

The current [official Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json) accepts `source_ids` in `CreateBiocharApplicationRequest`, but its `BiocharApplication` response schema omits them. Live sandbox creation and GET showed the same omission. No documented reverse Source relationship in the inspected contract resolved this. The requested Isometric `how_to` MCP tool was unavailable, so official docs and live readbacks were used.

The registry January Entry Sources tab lists the transport ledger, durability ledger, GLEC reference, and ICE reference. It does not list the four Application PDFs. That tab is not a substitute for verifying the Application's own Source relationship.

Required next evidence: Isometric must expose a supported, authoritative readback of Biochar Application Source links, and the Entry association must reconcile. Then resume January v2 through the app, complete all four Applications, and verify exact link membership. Do not remove the strict check just to make the dialog succeed.

**Not completed:** successful finalization of January or February, the fresh upload-before-first-Removal-submission scenario through the live UI, or externally accessible verifier delivery. February was left unchanged after the January attempt established the shared external blocker. No full end-to-end certification success is claimed.

## Verification

- Targeted regression tests first reproduced naming, missing evidence, and pending-state defects, then passed after fixes.
- `pnpm typecheck`: passed.
- `pnpm lint`: zero errors, 14 warnings; existing warnings retained.
- `pnpm check:org-scoping`: passed.
- `pnpm check:spacing-scale`: passed.
- Full parallel Vitest run: 465 executed files, 3,501 passed tests and one failing pre-existing deletion-queue backlog test (`parent-document-retirement`). The same test passed alone.
- `pnpm exec vitest run --no-file-parallelism`: **465 passed files, 3,502 passed tests**, one skipped file, nine skipped tests, four TODOs. The parallel-only failure is consistent with shared deletion-queue interference; no unrelated deletion implementation was changed.
- After adding recovery authorization/history guard coverage and simplifying the candidate annotation: four targeted files, **31 tests passed**; typecheck, lint, org-scoping, spacing, and diff whitespace checks passed again.
- Browser verification used direct computer-use controls in the logged-in app and registry. No SQL or API mutation substituted for the submission, report approval, resubmission, or upload UI. Supporting API/DB work was read-only verification after those actions.
- The automated Playwright suite was not run. The changed live flows above were exercised with computer use. This is a limitation of the test record, not a claim that all browser scenarios passed.

## Evidence

The curated observations above are the committed evidence record. Raw browser trees,
registry/database dumps, local test logs, screenshots, and generated report copies
remain local; they are not retained in the repository.

## PR review follow-up

The observations above describe the original retest, not the revised branch's acceptance.
Review found that rebuilding version-specific registry inputs after a possible or
confirmed external mutation could duplicate those inputs. The branch now refuses
that evidence refresh and preserves exact retries. Current failure handling rejects
mutation-free attempts and marks only possible/confirmed mutations interrupted, so
there is presently no operator-reachable safe evidence-refresh path. Reconciliation
of prior registry inputs is required before this recovery feature can be accepted.
Synthetic guard tests cover the refusal and document-lock boundaries only; they do
not establish a successful operator recovery flow.

The public provider contract still omits Application Source readback. The PR remains
blocked on that capability, safe interrupted-input reconciliation, the uncompleted
first-submission/January/February acceptance scenarios, and external report delivery.
The new recovery interaction also still needs an automated end-to-end scenario.
