# Simple / Detailed rollout gallery

Captured on 2026-09-21 from the running local application at `http://localhost:3102`, using authenticated synthetic E2E fixtures and the isolated local database. These are direct browser viewport screenshots, with no image editing, stitching, masking or compositing.

**231 screenshots** cover all requested create/read/edit surfaces and stock operations in both **Simple** and **Detailed**, at **1440 × 1100 desktop** and **390 × 844 mobile**. Header captures show the toggle; section captures and numbered continuations show long-form content.

## Coverage

| Surface | States | Both modes | Both widths |
| --- | --- | --- | --- |
| Delivery: create | Populated | Yes | Yes |
| Delivery: read | Populated | Yes | Yes |
| Delivery: edit | Populated | Yes | Yes |
| Application: create | Populated | Yes | Yes |
| Application: read | Populated | Yes | Yes |
| Application: edit | Populated | Yes | Yes |
| Production Run: create | Populated | Yes | Yes |
| Production Run: read | Populated | Yes | Yes |
| Production Run: edit | Populated | Yes | Yes |
| Feedstock: create | Populated | Yes | Yes |
| Feedstock: read | Populated | Yes | Yes |
| Feedstock: edit | Populated | Yes | Yes |
| Credit Batch: read | Populated | Yes | Yes |
| Credit Batch: applied mass read | Populated | Yes | Yes |
| Sample: read with transport | Populated | Yes | Yes |
| Output bin: reconciliation | Populated | Yes | Yes |
| Output bin: loss | Populated | Yes | Yes |
| Output stock: correction | Populated | Yes | Yes |

Saved stock-correction history is also captured at both widths. Its history view has no Simple / Detailed toggle; the correction form does.

## Boundaries and limitations

- Product and Order screenshots are intentionally excluded; their unchanged rollout surfaces belong to PR #821.
- The gallery covers the requested rollout surfaces with representative valid data. It is not an exhaustive test of every optional field, validation error, permission role, certification tier or evidence-upload state.
- Create and edit screenshots show populated forms. Delivery and Application creation, stock reconciliation, loss and correction are submitted. Feedstock and Production Run create drafts and edit forms are inspected without saving; their read/edit records are fixture-seeded.
- Sample transport is read-only here. The Sample toggle is present because this sample has saved transport legs. The narrow Detailed table can require horizontal scrolling; the screenshots preserve the actual responsive UI.
- The conditional raw durability estimate and preview component/formula rows are not captured: this codebase intentionally disables the 200-year stored-CO2 preview (`SOIL_STORAGE_PREVIEW_REVERIFIED` is false). No application flags or data responses were altered to force those rows. A 1000-year registry-linked preview is outside this local fixture gallery.
- Credit-batch chemistry and durability values are synthetic local previews. No registry calls, real records, uploads or remote services were used.
- Next.js developer chrome was hidden through its own Preferences UI; transient notifications were dismissed before capture. Application content and styles were not altered.
- The correction modal scrolls its heading away in section views. Its matching header images retain the toggle context.

## Repeat capture

The server must already be running against the isolated database. Run alone; teardown sweeps E2E records.

```bash
source /private/tmp/noma-detail-rollout/local-test-env.sh
CAPTURE_FORM_DETAIL_GALLERY=1 pnpm exec playwright test tests/e2e/form-detail-gallery.spec.ts --workers=1 --reporter=line
```

The spec uses `tests/e2e/fixtures`, the output-stock browser fixture and real application writers. It requires exactly port 3102 and blocks nonlocal browser HTTP traffic. It never reads `.env.local`.

## Paired screenshots

Open any image to inspect it at native resolution. Each expandable group includes every captured section and continuation for that surface.

<details>
<summary>Delivery: create</summary>

