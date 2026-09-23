# Form detail gallery, PR #822

Real viewport captures (1440x1100 and 390x844) of the Simple and Detailed levels on PR #822, taken from an isolated local app with synthetic fixtures and normal authentication. `captures.jsonl` records the viewport and route of each image.

The images were last captured on 23 September 2026, after the fix round that followed the layout contract, and get refreshed again before the PR is marked ready. They show:

- Simple keeps inputs, saved fields, blockers, warnings and evidence, plus each derived block's declared Simple presence (the boundary table in [forms.md](../../../forms.md#simple-and-detailed-presentation)).
- Derived blocks sit flat under the inputs that drive them: a sentence case caption with an ⓘ hint, at most one headline figure, the picture, and one action row. Show calculation is Detailed only.
- Stock blocks lead with the bin's wet estimate; the dry biochar pair is Detailed only. Bin selectors show the stock change inline.
- Transport legs are one line each with an actions menu. Section titles are sentence case, not eyebrows.

## Reproduce

Opt-in and skipped in ordinary CI. `tests/e2e/form-detail-gallery.spec.ts` is hardcoded to an isolated server on port 3102 (a guard at the top, an assertion in `beforeEach`, and a route filter that aborts every other host). Captures run from a temporary copy of the spec pointed at the server in use. The example below targets a worktree on port 3105 (`DISABLE_RATE_LIMIT=true NEXT_PUBLIC_APP_URL=http://localhost:3105 pnpm exec next dev -p 3105`, database `noma_dmrv_worktree`); from the main checkout, substitute 3100 for 3105 throughout:

```sh
sed 's/3102/3105/g' tests/e2e/form-detail-gallery.spec.ts > tests/e2e/zz-tmp-form-detail-gallery.spec.ts
find docs/archive/qa/2026-09-22-form-detail-e -type f -name '*.png' -delete
rm -f docs/archive/qa/2026-09-22-form-detail-e/captures.jsonl
set -a; source .env.local; set +a
CAPTURE_FORM_DETAIL_GALLERY=1 NODE_ENV=test NEXT_PUBLIC_APP_URL=http://localhost:3105 DISABLE_RATE_LIMIT=true \
  pnpm exec playwright test tests/e2e/zz-tmp-form-detail-gallery.spec.ts --workers=1 --reporter=line
rm tests/e2e/zz-tmp-form-detail-gallery.spec.ts
```

For a throwaway run, point `OUTPUT` in the copy at a scratch folder instead of deleting these images. Never commit the `zz-tmp-` copy.

