# Form detail E gallery · 22 September 2026

Current approved E presentation, captured from the isolated localhost:3102 app using synthetic local fixtures and normal authentication. This replaces the superseded 21 September gallery. These are actual viewport screenshots, not mockups, composites, or stitched pages.

Simple contains inputs and corresponding saved fields only. Computed mass readouts, wet/dry summaries, stock estimates, provenance, and entry actions to these are absent. Actual blockers, required evidence, and approved selector adjustments remain. Detailed uses quiet tinted inline cards; component/mass/share rows use 8px bars. Details initially stays collapsed and owns calculations, provenance, and before/after context.

## Verification result

All five capture scenarios passed across the final runs: four unaffected scenarios plus a refreshed Delivery/Application scenario after removing the native selector's optional mass captions. All 116 screenshots are current. The absence checks use hard assertions.

All nine regular browser regressions passed, including real saves, FIFO shortages, read/edit presentation state, and stock corrections. The Application read assertion is scoped to the dialog so it does not match the background table header. Focused component tests (89 tests, plus 11 follow-up tests), typecheck, spacing checks, and lint passed; full lint retains 14 pre-existing warnings.

Local visual inspection against the E reference confirms the tint, compact table, 8px bars, sentence-case Details control and expanded content on representative desktop/mobile views. Simple no longer shows the Production total-input summary, Credit Batch run wet/dry readouts, or Application availability captions. No completed external model review applies to this revision: the external transfer was blocked and the started review was interrupted.

Logs: [gallery refresh](gallery-results.txt), [regression suite](regression-results.txt).

## Coverage and limits

- Delivery, Application, Feedstock and Production create/read/edit; Credit Batch read (including an applied-mass fixture); Sample transport read; stock count, loss, and correction.
- Each surface has Simple, Detailed collapsed, and representative expanded Details at 1440×1100 and 390×844. Extra images show expanded Process flow and the replacement stock card at both widths, mobile transport's right columns, the Simple shortage blocker, and saved correction history.
- Delivery/Application creation and stock count/loss/correction are submitted and persisted. Feedstock/Production create forms are populated previews; their read/edit views use seeded saved records. Read/edit captures do not claim that every edit was submitted.
- Checks cover Simple omissions (including Total wet input, Remaining wet mass, and combined Wet/Dry summaries), keyboard Enter/Space, preserved field values/save availability, clean Cancel versus dirty discard protection, and no page/dialog horizontal overflow at 390px.
- Preview quantities depend on date, stock, moisture and fixture history. Wet stock estimates do not replace recorded measurements. Dry-only batch ledgers do not invent water splits; Application keeps an honest combined ingredients/water remainder. Missing carbon data remains unavailable. Warnings and evidence gaps are intentionally retained.
- One representative disclosure opens per surface, plus the named supplemental cards. This is not an exhaustive screenshot of every scroll position or every disclosure. Sample's saved transport table scrolls horizontally within its container; both ends are captured. Tall correction modals can scroll the header out of view.

## Reproduce

The gallery is opt-in and skipped in ordinary CI. Use only the isolated local fixture environment and run serially; teardown sweeps shared E2E records. Server must already be available at localhost:3102.

```sh
source /private/tmp/noma-detail-rollout/local-test-env.sh
find docs/archive/qa/2026-09-22-form-detail-e -type f -name '*.png' -delete
rm -f docs/archive/qa/2026-09-22-form-detail-e/captures.jsonl
CAPTURE_FORM_DETAIL_GALLERY=1 pnpm exec playwright test tests/e2e/form-detail-gallery.spec.ts --workers=1 --reporter=line
```

The gallery spec is `tests/e2e/form-detail-gallery.spec.ts`. `captures.jsonl` records viewport and local route for each image. Do not run another browser suite concurrently.

116 PNGs across 18 surface/fixture groups.