A populated 2,000 kg shipment at 30% moisture removes 1,150 kg dry biochar across two FIFO batches. Detailed adds stock bars and batch/source-run allocation.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Delivery: create, simple, 1440px, header](delivery-create-simple-1440-header.png) | ![Delivery: create, detailed, 1440px, header](delivery-create-detailed-1440-header.png) |
| mass and moisture | ![Delivery: create, simple, 1440px, mass-and-moisture](delivery-create-simple-1440-mass-and-moisture.png) | ![Delivery: create, detailed, 1440px, mass-and-moisture](delivery-create-detailed-1440-mass-and-moisture.png) |
| mass and moisture part 2 | No continuation needed. | No continuation needed. |
| transport | ![Delivery: create, simple, 1440px, transport](delivery-create-simple-1440-transport.png) | ![Delivery: create, detailed, 1440px, transport](delivery-create-detailed-1440-transport.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Delivery: create, simple, 390px, header](delivery-create-simple-390-header.png) | ![Delivery: create, detailed, 390px, header](delivery-create-detailed-390-header.png) |
| mass and moisture | ![Delivery: create, simple, 390px, mass-and-moisture](delivery-create-simple-390-mass-and-moisture.png) | ![Delivery: create, detailed, 390px, mass-and-moisture](delivery-create-detailed-390-mass-and-moisture.png) |
| mass and moisture part 2 | No continuation needed. | ![Delivery: create, detailed, 390px, mass-and-moisture-part-2](delivery-create-detailed-390-mass-and-moisture-part-2.png) |
| transport | ![Delivery: create, simple, 390px, transport](delivery-create-simple-390-transport.png) | ![Delivery: create, detailed, 390px, transport](delivery-create-detailed-390-transport.png) |

</details>

<details>
<summary>Delivery: read</summary>

Saved wet and dry totals remain visible in Simple; Detailed adds the saved FIFO allocation.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Delivery: read, simple, 1440px, header](delivery-read-simple-1440-header.png) | ![Delivery: read, detailed, 1440px, header](delivery-read-detailed-1440-header.png) |
| mass and moisture | ![Delivery: read, simple, 1440px, mass-and-moisture](delivery-read-simple-1440-mass-and-moisture.png) | ![Delivery: read, detailed, 1440px, mass-and-moisture](delivery-read-detailed-1440-mass-and-moisture.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Delivery: read, simple, 390px, header](delivery-read-simple-390-header.png) | ![Delivery: read, detailed, 390px, header](delivery-read-detailed-390-header.png) |
| mass and moisture | ![Delivery: read, simple, 390px, mass-and-moisture](delivery-read-simple-390-mass-and-moisture.png) | ![Delivery: read, detailed, 390px, mass-and-moisture](delivery-read-detailed-390-mass-and-moisture.png) |

</details>

<details>
<summary>Delivery: edit</summary>

Saved delivery values and stock breakdown in both presentation modes.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Delivery: edit, simple, 1440px, header](delivery-edit-simple-1440-header.png) | ![Delivery: edit, detailed, 1440px, header](delivery-edit-detailed-1440-header.png) |
| mass and moisture | ![Delivery: edit, simple, 1440px, mass-and-moisture](delivery-edit-simple-1440-mass-and-moisture.png) | ![Delivery: edit, detailed, 1440px, mass-and-moisture](delivery-edit-detailed-1440-mass-and-moisture.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Delivery: edit, simple, 390px, header](delivery-edit-simple-390-header.png) | ![Delivery: edit, detailed, 390px, header](delivery-edit-detailed-390-header.png) |
| mass and moisture | ![Delivery: edit, simple, 390px, mass-and-moisture](delivery-edit-simple-390-mass-and-moisture.png) | ![Delivery: edit, detailed, 390px, mass-and-moisture](delivery-edit-detailed-390-mass-and-moisture.png) |

</details>

<details>
<summary>Application: create</summary>

1,000 kg of mixed product yields 575 kg dry biochar. Detailed shows the composition split.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Application: create, simple, 1440px, header](application-create-simple-1440-header.png) | ![Application: create, detailed, 1440px, header](application-create-detailed-1440-header.png) |
| application details | ![Application: create, simple, 1440px, application-details](application-create-simple-1440-application-details.png) | ![Application: create, detailed, 1440px, application-details](application-create-detailed-1440-application-details.png) |
| field details | ![Application: create, simple, 1440px, field-details](application-create-simple-1440-field-details.png) | ![Application: create, detailed, 1440px, field-details](application-create-detailed-1440-field-details.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Application: create, simple, 390px, header](application-create-simple-390-header.png) | ![Application: create, detailed, 390px, header](application-create-detailed-390-header.png) |
| application details | ![Application: create, simple, 390px, application-details](application-create-simple-390-application-details.png) | ![Application: create, detailed, 390px, application-details](application-create-detailed-390-application-details.png) |
| field details | ![Application: create, simple, 390px, field-details](application-create-simple-390-field-details.png) | ![Application: create, detailed, 390px, field-details](application-create-detailed-390-field-details.png) |