## Application create

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![application-create 1440 Simple](application-create-1440-simple.png) | ![application-create 1440 Detailed](application-create-1440-detailed.png) | ![application-create 1440 Calculation shown](application-create-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![application-create 390 Simple](application-create-390-simple.png) | ![application-create 390 Detailed](application-create-390-detailed.png) | ![application-create 390 Calculation shown](application-create-390-details.png) |

## Application edit

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![application-edit 1440 Simple](application-edit-1440-simple.png) | ![application-edit 1440 Detailed](application-edit-1440-detailed.png) | ![application-edit 1440 Calculation shown](application-edit-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![application-edit 390 Simple](application-edit-390-simple.png) | ![application-edit 390 Detailed](application-edit-390-detailed.png) | ![application-edit 390 Calculation shown](application-edit-390-details.png) |

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

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![credit-batch-applied-read 1440 Simple](credit-batch-applied-read-1440-simple.png) | ![credit-batch-applied-read 1440 Detailed](credit-batch-applied-read-1440-detailed.png) | ![credit-batch-applied-read 1440 Calculation shown](credit-batch-applied-read-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![credit-batch-applied-read 390 Simple](credit-batch-applied-read-390-simple.png) | ![credit-batch-applied-read 390 Detailed](credit-batch-applied-read-390-detailed.png) | ![credit-batch-applied-read 390 Calculation shown](credit-batch-applied-read-390-details.png) |

## Credit batch read

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![credit-batch-read 1440 Simple](credit-batch-read-1440-simple.png) | ![credit-batch-read 1440 Detailed](credit-batch-read-1440-detailed.png) | ![credit-batch-read 1440 Calculation shown](credit-batch-read-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![credit-batch-read 390 Simple](credit-batch-read-390-simple.png) | ![credit-batch-read 390 Detailed](credit-batch-read-390-detailed.png) | ![credit-batch-read 390 Calculation shown](credit-batch-read-390-details.png) |

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

## Formulation create over

### 1440px

| Simple | Detailed |
|---|---|
| ![formulation-create-over 1440 Simple](formulation-create-over-1440-simple.png) | ![formulation-create-over 1440 Detailed](formulation-create-over-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![formulation-create-over 390 Simple](formulation-create-over-390-simple.png) | ![formulation-create-over 390 Detailed](formulation-create-over-390-detailed.png) |

## Formulation create under

### 1440px

| Simple | Detailed |
|---|---|
| ![formulation-create-under 1440 Simple](formulation-create-under-1440-simple.png) | ![formulation-create-under 1440 Detailed](formulation-create-under-1440-detailed.png) |

### 390px

| Simple | Detailed |
|---|---|
| ![formulation-create-under 390 Simple](formulation-create-under-390-simple.png) | ![formulation-create-under 390 Detailed](formulation-create-under-390-detailed.png) |

## Order create

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![order-create 1440 Simple](order-create-1440-simple.png) | ![order-create 1440 Detailed](order-create-1440-detailed.png) | ![order-create 1440 Calculation shown](order-create-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![order-create 390 Simple](order-create-390-simple.png) | ![order-create 390 Detailed](order-create-390-detailed.png) | ![order-create 390 Calculation shown](order-create-390-details.png) |

## Order read

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![order-read 1440 Simple](order-read-1440-simple.png) | ![order-read 1440 Detailed](order-read-1440-detailed.png) | ![order-read 1440 Calculation shown](order-read-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![order-read 390 Simple](order-read-390-simple.png) | ![order-read 390 Detailed](order-read-390-detailed.png) | ![order-read 390 Calculation shown](order-read-390-details.png) |

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

## Product create

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![product-create 1440 Simple](product-create-1440-simple.png) | ![product-create 1440 Detailed](product-create-1440-detailed.png) | ![product-create 1440 Calculation shown](product-create-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![product-create 390 Simple](product-create-390-simple.png) | ![product-create 390 Detailed](product-create-390-detailed.png) | ![product-create 390 Calculation shown](product-create-390-details.png) |

## Product read

### 1440px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![product-read 1440 Simple](product-read-1440-simple.png) | ![product-read 1440 Detailed](product-read-1440-detailed.png) | ![product-read 1440 Calculation shown](product-read-1440-details.png) |

### 390px

| Simple | Detailed | Calculation shown |
|---|---|---|
| ![product-read 390 Simple](product-read-390-simple.png) | ![product-read 390 Detailed](product-read-390-detailed.png) | ![product-read 390 Calculation shown](product-read-390-details.png) |

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

## Sample create

### 1440px

| Detailed | Calculation shown |
|---|---|
| ![sample-create 1440 Detailed](sample-create-1440-detailed.png) | ![sample-create 1440 Calculation shown](sample-create-1440-details.png) |

### 390px

| Detailed | Calculation shown |
|---|---|
| ![sample-create 390 Detailed](sample-create-390-detailed.png) | ![sample-create 390 Calculation shown](sample-create-390-details.png) |

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

### output stock correction saved 1440 history

![output-stock-correction-saved-1440-history](output-stock-correction-saved-1440-history.png)

### output stock correction saved 390 history

![output-stock-correction-saved-390-history](output-stock-correction-saved-390-history.png)

### product create 1440 simple lower

![product-create-1440-simple-lower](product-create-1440-simple-lower.png)

### product create 390 simple lower

![product-create-390-simple-lower](product-create-390-simple-lower.png)
