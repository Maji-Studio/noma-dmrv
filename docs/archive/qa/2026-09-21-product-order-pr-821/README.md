# Product and Order screenshot review

Visual evidence for [PR #821](https://github.com/Maji-Studio/noma-dmrv/pull/821), captured from the real application after the declutter pass (one composition table per surface, stock context as its own panel, calculation lists and repeated headers removed). Use this gallery to review the Product and Order create, read, and edit surfaces on desktop and narrow screens.

Application commit: `4b695612a3e113ec55fbbf5e5e6c4ea376217eae`.

These screenshots use synthetic local E2E records. Desktop viewport: 1440 × 1100; narrow viewport: 390 × 844. Images are unmodified full-page browser captures, so some include success toasts, the local development badge, or page content below the sheet viewport. The browser flow scrolls to the relevant fields before each capture; individual images are views of the sheet rather than stitched captures of all its content.

Validation at capture: the Product/Order presentation, FIFO, and distribution browser specs passed (16 tests), including keyboard Details controls, value preservation, actual saves, and narrow-layout overflow checks.

## Quick comparison

| Product | Order |
| --- | --- |
| [Create: Simple](product-simple-desktop.png) | [Create: Detailed](order-detailed-desktop.png) |
| [Create: Detailed](product-detailed-desktop.png) | [Field layout](order-fields-desktop.png) |
| [Read](product-read-detailed.png) | [Read](order-read-detailed.png) |
| [Edit](product-edit-detailed.png) | [Edit](order-edit-detailed.png) |
| [Narrow create](product-detailed-narrow.png) | [Narrow create](order-detailed-narrow.png) |
| [Narrow read](product-read-narrow.png) | [Narrow read](order-read-narrow.png) |
| [Narrow edit](product-edit-narrow.png) | [Narrow edit](order-edit-narrow.png) |

## Product

<details>
<summary>Create: Simple</summary>

![Product: Create: Simple](product-simple-desktop.png)

</details>

<details>
<summary>Create: Detailed with calculation context</summary>

![Product: Create: Detailed with calculation context](product-detailed-desktop.png)

</details>

<details>
<summary>Create: Detailed, narrow</summary>

![Product: Create: Detailed, narrow](product-detailed-narrow.png)

</details>

<details>
<summary>Read: saved composition</summary>

![Product: Read: saved composition](product-read-detailed.png)

</details>

<details>
<summary>Read: narrow</summary>

![Product: Read: narrow](product-read-narrow.png)

</details>

<details>
<summary>Edit: Detailed</summary>

![Product: Edit: Detailed](product-edit-detailed.png)

</details>

<details>
<summary>Edit: narrow</summary>

![Product: Edit: narrow](product-edit-narrow.png)

</details>

## Order

<details>
<summary>Create: Detailed stock</summary>

![Order: Create: Detailed stock](order-detailed-desktop.png)

</details>

<details>
<summary>Create: field layout</summary>

![Order: Create: field layout](order-fields-desktop.png)

</details>

<details>
<summary>Create: Detailed, narrow</summary>

![Order: Create: Detailed, narrow](order-detailed-narrow.png)

</details>

<details>
<summary>Read: current stock</summary>

![Order: Read: current stock](order-read-detailed.png)

</details>

<details>
<summary>Read: narrow</summary>

![Order: Read: narrow](order-read-narrow.png)

</details>

<details>
<summary>Edit: Detailed</summary>

![Order: Edit: Detailed](order-edit-detailed.png)

</details>

<details>
<summary>Edit: narrow</summary>

![Order: Edit: narrow](order-edit-narrow.png)

</details>
