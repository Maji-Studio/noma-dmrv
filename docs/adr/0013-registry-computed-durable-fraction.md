# noma submits raw durability inputs; the registry computes the durable fraction

> **Current status: Accepted; partially implemented** (reviewed 2026-07-29).
> The governing boundary is implemented: noma submits raw durability inputs and
> does not submit an authoritative durable fraction. The sampled 1,000-year
> component/input path is implemented and sandbox-verified in
> `durability-measurement-samples.ts` and `sequestration-binding.ts`.
> Production remains blocked. The 200-year H/C unit and explicit binding remain
> unconfirmed and fail closed. Historical statements below that “no 1000-year
> submission path exists” describe the pre-2026-07-10 state and are
> superseded by this metadata and the later amendments.

## Amendment (2026-08-13) — replacement sampled 1,000-year component

The sampled 1,000-year executable contract is now
`biochar_sequestration_1000_year_f_durable_max`. For each paired replicate it
consumes total carbon, directly measured inorganic carbon, and `s_fraction`,
plus batch product mass. The component calculates organic carbon within each
replicate as `total - inorganic`, then averages those organic-carbon values. It
calculates raw durability as
`mean(s) - sqrt(mean(s) * (1 - mean(s)) / n)` and uses
`min(raw durability, 0.95)` for stored CO2e.

`biochar_sequestration_1000_year` is deprecated. Historical evidence and
Removal displays retain it as an explicit legacy identity with total-carbon,
uncapped semantics, but new template configuration and submission compilation
reject it. Missing inorganic carbon is never inferred from total minus reported
organic carbon on the replacement path.

This amendment preserves the ADR's governing boundary: noma submits raw
measurements, and Isometric remains authoritative for the credited durable
fraction and stored amount. noma's matching calculation and evidence PDF are
explanatory review aids. Sampled production submission remains blocked;
unsampled Method B remains unsupported. The Protocol v1.1, Agricultural Soils
module v1.1, and Standard v1.7 pins are unchanged. Written Isometric
confirmation and migration of the sandbox template to the replacement component
remain outstanding external work.

Each independently analysed noma Sample is now represented by its own Isometric
`MeasurementSample`. Its versioned supplier reference includes the stable local
Sample ID, `measured_at` is the local sampling instant, and its body contains
only that Sample's paired total carbon, inorganic carbon, and `s_fraction`.
The registry still receives three ordered Datapoint IDs for each replicate
list. Batch product mass is submitted once as a standalone direct `REPORTED`
Datapoint in kg, with its existing Sources, rather than being presented as a
property of a physical Sample. Partial retries reconcile each Sample reference
independently. Fresh sandbox validation of this corrected grain remains
outstanding; this amendment does not authorize production submission.

Historical status: accepted (2026-06-18); amended 2026-07-03 (issue #142)

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

## Historical amendment (2026-07-04, ADR 0021) — the former live 1000-year blueprint ≠ module Eq.6

Authoritative research (Isometric MCP, 2026-07-04) found that the **live Certify blueprint**
`biochar_sequestration_1000_year` and **module Eq.6** disagree, and **the blueprint is what
runs**. The blueprint takes three inputs — `carbon_contents` (per-replicate LIST, total carbon
dry basis), `product_mass` (SCALAR kg), `s_fraction` (per-replicate LIST = each sample's
proportion of R₀ readings ≥ 2%) — and computes
`product_mass × mean(carbon_contents) × durable_fraction × 3.667`, where
`durable_fraction = mean(s_fraction) − √(mean·(1−mean)/n)` (binomial SE). It has **no
non-reactive-carbon factor and no 0.95 cap** (both present in Eq.6), and uses **binomial SE**
not std-dev. This is fully consistent with this ADR's principle — **the registry owns the
durable-fraction computation**; noma submits only the per-replicate inputs and never a
pre-reduced mean. The live 1000-year path (`build1000YearSequestrationSample`, ADR 0021) is
therefore built to the **blueprint**, while `computeFDurable1000` (Eq.6) stays a local
**preview**. Which of the two governs verification credit is an open Isometric sign-off
(`open-questions.md` `certification/fdurable-1000-r0-semantics`).

This section records the deprecated component observed in July 2026. The
2026-08-13 amendment above supersedes it for current template authoring and
local explanatory calculations.