## Application Create

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![application-create 1440 Simple](application-create-1440-simple.png) | ![application-create 1440 Detailed](application-create-1440-detailed.png) | ![application-create 1440 Details expanded](application-create-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![application-create 390 Simple](application-create-390-simple.png) | ![application-create 390 Detailed](application-create-390-detailed.png) | ![application-create 390 Details expanded](application-create-390-details.png) |

## Application Edit

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![application-edit 1440 Simple](application-edit-1440-simple.png) | ![application-edit 1440 Detailed](application-edit-1440-detailed.png) | ![application-edit 1440 Details expanded](application-edit-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![application-edit 390 Simple](application-edit-390-simple.png) | ![application-edit 390 Detailed](application-edit-390-detailed.png) | ![application-edit 390 Details expanded](application-edit-390-details.png) |

## Application Read

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![application-read 1440 Simple](application-read-1440-simple.png) | ![application-read 1440 Detailed](application-read-1440-detailed.png) | ![application-read 1440 Details expanded](application-read-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![application-read 390 Simple](application-read-390-simple.png) | ![application-read 390 Detailed](application-read-390-detailed.png) | ![application-read 390 Details expanded](application-read-390-details.png) |

## Credit Batch Applied Read

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![credit-batch-applied-read 1440 Simple](credit-batch-applied-read-1440-simple.png) | ![credit-batch-applied-read 1440 Detailed](credit-batch-applied-read-1440-detailed.png) | ![credit-batch-applied-read 1440 Details expanded](credit-batch-applied-read-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![credit-batch-applied-read 390 Simple](credit-batch-applied-read-390-simple.png) | ![credit-batch-applied-read 390 Detailed](credit-batch-applied-read-390-detailed.png) | ![credit-batch-applied-read 390 Details expanded](credit-batch-applied-read-390-details.png) |

## Credit Batch Read

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![credit-batch-read 1440 Simple](credit-batch-read-1440-simple.png) | ![credit-batch-read 1440 Detailed](credit-batch-read-1440-detailed.png) | ![credit-batch-read 1440 Details expanded](credit-batch-read-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![credit-batch-read 390 Simple](credit-batch-read-390-simple.png) | ![credit-batch-read 390 Detailed](credit-batch-read-390-detailed.png) | ![credit-batch-read 390 Details expanded](credit-batch-read-390-details.png) |

## Delivery Create

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![delivery-create 1440 Simple](delivery-create-1440-simple.png) | ![delivery-create 1440 Detailed](delivery-create-1440-detailed.png) | ![delivery-create 1440 Details expanded](delivery-create-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![delivery-create 390 Simple](delivery-create-390-simple.png) | ![delivery-create 390 Detailed](delivery-create-390-detailed.png) | ![delivery-create 390 Details expanded](delivery-create-390-details.png) |

## Delivery Edit

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![delivery-edit 1440 Simple](delivery-edit-1440-simple.png) | ![delivery-edit 1440 Detailed](delivery-edit-1440-detailed.png) | ![delivery-edit 1440 Details expanded](delivery-edit-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![delivery-edit 390 Simple](delivery-edit-390-simple.png) | ![delivery-edit 390 Detailed](delivery-edit-390-detailed.png) | ![delivery-edit 390 Details expanded](delivery-edit-390-details.png) |

## Delivery Read

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![delivery-read 1440 Simple](delivery-read-1440-simple.png) | ![delivery-read 1440 Detailed](delivery-read-1440-detailed.png) | ![delivery-read 1440 Details expanded](delivery-read-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![delivery-read 390 Simple](delivery-read-390-simple.png) | ![delivery-read 390 Detailed](delivery-read-390-detailed.png) | ![delivery-read 390 Details expanded](delivery-read-390-details.png) |

## Feedstock Create

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![feedstock-create 1440 Simple](feedstock-create-1440-simple.png) | ![feedstock-create 1440 Detailed](feedstock-create-1440-detailed.png) | ![feedstock-create 1440 Details expanded](feedstock-create-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![feedstock-create 390 Simple](feedstock-create-390-simple.png) | ![feedstock-create 390 Detailed](feedstock-create-390-detailed.png) | ![feedstock-create 390 Details expanded](feedstock-create-390-details.png) |

## Feedstock Edit

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![feedstock-edit 1440 Simple](feedstock-edit-1440-simple.png) | ![feedstock-edit 1440 Detailed](feedstock-edit-1440-detailed.png) | ![feedstock-edit 1440 Details expanded](feedstock-edit-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![feedstock-edit 390 Simple](feedstock-edit-390-simple.png) | ![feedstock-edit 390 Detailed](feedstock-edit-390-detailed.png) | ![feedstock-edit 390 Details expanded](feedstock-edit-390-details.png) |

## Feedstock Read

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![feedstock-read 1440 Simple](feedstock-read-1440-simple.png) | ![feedstock-read 1440 Detailed](feedstock-read-1440-detailed.png) | ![feedstock-read 1440 Details expanded](feedstock-read-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![feedstock-read 390 Simple](feedstock-read-390-simple.png) | ![feedstock-read 390 Detailed](feedstock-read-390-detailed.png) | ![feedstock-read 390 Details expanded](feedstock-read-390-details.png) |

## Output Bin Loss

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![output-bin-loss 1440 Simple](output-bin-loss-1440-simple.png) | ![output-bin-loss 1440 Detailed](output-bin-loss-1440-detailed.png) | ![output-bin-loss 1440 Details expanded](output-bin-loss-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![output-bin-loss 390 Simple](output-bin-loss-390-simple.png) | ![output-bin-loss 390 Detailed](output-bin-loss-390-detailed.png) | ![output-bin-loss 390 Details expanded](output-bin-loss-390-details.png) |

## Output Bin Reconciliation

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![output-bin-reconciliation 1440 Simple](output-bin-reconciliation-1440-simple.png) | ![output-bin-reconciliation 1440 Detailed](output-bin-reconciliation-1440-detailed.png) | ![output-bin-reconciliation 1440 Details expanded](output-bin-reconciliation-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![output-bin-reconciliation 390 Simple](output-bin-reconciliation-390-simple.png) | ![output-bin-reconciliation 390 Detailed](output-bin-reconciliation-390-detailed.png) | ![output-bin-reconciliation 390 Details expanded](output-bin-reconciliation-390-details.png) |

## Output Stock Correction

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![output-stock-correction 1440 Simple](output-stock-correction-1440-simple.png) | ![output-stock-correction 1440 Detailed](output-stock-correction-1440-detailed.png) | ![output-stock-correction 1440 Details expanded](output-stock-correction-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![output-stock-correction 390 Simple](output-stock-correction-390-simple.png) | ![output-stock-correction 390 Detailed](output-stock-correction-390-detailed.png) | ![output-stock-correction 390 Details expanded](output-stock-correction-390-details.png) |

## Production Run Create

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![production-run-create 1440 Simple](production-run-create-1440-simple.png) | ![production-run-create 1440 Detailed](production-run-create-1440-detailed.png) | ![production-run-create 1440 Details expanded](production-run-create-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![production-run-create 390 Simple](production-run-create-390-simple.png) | ![production-run-create 390 Detailed](production-run-create-390-detailed.png) | ![production-run-create 390 Details expanded](production-run-create-390-details.png) |

## Production Run Edit

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![production-run-edit 1440 Simple](production-run-edit-1440-simple.png) | ![production-run-edit 1440 Detailed](production-run-edit-1440-detailed.png) | ![production-run-edit 1440 Details expanded](production-run-edit-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![production-run-edit 390 Simple](production-run-edit-390-simple.png) | ![production-run-edit 390 Detailed](production-run-edit-390-detailed.png) | ![production-run-edit 390 Details expanded](production-run-edit-390-details.png) |

## Production Run Read

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![production-run-read 1440 Simple](production-run-read-1440-simple.png) | ![production-run-read 1440 Detailed](production-run-read-1440-detailed.png) | ![production-run-read 1440 Details expanded](production-run-read-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![production-run-read 390 Simple](production-run-read-390-simple.png) | ![production-run-read 390 Detailed](production-run-read-390-detailed.png) | ![production-run-read 390 Details expanded](production-run-read-390-details.png) |

## Sample Read

### 1440px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![sample-read 1440 Simple](sample-read-1440-simple.png) | ![sample-read 1440 Detailed](sample-read-1440-detailed.png) | ![sample-read 1440 Details expanded](sample-read-1440-details.png) |

### 390px

| Simple | Detailed | Details expanded |
|---|---|---|
| ![sample-read 390 Simple](sample-read-390-simple.png) | ![sample-read 390 Detailed](sample-read-390-detailed.png) | ![sample-read 390 Details expanded](sample-read-390-details.png) |

## Supplementary evidence

### delivery create 1440 simple blocker

![delivery-create-1440-simple-blocker](delivery-create-1440-simple-blocker.png)

### output stock correction 1440 additional details

![output-stock-correction-1440-additional-details](output-stock-correction-1440-additional-details.png)

### output stock correction 390 additional details

![output-stock-correction-390-additional-details](output-stock-correction-390-additional-details.png)

### output stock correction saved 1440 history

![output-stock-correction-saved-1440-history](output-stock-correction-saved-1440-history.png)

### output stock correction saved 390 history

![output-stock-correction-saved-390-history](output-stock-correction-saved-390-history.png)

### production run create 1440 additional details

![production-run-create-1440-additional-details](production-run-create-1440-additional-details.png)

### production run create 390 additional details

![production-run-create-390-additional-details](production-run-create-390-additional-details.png)

### sample read 390 transport right

![sample-read-390-transport-right](sample-read-390-transport-right.png)