</details>

<details>
<summary>Application: read</summary>

Detailed shows applied batch shares of 450 kg and 125 kg, including source-run provenance.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Application: read, simple, 1440px, header](application-read-simple-1440-header.png) | ![Application: read, detailed, 1440px, header](application-read-detailed-1440-header.png) |
| application details | ![Application: read, simple, 1440px, application-details](application-read-simple-1440-application-details.png) | ![Application: read, detailed, 1440px, application-details](application-read-detailed-1440-application-details.png) |
| field details | ![Application: read, simple, 1440px, field-details](application-read-simple-1440-field-details.png) | ![Application: read, detailed, 1440px, field-details](application-read-detailed-1440-field-details.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Application: read, simple, 390px, header](application-read-simple-390-header.png) | ![Application: read, detailed, 390px, header](application-read-detailed-390-header.png) |
| application details | ![Application: read, simple, 390px, application-details](application-read-simple-390-application-details.png) | ![Application: read, detailed, 390px, application-details](application-read-detailed-390-application-details.png) |
| field details | ![Application: read, simple, 390px, field-details](application-read-simple-390-field-details.png) | ![Application: read, detailed, 390px, field-details](application-read-detailed-390-field-details.png) |

</details>

<details>
<summary>Application: edit</summary>

Populated saved application with its live composition preview, field size and location context.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Application: edit, simple, 1440px, header](application-edit-simple-1440-header.png) | ![Application: edit, detailed, 1440px, header](application-edit-detailed-1440-header.png) |
| application details | ![Application: edit, simple, 1440px, application-details](application-edit-simple-1440-application-details.png) | ![Application: edit, detailed, 1440px, application-details](application-edit-detailed-1440-application-details.png) |
| field details | ![Application: edit, simple, 1440px, field-details](application-edit-simple-1440-field-details.png) | ![Application: edit, detailed, 1440px, field-details](application-edit-detailed-1440-field-details.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Application: edit, simple, 390px, header](application-edit-simple-390-header.png) | ![Application: edit, detailed, 390px, header](application-edit-detailed-390-header.png) |
| application details | ![Application: edit, simple, 390px, application-details](application-edit-simple-390-application-details.png) | ![Application: edit, detailed, 390px, application-details](application-edit-detailed-390-application-details.png) |
| field details | ![Application: edit, simple, 390px, field-details](application-edit-simple-390-field-details.png) | ![Application: edit, detailed, 390px, field-details](application-edit-detailed-390-field-details.png) |

</details>

<details>
<summary>Production Run: create</summary>

