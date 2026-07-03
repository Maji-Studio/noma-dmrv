# noma submits raw durability inputs; the registry computes the durable fraction

Status: accepted (2026-06-18); amended 2026-07-03 (issue #142)

> **Amendment (2026-07-03, issue #142):** the "Scope is 200-year" deferral below is
> partly lifted — `computeFDurable1000` (Eq.4–6, bounded `min(0.95, max(0, …))`) now
> exists in `src/lib/calculations/biochar-removal.ts` as a **local preview engine**,
> the same role `computeFDurable200` plays for the 200-year path, wired into
> `buildCo2eStoredPreview` off the batch's stored petrography/TGA columns
> (`meanRandomReflectancePercent`, `stdRandomReflectance`,
> `meanNonReactiveCarbonPercent`, `stdNonReactiveCarbonPercent`). This does **not**
> change the decision below: the registry still computes the authoritative
> `F_durable` server-side, and no 1000-year submission path exists yet — Eq.6's
> R₀-term normalization is internally inconsistent in the module text, and the
> chosen normalization is a local judgment call pending Isometric confirmation
> (tracked in `docs/open-questions.md`, "Eq.6 R₀-term semantics"). Preview only;
> no migration, UI, or Certify-mapping changes shipped with this amendment.

A biochar removal's 200-year durable fraction `F_durable,200` (Eq.3 of the
`biochar-storage-soil-environments` 1.2 module) is a function of the molar **H/C_org
ratio** and the **soil temperature** at the application site. noma already computes it
locally — `computeFDurable200` in `src/lib/calculations/biochar-removal.ts` — but the
submission to Isometric's `co2-stored / carbon_rich_substance_sequestration` component
sends only `carbon_content` + `product_mass` (`src/lib/isometric/transformers/datapoint.ts`).
The registry therefore **cannot reproduce or verify** the durable fraction; it can only
trust whatever discounted figure our mass × carbon implies. That is an over-credit /
audit-defeating posture and the gap this decision closes.

**Decision:** noma submits the **raw monitored inputs** — organic carbon, product mass,
**H/C_org**, and **soil temperature** — and Isometric runs Eq.1 + Eq.3 **server-side**. The
durable fraction is **registry-derived, not noma-asserted**. noma's local
`computeFDurable200` stays a **preview engine** for drift control (the per-application
figure, the credit-batch total, and the submitted value all flow through it), never the
source of the credited number.

This is the same boundary ADR 0005 drew for amortization (Isometric owns the crediting
math; noma is the LCA journal, not the publisher) and complements ADR 0003 (removal as the
submission unit). noma submits the **sample-derived H/C_org as a list of per-production-batch
datapoints** (each the batch's ≥3-replicate mean + std-dev) and the registry aggregates them
(see Consequences); it does **not** pre-collapse to a single mass-weighted scalar. The local
`weightedHToCorgRatio` is retained only as the **preview/reconciliation input**, not the
submitted value, and the operator-declared `credit_batches.h_to_c_org_ratio` is reconciled
against it with a divergence warning.

## Considered options

- **noma sends a pre-discounted `CO₂e_stored` figure** (apply `F_durable` locally, submit
  the net) — rejected: the registry can't audit a number it didn't derive, reproducibility
  breaks, and it re-creates the over-credit risk this decision exists to remove. Directly
  contradicts ADR 0005.
- **noma submits `F_durable` as a precomputed scalar** alongside carbon + mass — rejected:
  still asks the registry to trust our coefficient and temperature handling rather than
  recompute, and goes silently stale against a protocol coefficient bump (a 1.x update to
  Eq.3's `a/b/c` would leave our scalar diverging from the registry's own math).
- **Submit raw inputs; registry computes** — chosen.

## Consequences

> **A0 resolution (2026-06-18) corrected the mechanism.** The durability inputs are **not**
> inputs on `carbon_rich_substance_sequestration` (carbon + mass only) and are **not** wired
> via `INPUT_MAPPING`. They feed the registry's **dedicated biochar blueprints**
> `biochar_sequestration_200_year_c_org` (sampled) / `biochar_sequestration_200_year_unsampled`
> (Method B) through **datapoints surfaced as measurement samples**. See the plan §4 for the
> verbatim blueprint inputs and keys. The production Certify template must be **re-authored**
> off `carbon_rich_substance_sequestration` onto these biochar blueprints (author both;
> `_c_org` = lab-sampled batch, `_unsampled` = Method-B batch estimated from sampled history).

- **Submission path:** per-production-batch H/C_org goes via a `biochar_production_batch`
  measurement sample (property `hydrogen_to_organic_carbon_ratio`); project-area soil
  temperature via a `biochar_soil` measurement sample (`temperature`). Both resolve to
  datapoints that the `biochar_sequestration_200_year_*` blueprint consumes. noma's generated
  types + `MeasurementProperty` encoder already support this (no type regen); a
  measurement-samples submission module is net-new (mirror `sensors.ts`).
- **Aggregation is registry-side.** Submit the **list** of per-batch H/C datapoints (each with
  its std-dev from ≥3 replicates); the registry takes the mean (`_c_org`) or Winsorized
  mean + standard error (`_unsampled`). noma does **not** pre-collapse to a mass-weighted
  scalar; `weightedHToCorgRatio` is retained only as the local preview input.
- **Blueprint selection is the Method A/B distinction** at submission (D6): sampled →
  `_c_org`, Method B unsampled → `_unsampled`.
- **Soil temperature** is a project-area annual average (7 °C floor; subdivide if intra-area
  variation > 1 °C). noma submits a **facility-level reference value** sourced from a global
  soil-temperature database (Lembrechts et al. 2022 or equivalent — the protocol's sanctioned
  path when no on-site baselining exists; air temperature is explicitly prohibited as a proxy),
  justified in the **PDD** (registry-side, not an API field — which is why the conservative-
  estimate method string needs no home on `CreateMeasurementSampleRequest`). The per-application
  `soil_temperature_c` becomes a future per-removal override / reconciliation, not the submitted
  value. Re-verified against module `biochar-storage-soil-environments` 1.2 §5.1.1.3.1 (2026-06-19).
- A protocol coefficient bump (Eq.3 `a/b/c`) becomes a registry-side concern for the credited
  number; noma's local `computeFDurable200` updates only to keep the preview in parity.
- Scope is **200-year**. 1000-year durability (Eq.4–6, random reflectance R₀ + non-reactive
  carbon — surfaced as `biochar_production_batch` inertinite/semi-inertinite/poorly-carbonized
  fractions) is deferred — its inputs are captured but unrouted.
