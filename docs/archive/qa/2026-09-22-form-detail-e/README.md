# Form detail gallery, 22 September 2026

Screenshots of the Simple / Detailed presentation after the design pass on PR #822, captured from an isolated local app with synthetic fixtures and normal authentication. Real viewport captures at 1440x1100 and 390x844, not mockups.

Simple shows inputs and their saved fields, plus every blocker, warning and required-evidence tag. Detailed adds tinted composition cards: a title with a definition behind an info hint, aligned label and value rows, a 4px mini bar per component, and a "Show calculation" disclosure only where there is real arithmetic to reveal (before and after balances, FIFO layer draws, source runs). Formula text, provenance boilerplate and restated totals are gone. Transport legs render as stacked leg blocks instead of a wide table. Stock history is a timeline of entries with kind chips and before and after rows.

## Verification result

All five capture scenarios passed. Typecheck, lint, spacing check and the colocated Vitest suite passed apart from three pre-existing failures in the supplier quick-add dialog test that also fail on the PR head in CI. The blocker on Delivery create renders once, under the wet-mass field.

## Reproduce

Opt-in and skipped in ordinary CI. Serve the app on localhost:3102 against an isolated database, then:

```sh
find docs/archive/qa/2026-09-22-form-detail-e -type f -name '*.png' -delete
rm -f docs/archive/qa/2026-09-22-form-detail-e/captures.jsonl
CAPTURE_FORM_DETAIL_GALLERY=1 NEXT_PUBLIC_APP_URL=http://localhost:3102 pnpm exec playwright test tests/e2e/form-detail-gallery.spec.ts --workers=1 --reporter=line
```

`captures.jsonl` records viewport and route per image. 97 PNGs across 18 surface groups.

## Application create

### 1440px