Selected reactor, feedstock source, wet input, measured moisture, biochar output and energy. Detailed adds mass splits and equipment/bin context.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Production Run: create, simple, 1440px, header](production-run-create-simple-1440-header.png) | ![Production Run: create, detailed, 1440px, header](production-run-create-detailed-1440-header.png) |
| energy | ![Production Run: create, simple, 1440px, energy](production-run-create-simple-1440-energy.png) | ![Production Run: create, detailed, 1440px, energy](production-run-create-detailed-1440-energy.png) |
| feedstock processing | ![Production Run: create, simple, 1440px, feedstock-processing](production-run-create-simple-1440-feedstock-processing.png) | ![Production Run: create, detailed, 1440px, feedstock-processing](production-run-create-detailed-1440-feedstock-processing.png) |
| feedstock processing part 2 | No continuation needed. | No continuation needed. |
| output | ![Production Run: create, simple, 1440px, output](production-run-create-simple-1440-output.png) | ![Production Run: create, detailed, 1440px, output](production-run-create-detailed-1440-output.png) |
| process flow | ![Production Run: create, simple, 1440px, process-flow](production-run-create-simple-1440-process-flow.png) | ![Production Run: create, detailed, 1440px, process-flow](production-run-create-detailed-1440-process-flow.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Production Run: create, simple, 390px, header](production-run-create-simple-390-header.png) | ![Production Run: create, detailed, 390px, header](production-run-create-detailed-390-header.png) |
| energy | ![Production Run: create, simple, 390px, energy](production-run-create-simple-390-energy.png) | ![Production Run: create, detailed, 390px, energy](production-run-create-detailed-390-energy.png) |
| feedstock processing | ![Production Run: create, simple, 390px, feedstock-processing](production-run-create-simple-390-feedstock-processing.png) | ![Production Run: create, detailed, 390px, feedstock-processing](production-run-create-detailed-390-feedstock-processing.png) |
| feedstock processing part 2 | ![Production Run: create, simple, 390px, feedstock-processing-part-2](production-run-create-simple-390-feedstock-processing-part-2.png) | ![Production Run: create, detailed, 390px, feedstock-processing-part-2](production-run-create-detailed-390-feedstock-processing-part-2.png) |
| output | ![Production Run: create, simple, 390px, output](production-run-create-simple-390-output.png) | ![Production Run: create, detailed, 390px, output](production-run-create-detailed-390-output.png) |
| process flow | ![Production Run: create, simple, 390px, process-flow](production-run-create-simple-390-process-flow.png) | ![Production Run: create, detailed, 390px, process-flow](production-run-create-detailed-390-process-flow.png) |

</details>

<details>
<summary>Production Run: read</summary>

Saved run with 4,000 kg feedstock at 20% moisture and 1,250 kg biochar at 20% moisture; Detailed adds both mass diagrams.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Production Run: read, simple, 1440px, header](production-run-read-simple-1440-header.png) | ![Production Run: read, detailed, 1440px, header](production-run-read-detailed-1440-header.png) |
| feedstock processing | ![Production Run: read, simple, 1440px, feedstock-processing](production-run-read-simple-1440-feedstock-processing.png) | ![Production Run: read, detailed, 1440px, feedstock-processing](production-run-read-detailed-1440-feedstock-processing.png) |
| output | ![Production Run: read, simple, 1440px, output](production-run-read-simple-1440-output.png) | ![Production Run: read, detailed, 1440px, output](production-run-read-detailed-1440-output.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Production Run: read, simple, 390px, header](production-run-read-simple-390-header.png) | ![Production Run: read, detailed, 390px, header](production-run-read-detailed-390-header.png) |
| feedstock processing | ![Production Run: read, simple, 390px, feedstock-processing](production-run-read-simple-390-feedstock-processing.png) | ![Production Run: read, detailed, 390px, feedstock-processing](production-run-read-detailed-390-feedstock-processing.png) |
| output | ![Production Run: read, simple, 390px, output](production-run-read-simple-390-output.png) | ![Production Run: read, detailed, 390px, output](production-run-read-detailed-390-output.png) |

</details>

<details>
<summary>Production Run: edit</summary>

Saved source-bin draw, processing parameters, output and energy. Detailed adds explanatory context.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Production Run: edit, simple, 1440px, header](production-run-edit-simple-1440-header.png) | ![Production Run: edit, detailed, 1440px, header](production-run-edit-detailed-1440-header.png) |
| energy | ![Production Run: edit, simple, 1440px, energy](production-run-edit-simple-1440-energy.png) | ![Production Run: edit, detailed, 1440px, energy](production-run-edit-detailed-1440-energy.png) |
| feedstock processing | ![Production Run: edit, simple, 1440px, feedstock-processing](production-run-edit-simple-1440-feedstock-processing.png) | ![Production Run: edit, detailed, 1440px, feedstock-processing](production-run-edit-detailed-1440-feedstock-processing.png) |
| output | ![Production Run: edit, simple, 1440px, output](production-run-edit-simple-1440-output.png) | ![Production Run: edit, detailed, 1440px, output](production-run-edit-detailed-1440-output.png) |
| process flow | ![Production Run: edit, simple, 1440px, process-flow](production-run-edit-simple-1440-process-flow.png) | ![Production Run: edit, detailed, 1440px, process-flow](production-run-edit-detailed-1440-process-flow.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Production Run: edit, simple, 390px, header](production-run-edit-simple-390-header.png) | ![Production Run: edit, detailed, 390px, header](production-run-edit-detailed-390-header.png) |
| energy | ![Production Run: edit, simple, 390px, energy](production-run-edit-simple-390-energy.png) | ![Production Run: edit, detailed, 390px, energy](production-run-edit-detailed-390-energy.png) |
| feedstock processing | ![Production Run: edit, simple, 390px, feedstock-processing](production-run-edit-simple-390-feedstock-processing.png) | ![Production Run: edit, detailed, 390px, feedstock-processing](production-run-edit-detailed-390-feedstock-processing.png) |
| output | ![Production Run: edit, simple, 390px, output](production-run-edit-simple-390-output.png) | ![Production Run: edit, detailed, 390px, output](production-run-edit-detailed-390-output.png) |
| process flow | ![Production Run: edit, simple, 390px, process-flow](production-run-edit-simple-390-process-flow.png) | ![Production Run: edit, detailed, 390px, process-flow](production-run-edit-detailed-390-process-flow.png) |

</details>

<details>
<summary>Feedstock: create</summary>

1,500 kg wet intake at 20% moisture, fully allocated to a selected bin. Detailed shows 1,200 kg dry material and 300 kg water.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Feedstock: create, simple, 1440px, header](feedstock-create-simple-1440-header.png) | ![Feedstock: create, detailed, 1440px, header](feedstock-create-detailed-1440-header.png) |
| bin allocations | ![Feedstock: create, simple, 1440px, bin-allocations](feedstock-create-simple-1440-bin-allocations.png) | ![Feedstock: create, detailed, 1440px, bin-allocations](feedstock-create-detailed-1440-bin-allocations.png) |
| material | ![Feedstock: create, simple, 1440px, material](feedstock-create-simple-1440-material.png) | ![Feedstock: create, detailed, 1440px, material](feedstock-create-detailed-1440-material.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Feedstock: create, simple, 390px, header](feedstock-create-simple-390-header.png) | ![Feedstock: create, detailed, 390px, header](feedstock-create-detailed-390-header.png) |
| bin allocations | ![Feedstock: create, simple, 390px, bin-allocations](feedstock-create-simple-390-bin-allocations.png) | ![Feedstock: create, detailed, 390px, bin-allocations](feedstock-create-detailed-390-bin-allocations.png) |
| material | ![Feedstock: create, simple, 390px, material](feedstock-create-simple-390-material.png) | ![Feedstock: create, detailed, 390px, material](feedstock-create-detailed-390-material.png) |

</details>

<details>
<summary>Feedstock: read</summary>

Populated intake, supplier, transport distance and bin allocation. Detailed adds the mass split.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Feedstock: read, simple, 1440px, header](feedstock-read-simple-1440-header.png) | ![Feedstock: read, detailed, 1440px, header](feedstock-read-detailed-1440-header.png) |
| material | ![Feedstock: read, simple, 1440px, material](feedstock-read-simple-1440-material.png) | ![Feedstock: read, detailed, 1440px, material](feedstock-read-detailed-1440-material.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Feedstock: read, simple, 390px, header](feedstock-read-simple-390-header.png) | ![Feedstock: read, detailed, 390px, header](feedstock-read-detailed-390-header.png) |
| material | ![Feedstock: read, simple, 390px, material](feedstock-read-simple-390-material.png) | ![Feedstock: read, detailed, 390px, material](feedstock-read-detailed-390-material.png) |

</details>

<details>
<summary>Feedstock: edit</summary>