| Simple | Detailed |
|---|---|
| ![application-create 1440 Simple](application-create-1440-simple.png) | ![application-create 1440 Detailed](application-create-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![application-create 390 Simple](application-create-390-simple.png) | ![application-create 390 Detailed](application-create-390-detailed.png) |

## Application edit

### 1440px

| Simple | Detailed |
|---|---|
| ![application-edit 1440 Simple](application-edit-1440-simple.png) | ![application-edit 1440 Detailed](application-edit-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![application-edit 390 Simple](application-edit-390-simple.png) | ![application-edit 390 Detailed](application-edit-390-detailed.png) |

## Application read

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![application-read 1440 Simple](application-read-1440-simple.png) | ![application-read 1440 Detailed](application-read-1440-detailed.png) | ![application-read 1440 Calculation shown](application-read-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![application-read 390 Simple](application-read-390-simple.png) | ![application-read 390 Detailed](application-read-390-detailed.png) | ![application-read 390 Calculation shown](application-read-390-details.png) |

## Credit batch applied read

### 1440px

| Simple | Detailed |
|---|---|
| ![credit-batch-applied-read 1440 Simple](credit-batch-applied-read-1440-simple.png) | ![credit-batch-applied-read 1440 Detailed](credit-batch-applied-read-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![credit-batch-applied-read 390 Simple](credit-batch-applied-read-390-simple.png) | ![credit-batch-applied-read 390 Detailed](credit-batch-applied-read-390-detailed.png) |

## Credit batch read

### 1440px

| Simple | Detailed |
|---|---|
| ![credit-batch-read 1440 Simple](credit-batch-read-1440-simple.png) | ![credit-batch-read 1440 Detailed](credit-batch-read-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![credit-batch-read 390 Simple](credit-batch-read-390-simple.png) | ![credit-batch-read 390 Detailed](credit-batch-read-390-detailed.png) |

## Delivery create

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![delivery-create 1440 Simple](delivery-create-1440-simple.png) | ![delivery-create 1440 Detailed](delivery-create-1440-detailed.png) | ![delivery-create 1440 Calculation shown](delivery-create-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![delivery-create 390 Simple](delivery-create-390-simple.png) | ![delivery-create 390 Detailed](delivery-create-390-detailed.png) | ![delivery-create 390 Calculation shown](delivery-create-390-details.png) |

## Delivery edit

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![delivery-edit 1440 Simple](delivery-edit-1440-simple.png) | ![delivery-edit 1440 Detailed](delivery-edit-1440-detailed.png) | ![delivery-edit 1440 Calculation shown](delivery-edit-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![delivery-edit 390 Simple](delivery-edit-390-simple.png) | ![delivery-edit 390 Detailed](delivery-edit-390-detailed.png) | ![delivery-edit 390 Calculation shown](delivery-edit-390-details.png) |

## Delivery read

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![delivery-read 1440 Simple](delivery-read-1440-simple.png) | ![delivery-read 1440 Detailed](delivery-read-1440-detailed.png) | ![delivery-read 1440 Calculation shown](delivery-read-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![delivery-read 390 Simple](delivery-read-390-simple.png) | ![delivery-read 390 Detailed](delivery-read-390-detailed.png) | ![delivery-read 390 Calculation shown](delivery-read-390-details.png) |

## Feedstock create

### 1440px

| Simple | Detailed |
|---|---|
| ![feedstock-create 1440 Simple](feedstock-create-1440-simple.png) | ![feedstock-create 1440 Detailed](feedstock-create-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![feedstock-create 390 Simple](feedstock-create-390-simple.png) | ![feedstock-create 390 Detailed](feedstock-create-390-detailed.png) |

## Feedstock edit

### 1440px

| Simple | Detailed |
|---|---|
| ![feedstock-edit 1440 Simple](feedstock-edit-1440-simple.png) | ![feedstock-edit 1440 Detailed](feedstock-edit-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![feedstock-edit 390 Simple](feedstock-edit-390-simple.png) | ![feedstock-edit 390 Detailed](feedstock-edit-390-detailed.png) |

## Feedstock read

### 1440px

| Simple | Detailed |
|---|---|
| ![feedstock-read 1440 Simple](feedstock-read-1440-simple.png) | ![feedstock-read 1440 Detailed](feedstock-read-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![feedstock-read 390 Simple](feedstock-read-390-simple.png) | ![feedstock-read 390 Detailed](feedstock-read-390-detailed.png) |

## Output bin loss

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![output-bin-loss 1440 Simple](output-bin-loss-1440-simple.png) | ![output-bin-loss 1440 Detailed](output-bin-loss-1440-detailed.png) | ![output-bin-loss 1440 Calculation shown](output-bin-loss-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![output-bin-loss 390 Simple](output-bin-loss-390-simple.png) | ![output-bin-loss 390 Detailed](output-bin-loss-390-detailed.png) | ![output-bin-loss 390 Calculation shown](output-bin-loss-390-details.png) |

## Output bin reconciliation

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![output-bin-reconciliation 1440 Simple](output-bin-reconciliation-1440-simple.png) | ![output-bin-reconciliation 1440 Detailed](output-bin-reconciliation-1440-detailed.png) | ![output-bin-reconciliation 1440 Calculation shown](output-bin-reconciliation-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![output-bin-reconciliation 390 Simple](output-bin-reconciliation-390-simple.png) | ![output-bin-reconciliation 390 Detailed](output-bin-reconciliation-390-detailed.png) | ![output-bin-reconciliation 390 Calculation shown](output-bin-reconciliation-390-details.png) |

## Output stock correction

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![output-stock-correction 1440 Simple](output-stock-correction-1440-simple.png) | ![output-stock-correction 1440 Detailed](output-stock-correction-1440-detailed.png) | ![output-stock-correction 1440 Calculation shown](output-stock-correction-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![output-stock-correction 390 Simple](output-stock-correction-390-simple.png) | ![output-stock-correction 390 Detailed](output-stock-correction-390-detailed.png) | ![output-stock-correction 390 Calculation shown](output-stock-correction-390-details.png) |

## Production run create

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![production-run-create 1440 Simple](production-run-create-1440-simple.png) | ![production-run-create 1440 Detailed](production-run-create-1440-detailed.png) | ![production-run-create 1440 Calculation shown](production-run-create-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![production-run-create 390 Simple](production-run-create-390-simple.png) | ![production-run-create 390 Detailed](production-run-create-390-detailed.png) | ![production-run-create 390 Calculation shown](production-run-create-390-details.png) |

## Production run edit

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![production-run-edit 1440 Simple](production-run-edit-1440-simple.png) | ![production-run-edit 1440 Detailed](production-run-edit-1440-detailed.png) | ![production-run-edit 1440 Calculation shown](production-run-edit-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![production-run-edit 390 Simple](production-run-edit-390-simple.png) | ![production-run-edit 390 Detailed](production-run-edit-390-detailed.png) | ![production-run-edit 390 Calculation shown](production-run-edit-390-details.png) |

## Production run read

### 1440px

| Simple | Detailed |
|---|---|
| ![production-run-read 1440 Simple](production-run-read-1440-simple.png) | ![production-run-read 1440 Detailed](production-run-read-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![production-run-read 390 Simple](production-run-read-390-simple.png) | ![production-run-read 390 Detailed](production-run-read-390-detailed.png) |

## Sample read

### 1440px

| Simple | Detailed |
|---|---|
| ![sample-read 1440 Simple](sample-read-1440-simple.png) | ![sample-read 1440 Detailed](sample-read-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![sample-read 390 Simple](sample-read-390-simple.png) | ![sample-read 390 Detailed](sample-read-390-detailed.png) |

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