Saved intake values and allocation in both modes, with the mass diagram in Detailed.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Feedstock: edit, simple, 1440px, header](feedstock-edit-simple-1440-header.png) | ![Feedstock: edit, detailed, 1440px, header](feedstock-edit-detailed-1440-header.png) |
| bin allocations | ![Feedstock: edit, simple, 1440px, bin-allocations](feedstock-edit-simple-1440-bin-allocations.png) | ![Feedstock: edit, detailed, 1440px, bin-allocations](feedstock-edit-detailed-1440-bin-allocations.png) |
| material | ![Feedstock: edit, simple, 1440px, material](feedstock-edit-simple-1440-material.png) | ![Feedstock: edit, detailed, 1440px, material](feedstock-edit-detailed-1440-material.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Feedstock: edit, simple, 390px, header](feedstock-edit-simple-390-header.png) | ![Feedstock: edit, detailed, 390px, header](feedstock-edit-detailed-390-header.png) |
| bin allocations | ![Feedstock: edit, simple, 390px, bin-allocations](feedstock-edit-simple-390-bin-allocations.png) | ![Feedstock: edit, detailed, 390px, bin-allocations](feedstock-edit-detailed-390-bin-allocations.png) |
| material | ![Feedstock: edit, simple, 390px, material](feedstock-edit-simple-390-material.png) | ![Feedstock: edit, detailed, 390px, material](feedstock-edit-detailed-390-material.png) |

</details>

<details>
<summary>Credit Batch: read</summary>

Batch with two member runs and three chemistry samples. Detailed adds source-record links; this example has no applied mass.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Credit Batch: read, simple, 1440px, header](credit-batch-read-simple-1440-header.png) | ![Credit Batch: read, detailed, 1440px, header](credit-batch-read-detailed-1440-header.png) |
| batch definition | ![Credit Batch: read, simple, 1440px, batch-definition](credit-batch-read-simple-1440-batch-definition.png) | ![Credit Batch: read, detailed, 1440px, batch-definition](credit-batch-read-detailed-1440-batch-definition.png) |
| carbon ledger | ![Credit Batch: read, simple, 1440px, carbon-ledger](credit-batch-read-simple-1440-carbon-ledger.png) | ![Credit Batch: read, detailed, 1440px, carbon-ledger](credit-batch-read-detailed-1440-carbon-ledger.png) |
| production runs | ![Credit Batch: read, simple, 1440px, production-runs](credit-batch-read-simple-1440-production-runs.png) | ![Credit Batch: read, detailed, 1440px, production-runs](credit-batch-read-detailed-1440-production-runs.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Credit Batch: read, simple, 390px, header](credit-batch-read-simple-390-header.png) | ![Credit Batch: read, detailed, 390px, header](credit-batch-read-detailed-390-header.png) |
| batch definition | ![Credit Batch: read, simple, 390px, batch-definition](credit-batch-read-simple-390-batch-definition.png) | ![Credit Batch: read, detailed, 390px, batch-definition](credit-batch-read-detailed-390-batch-definition.png) |
| carbon ledger | ![Credit Batch: read, simple, 390px, carbon-ledger](credit-batch-read-simple-390-carbon-ledger.png) | ![Credit Batch: read, detailed, 390px, carbon-ledger](credit-batch-read-detailed-390-carbon-ledger.png) |
| production runs | ![Credit Batch: read, simple, 390px, production-runs](credit-batch-read-simple-390-production-runs.png) | ![Credit Batch: read, detailed, 390px, production-runs](credit-batch-read-detailed-390-production-runs.png) |

</details>

<details>
<summary>Credit Batch: applied mass read</summary>

Batch backed by FIFO-delivered and applied biochar, with chemistry samples and soil temperature. Both modes show 1.00 t applied; Detailed adds source-record links.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Credit Batch: applied mass read, simple, 1440px, header](credit-batch-applied-read-simple-1440-header.png) | ![Credit Batch: applied mass read, detailed, 1440px, header](credit-batch-applied-read-detailed-1440-header.png) |
| batch definition | ![Credit Batch: applied mass read, simple, 1440px, batch-definition](credit-batch-applied-read-simple-1440-batch-definition.png) | ![Credit Batch: applied mass read, detailed, 1440px, batch-definition](credit-batch-applied-read-detailed-1440-batch-definition.png) |
| carbon ledger | ![Credit Batch: applied mass read, simple, 1440px, carbon-ledger](credit-batch-applied-read-simple-1440-carbon-ledger.png) | ![Credit Batch: applied mass read, detailed, 1440px, carbon-ledger](credit-batch-applied-read-detailed-1440-carbon-ledger.png) |
| production runs | ![Credit Batch: applied mass read, simple, 1440px, production-runs](credit-batch-applied-read-simple-1440-production-runs.png) | ![Credit Batch: applied mass read, detailed, 1440px, production-runs](credit-batch-applied-read-detailed-1440-production-runs.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Credit Batch: applied mass read, simple, 390px, header](credit-batch-applied-read-simple-390-header.png) | ![Credit Batch: applied mass read, detailed, 390px, header](credit-batch-applied-read-detailed-390-header.png) |
| batch definition | ![Credit Batch: applied mass read, simple, 390px, batch-definition](credit-batch-applied-read-simple-390-batch-definition.png) | ![Credit Batch: applied mass read, detailed, 390px, batch-definition](credit-batch-applied-read-detailed-390-batch-definition.png) |
| carbon ledger | ![Credit Batch: applied mass read, simple, 390px, carbon-ledger](credit-batch-applied-read-simple-390-carbon-ledger.png) | ![Credit Batch: applied mass read, detailed, 390px, carbon-ledger](credit-batch-applied-read-detailed-390-carbon-ledger.png) |
| production runs | ![Credit Batch: applied mass read, simple, 390px, production-runs](credit-batch-applied-read-simple-390-production-runs.png) | ![Credit Batch: applied mass read, detailed, 390px, production-runs](credit-batch-applied-read-detailed-390-production-runs.png) |

</details>

<details>
<summary>Sample: read with transport</summary>

Populated lab sample with two saved road legs: 42 km return and 180 km one way. Simple summarises transport; Detailed shows the leg table.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Sample: read with transport, simple, 1440px, header](sample-read-simple-1440-header.png) | ![Sample: read with transport, detailed, 1440px, header](sample-read-detailed-1440-header.png) |
| transport | ![Sample: read with transport, simple, 1440px, transport](sample-read-simple-1440-transport.png) | ![Sample: read with transport, detailed, 1440px, transport](sample-read-detailed-1440-transport.png) |
| transport right | No continuation needed. | No continuation needed. |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Sample: read with transport, simple, 390px, header](sample-read-simple-390-header.png) | ![Sample: read with transport, detailed, 390px, header](sample-read-detailed-390-header.png) |
| transport | ![Sample: read with transport, simple, 390px, transport](sample-read-simple-390-transport.png) | ![Sample: read with transport, detailed, 390px, transport](sample-read-detailed-390-transport.png) |
| transport right | No continuation needed. | ![Sample: read with transport, detailed, 390px, transport-right](sample-read-detailed-390-transport-right.png) |

</details>

<details>
<summary>Output bin: reconciliation</summary>

A count of 600 kg wet at 30% moisture preserves 350 kg dry biochar. Simple retains the no-loss result; Detailed expands the stock comparison.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Output bin: reconciliation, simple, 1440px, header](output-bin-reconciliation-simple-1440-header.png) | ![Output bin: reconciliation, detailed, 1440px, header](output-bin-reconciliation-detailed-1440-header.png) |
| reason | ![Output bin: reconciliation, simple, 1440px, reason](output-bin-reconciliation-simple-1440-reason.png) | ![Output bin: reconciliation, detailed, 1440px, reason](output-bin-reconciliation-detailed-1440-reason.png) |
| stock preview | ![Output bin: reconciliation, simple, 1440px, stock-preview](output-bin-reconciliation-simple-1440-stock-preview.png) | ![Output bin: reconciliation, detailed, 1440px, stock-preview](output-bin-reconciliation-detailed-1440-stock-preview.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Output bin: reconciliation, simple, 390px, header](output-bin-reconciliation-simple-390-header.png) | ![Output bin: reconciliation, detailed, 390px, header](output-bin-reconciliation-detailed-390-header.png) |
| reason | ![Output bin: reconciliation, simple, 390px, reason](output-bin-reconciliation-simple-390-reason.png) | ![Output bin: reconciliation, detailed, 390px, reason](output-bin-reconciliation-detailed-390-reason.png) |
| stock preview | ![Output bin: reconciliation, simple, 390px, stock-preview](output-bin-reconciliation-simple-390-stock-preview.png) | ![Output bin: reconciliation, detailed, 390px, stock-preview](output-bin-reconciliation-detailed-390-stock-preview.png) |

</details>

<details>
<summary>Output bin: loss</summary>

120 kg wet removed at 30% moisture results in 70 kg dry biochar lost. Detailed adds the FIFO breakdown and before/after bars.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Output bin: loss, simple, 1440px, header](output-bin-loss-simple-1440-header.png) | ![Output bin: loss, detailed, 1440px, header](output-bin-loss-detailed-1440-header.png) |
| reason | ![Output bin: loss, simple, 1440px, reason](output-bin-loss-simple-1440-reason.png) | ![Output bin: loss, detailed, 1440px, reason](output-bin-loss-detailed-1440-reason.png) |
| stock preview | ![Output bin: loss, simple, 1440px, stock-preview](output-bin-loss-simple-1440-stock-preview.png) | ![Output bin: loss, detailed, 1440px, stock-preview](output-bin-loss-detailed-1440-stock-preview.png) |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Output bin: loss, simple, 390px, header](output-bin-loss-simple-390-header.png) | ![Output bin: loss, detailed, 390px, header](output-bin-loss-detailed-390-header.png) |
| reason | ![Output bin: loss, simple, 390px, reason](output-bin-loss-simple-390-reason.png) | ![Output bin: loss, detailed, 390px, reason](output-bin-loss-detailed-390-reason.png) |
| stock preview | ![Output bin: loss, simple, 390px, stock-preview](output-bin-loss-simple-390-stock-preview.png) | ![Output bin: loss, detailed, 390px, stock-preview](output-bin-loss-detailed-390-stock-preview.png) |

</details>

<details>
<summary>Output stock: correction</summary>

Corrects the recorded spill to 12 kg wet, or 7 kg dry biochar, using the original-entry and replacement form. Detailed expands the replacement preview.

### Desktop (1440px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Output stock: correction, simple, 1440px, header](output-stock-correction-simple-1440-header.png) | ![Output stock: correction, detailed, 1440px, header](output-stock-correction-detailed-1440-header.png) |
| proposed replacement | ![Output stock: correction, simple, 1440px, proposed-replacement](output-stock-correction-simple-1440-proposed-replacement.png) | ![Output stock: correction, detailed, 1440px, proposed-replacement](output-stock-correction-detailed-1440-proposed-replacement.png) |
| stock preview | ![Output stock: correction, simple, 1440px, stock-preview](output-stock-correction-simple-1440-stock-preview.png) | ![Output stock: correction, detailed, 1440px, stock-preview](output-stock-correction-detailed-1440-stock-preview.png) |
| stock preview part 2 | No continuation needed. | No continuation needed. |

### Mobile (390px)

| Position | Simple | Detailed |
| --- | --- | --- |
| header | ![Output stock: correction, simple, 390px, header](output-stock-correction-simple-390-header.png) | ![Output stock: correction, detailed, 390px, header](output-stock-correction-detailed-390-header.png) |
| proposed replacement | ![Output stock: correction, simple, 390px, proposed-replacement](output-stock-correction-simple-390-proposed-replacement.png) | ![Output stock: correction, detailed, 390px, proposed-replacement](output-stock-correction-detailed-390-proposed-replacement.png) |
| stock preview | ![Output stock: correction, simple, 390px, stock-preview](output-stock-correction-simple-390-stock-preview.png) | ![Output stock: correction, detailed, 390px, stock-preview](output-stock-correction-detailed-390-stock-preview.png) |
| stock preview part 2 | No continuation needed. | ![Output stock: correction, detailed, 390px, stock-preview-part-2](output-stock-correction-detailed-390-stock-preview-part-2.png) |

</details>

## Saved correction history

After saving the replacement, the immutable history retains the original spill, reversal and corrected entry.

| Desktop | Mobile |
| --- | --- |
| ![Saved correction history at 1440px](output-stock-correction-saved-1440-history.png) | ![Saved correction history at 390px](output-stock-correction-saved-390-history.png) |
