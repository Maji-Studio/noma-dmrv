# Isometric 1,000-year biochar inorganic-carbon migration

Owner: Engineering

Status: Proposed
Last reviewed: 2026-08-13

## Executive summary

Isometric has deprecated the sampled `biochar_sequestration_1000_year` component in the project's sandbox component library and introduced `biochar_sequestration_1000_year_f_durable_max`. The replacement makes two material changes:

1. credited biochar carbon is organic carbon, calculated for each replicate as total carbon minus inorganic carbon; and
2. the calculated durable fraction is capped at 0.95.

This is primarily a Certify contract migration, not a database migration. Noma already captures and persists inorganic carbon on measurement samples. The current 1,000-year submission, readiness, preview, evidence, binding, and compatibility paths do not use that value, however, and they recognize only the deprecated three-input component.

The recommended implementation is to add first-class support for the replacement four-input component, require a measured inorganic-carbon value in every submitted 1,000-year replicate, retain read/reconciliation compatibility for historical removals using the deprecated key, and migrate the sandbox Removal template only after the code and contract tests are ready. Production submission should remain blocked until Isometric confirms that this replacement component is the governing component for this Protocol v1.1 project and resolves, or explicitly accepts, the formula difference described below.

## Authoritative Isometric delta

### Project and template observed

The supplied sandbox project was inspected on 2026-08-13. It is a draft project governed by Biochar Protocol v1.1, Biochar Storage in Agricultural Soils module v1.1, Standard v1.7, with a 1,000+ year durability tier. The existing Removal template still contains the component labelled **Biochar sequestration, 1000 year durability (DEPRECATED)**.

This observation does not establish an Isometric release date. The template's “Updated 29 Jul” label is template metadata, not a component-library release date.

### Deprecated component

- Display name: `Biochar sequestration, 1000 year durability (DEPRECATED)`
- Key: `biochar_sequestration_1000_year`
- Inputs:
  - `product_mass`: scalar mass
  - carbon content: list of total-carbon measurements
  - `s_fraction`: list of reflectance fractions above 2%
- Calculation:

```text
mean_carbon_content = mean(total_carbon_contents)
durable_fraction = mean(s_fraction)
  - sqrt(mean(s_fraction) * (1 - mean(s_fraction)) / num_samples)

stored_co2e = product_mass
  * mean_carbon_content
  * durable_fraction
  * co2e_of_carbon
```

The deprecated component has no inorganic-carbon input and does not cap the durable fraction.

### Replacement sampled component

- Display name: `Biochar sequestration, 1000 year durability`
- Key: `biochar_sequestration_1000_year_f_durable_max`
- Inputs:
  - `total_carbon_contents`: list of dry-basis mass fractions
  - `inorganic_carbon_contents`: list of dry-basis mass fractions
  - `s_fraction`: list of dimensionless reflectance fractions above 2%
  - `product_mass`: scalar mass
- Calculation observed in the live component preview:

```text
carbon_contents = total_carbon_contents - inorganic_carbon_contents
mean_carbon_content = mean(carbon_contents)

durable_fraction_calc = mean(s_fraction)
  - sqrt(mean(s_fraction) * (1 - mean(s_fraction)) / num_samples)

durable_fraction = min(durable_fraction_calc, 0.95)

stored_co2e = product_mass
  * mean_carbon_content
  * durable_fraction
  * co2e_of_carbon
```

The total-carbon, inorganic-carbon, and `s_fraction` lists must represent the same ordered set of sample replicates. Noma should enforce equal list lengths and deterministic ordering before submission.

Isometric also documents this replacement in its [Component Blueprint Library](https://docs.isometric.com/user-guides/certify/component-blueprint-library#biochar-sequestration-1000-year-durability). The live sandbox component was used for the contract details above because it is the actual component available to the supplied project.

An updated unsampled component, `biochar_sequestration_1000_year_unsampled`, is also present in the library. Method B/unsampled 1,000-year durability is deliberately unsupported in Noma and is outside this migration.

## Scientific and methodological rationale

Only organic carbon should be credited as stored biochar carbon. Carbonates and other inorganic carbon can be present in biochar, but their persistence and net climate effect are not equivalent to the aromatic organic-carbon fraction: carbonate formation can consume CO2, while carbonate dissolution or reaction can later release it. Subtracting inorganic carbon prevents the gross stored-carbon calculation from crediting both pools as though they had the same 1,000-year durability.

This is consistent with Isometric's published methodology:

- The project-governing [Biochar Storage in Agricultural Soils module v1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1) already defines organic carbon for atomic-ratio calculations by subtracting inorganic carbon from total carbon and requires at least three samples per production batch.
- The current [Biochar Storage in Soil Environments module v1.3](https://registry.isometric.com/module/biochar-storage-soil-environments/1.3) makes the treatment explicit in the storage calculation: biochar carbon content is total carbon minus inorganic carbon, only organic carbon is credited, and inorganic carbon is measured for every production batch with at least three samples.
- Module v1.3 lists ISO 16948, ASTM D4373, and DIN 51726 as accepted analytical methods for inorganic carbon. The laboratory method and report should be preserved as evidence rather than inferred by Noma.
- Fidel, Laird, and Parkin discuss the distinct carbonate-carbon pool and the possibility of early CO2 release in [Effect of Biochar on Soil Greenhouse Gas Emissions at the Laboratory and Field Scales](https://pubmed.ncbi.nlm.nih.gov/28724102/).

The 0.95 maximum also avoids representing the sampled material as completely durable when the reflectance estimate approaches one.

### Important governance discrepancy

The live replacement component is not a full implementation of the current v1.3 module's 1,000-year durability equation. Module v1.3 includes non-reactive carbon measured by thermogravimetric analysis and sample-standard-deviation uncertainty terms, whereas the observed component still uses the earlier binomial standard-error expression and does not accept a non-reactive-carbon input.

The project remains governed by Protocol/module v1.1, so Noma must not silently implement the v1.3 equation or change the pinned protocol version. The registry component should remain authoritative for the remote result, but Isometric should confirm in writing that `biochar_sequestration_1000_year_f_durable_max` is the intended replacement for this v1.1 project despite this divergence.

## Noma status quo

### What already exists

No schema migration is expected:

- `src/db/schema/production.ts` already stores nullable `inorganicCarbonPercent` on measurement samples.
- `src/components/samples/sample-form.tsx` already exposes inorganic carbon.
- The sample Zod schema and reconciliation rules already prevent organic plus inorganic carbon from exceeding total carbon beyond the configured tolerance.
- Existing CRUD and data-access paths already persist the value.
- `src/lib/isometric/utils/durability-aggregation.ts` already aggregates inorganic carbon for another durability path.

The existing aggregation helper can derive inorganic carbon as `max(0, total - organic)` when the measured inorganic value is absent. That fallback should not be used for 1,000-year credit submission without explicit Isometric approval: the published current methodology says inorganic carbon is analyzed and organic carbon is calculated from total minus inorganic, not the reverse.

### What is incompatible today

| Area | Current behavior | Required change |
| --- | --- | --- |
| Component contract | `src/lib/isometric/transformers/measurement-sample.ts` hard-codes `biochar_sequestration_1000_year` and emits total carbon, `s_fraction`, and mass only. | Support the new key and emit measured dry-basis inorganic carbon as a fourth input. |
| Input binding | `src/lib/isometric/transformers/sequestration-binding.ts` binds only the deprecated component's three inputs. | Add an exact binding for `total_carbon_contents`, `inorganic_carbon_contents`, `s_fraction`, and `product_mass`. |
| Template compatibility | `src/fn/certification/removal-submission-build.ts` accepts only the deprecated 1,000-year key. | Recognize the replacement key; retain explicit historical handling for the old key. |
| Replicate readiness | `src/fn/certification/durability-measurement-samples.ts` treats total carbon plus `sFraction` as a complete replicate. | Require total carbon, measured inorganic carbon, and `sFraction` on every included replicate. |
| Measurement property | The 1000-year builder has no inorganic-carbon property. A separate patch map associates `inorganic_carbon_contents` with the 200-year `mass_fraction/total_inorganic_carbon` property. | Sandbox-verify and use the expected 1,000-year dry-basis property, likely `mass_fraction_dry_basis/total_inorganic_carbon`, with dimensionless values. Do not reuse the 200-year property blindly. |
| Source targets | `src/lib/certification/removal-source-bindings.ts` defines `carbon_contents`, `product_mass`, and `s_fraction`. | Replace the active target set with total carbon, inorganic carbon, mass, and `s_fraction`; preserve historical interpretation. |
| Local preview | `src/lib/calculations/biochar-removal.ts` averages total carbon, omits inorganic carbon, and explicitly reports no cap. | Calculate organic carbon per replicate, apply the 0.95 cap, and expose both raw and capped durability. |
| Credit-batch accounting | `src/data-access/credit-batch-accounting.ts` extracts only total carbon and `s_fraction`; missing inorganic carbon does not block readiness. | Include inorganic carbon in extraction and readiness, and use the replacement formula for estimates. |
| Evidence | `src/lib/certification/evidence-ledger/durability-1000-build-model.ts`, `durability-1000-pdf.ts`, and `durability-types.ts` show total carbon and R0 fraction only. | Show total, inorganic, credited organic carbon, `s_fraction`, product mass, and the 0.95 cap. |
| Certify field status | `src/lib/certification/certify-field-registry.ts` does not mark inorganic carbon as required for this submission path. | Mark it required when the facility's active durability tier is sampled 1,000-year. |
| Fixtures and tests | Approximately 42 occurrences across 19 files refer to the deprecated key or three-input shape. | Update active fixtures and add explicit legacy-contract cases rather than doing an unqualified string replacement. |

### Existing controls to preserve

- Durability tier is facility-scoped, and one default Removal template is selected per facility.
- Sampled 1,000-year submission is sandbox-only behind `DURABILITY_MEASUREMENT_SAMPLES_ENABLED`; production remains hard-blocked.
- Noma submits raw measurements and treats the registry-computed durable fraction and stored amount as authoritative.
- `docs/isometric/versions.json` pins this project to Protocol v1.1, Agricultural Soils module v1.1, and Standard v1.7. This component migration is not a protocol-version upgrade.

## Proposed implementation plan

### Phase 0 — Confirm the governing contract

1. Ask Isometric to confirm that `biochar_sequestration_1000_year_f_durable_max` supersedes the deprecated component for this specific Protocol v1.1 project.
2. Ask whether every inorganic-carbon input must be a directly measured result, and confirm the accepted methods for this project version.
3. In sandbox, confirm the exact measurement property key, unit, source shape, and ordering requirements for `inorganic_carbon_contents`. The working expectation is `mass_fraction_dry_basis/total_inorganic_carbon` with unit `dimensionless`.
4. Record Isometric's position on the live-component/current-v1.3 durability-formula discrepancy. Do not add non-reactive carbon to the wire contract unless the component itself changes.

Exit criterion: the component key and all four input contracts are documented from the sandbox API/UI or written Isometric confirmation.

### Phase 1 — Add a versioned component contract

1. Introduce separately named constants for the deprecated sampled key and current sampled key.
2. Add the replacement binding with its exact four inputs and measurement properties.
3. Keep the deprecated key readable for historical remote removals and reconciliation, but do not let ambiguous matching select it for a newly configured template.
4. Continue rejecting the unsampled component with a clear reason.
5. Increment the submission mapping revision or semantic contract version so changed payloads cannot be mistaken for equivalent previous builds.

Exit criterion: template inspection unambiguously classifies current, deprecated, and unsupported 1,000-year components.

### Phase 2 — Make inorganic carbon a readiness requirement

1. Extend the 1,000-year replicate type to contain total carbon, measured inorganic carbon, and `sFraction` from the same measurement sample.
2. Require at least three complete eligible replicates, preserving the existing project rule.
3. Fail closed when any selected replicate lacks inorganic carbon; provide an actionable UI message naming the missing measurement rather than silently dropping or deriving it.
4. Validate that inorganic carbon is non-negative and does not exceed total carbon, using the existing tolerance policy where appropriate.
5. Mark inorganic carbon as Certify-required only for the sampled 1,000-year path so other durability tiers are not accidentally blocked.

Exit criterion: an incomplete tuple cannot reach payload construction, local credit estimation, or review readiness.

### Phase 3 — Build the four-input payload

1. Sort eligible replicates deterministically using the existing stable ordering.
2. Emit paired `total_carbon_contents`, `inorganic_carbon_contents`, and `s_fraction` lists from that same ordered array.
3. Emit `product_mass` unchanged.
4. Assert equal non-zero list lengths and at least three entries immediately before serialization.
5. Update source binding targets, source metadata, payload hashes, and supersession logic to include inorganic carbon.
6. Preserve the submitted laboratory report/evidence link for each inorganic-carbon result.

Exit criterion: the built payload exactly matches the replacement component contract and any change to an inorganic-carbon result changes the semantic payload identity.

### Phase 4 — Align preview and evidence

1. Calculate `organic = total - inorganic` for each replicate, then calculate the mean organic-carbon fraction.
2. Reproduce the live component's binomial lower estimate from mean `s_fraction` and replicate count.
3. Calculate `durable = min(raw_durable, 0.95)` and use that value in the local stored-CO2e estimate.
4. Show the raw durability estimate, whether the cap was applied, and the capped value; do not imply the local estimate is authoritative.
5. Extend the evidence ledger and PDF with replicate-level total carbon, inorganic carbon, calculated organic carbon, `s_fraction`, product mass, formula version, and cap.
6. Label historical evidence produced under the deprecated component so its total-carbon basis is not confused with the new organic-carbon basis.

Exit criterion: local review values explain the remote calculation input by input and match the registry preview within the existing numerical tolerance.

### Phase 5 — Migrate the sandbox template

This phase is an external write and needs explicit user authorization.

1. After the application supports the replacement key, create or re-author a sandbox Removal template using the replacement component; do not delete the historical template.
2. Review all component bindings and select the new template as the facility default.
3. Build and review one representative Removal with three or more complete replicates.
4. Submit it in sandbox and verify the four remote inputs, measurement sources, units, ordered values, cap behavior, and remote output.
5. Exercise edit/supersession and reconciliation so changed inorganic carbon produces the intended new remote state.

Exit criterion: one end-to-end sandbox Removal reconciles successfully and its registry result matches Noma's explainable preview.

### Phase 6 — Rollout and documentation

1. Warn or block new submissions through a template that still contains the deprecated key, while retaining read support for historical removals.
2. Keep the production feature flag blocked until Isometric has signed off and sandbox evidence is captured.
3. Amend ADR 0013 to record the new carbon basis and cap while preserving the decision that the registry computes the authoritative durable fraction.
4. Update Isometric change tracking and open questions with the observed component contract and Isometric's responses.
5. Record the component observation without changing the pinned Protocol/module versions.

Exit criterion: the active template uses the replacement key, deprecated use is visible and controlled, and production enablement is a separate explicit decision.

## Verification plan

### Contract and unit tests

- Replacement-key detection succeeds; deprecated-key detection remains explicit; unsampled remains blocked.
- Binding validation requires exactly the four expected inputs and rejects wrong input shapes or measurement properties.
- The payload contains dry-basis total and inorganic carbon values, paired in deterministic replicate order.
- Missing inorganic carbon, unequal list lengths, fewer than three complete replicates, and inorganic carbon above total carbon all fail before submission.
- Changing only inorganic carbon changes the payload hash/source identity and triggers the correct supersession behavior.

### Calculation tests

- Organic carbon is calculated per replicate as total minus inorganic before averaging.
- Zero inorganic carbon preserves the total-carbon mean.
- The durable fraction is uncapped below 0.95 and capped exactly at 0.95 above it.
- Stored CO2e uses mean organic carbon, capped durability, product mass, and the carbon-to-CO2 conversion factor.
- Boundary and rounding cases match the registry preview tolerance.

### Readiness and evidence tests

- Credit-batch readiness and submission readiness report the same missing inorganic-carbon records.
- Existing non-1,000-year paths are unaffected.
- Evidence ledger and PDF include total, inorganic, derived organic carbon, raw/capped durability, and component key.
- Historical removals using the deprecated key remain renderable and are clearly labelled.

### Sandbox acceptance test

- Inspect the replacement component immediately before testing to catch contract drift.
- Submit one Removal with at least three complete replicates.
- Compare every submitted list value and measurement source with the corresponding Noma record.
- Compare Noma's preview to the registry's durable fraction and stored-CO2e output.
- Patch one inorganic-carbon result, rebuild/supersede, and confirm reconciliation.
- Capture the component key, protocol versions, request/response evidence, and observation date without PII.

## Non-goals

- Upgrading the project from Protocol/module v1.1 to v1.3.
- Implementing the current v1.3 non-reactive-carbon/TGA durability equation unless Isometric changes the governing component.
- Supporting the unsampled/Method B 1,000-year component.
- Backfilling missing inorganic-carbon measurements by inference.
- Adding a database column or migration for inorganic carbon.
- Mutating or deleting the supplied sandbox template during research.
- Enabling production 1,000-year submissions as part of this migration.

## Decisions

1. The registry component calculation remains authoritative; Noma's calculation is an explainable preview and validation aid.
2. The replacement component is treated as a new wire contract, not an in-place rename.
3. Directly measured inorganic carbon is required for each submitted 1,000-year replicate unless Isometric explicitly approves a fallback.
4. Total, inorganic, and `s_fraction` values are submitted as paired, equally sized lists from one deterministic replicate set.
5. Historical support for `biochar_sequestration_1000_year` is retained, but new configuration should prefer and eventually require `biochar_sequestration_1000_year_f_durable_max`.
6. No protocol-version pin changes until the project itself is formally upgraded.

## Open questions for Isometric

1. Is `biochar_sequestration_1000_year_f_durable_max` formally the required replacement for this project while it remains on Biochar Protocol/module v1.1?
2. What is the exact measurement property key and unit expected for `inorganic_carbon_contents` in this component?
3. Must every value be a directly measured inorganic-carbon result, and which analytical methods are accepted for this v1.1 project?
4. Should total carbon and inorganic carbon be paired by index from the same physical replicate, or does the component intentionally subtract independently ordered lists before averaging?
5. Why does the live replacement component retain the binomial uncertainty expression and omit non-reactive carbon when the published current v1.3 module uses sample standard deviations and TGA-derived non-reactive carbon?
6. Is the 0.95 cap intended to apply to this v1.1 project's submitted removals, including batches measured before the component replacement?
7. Will Isometric migrate existing templates/removals, or must suppliers create a new template and preserve the deprecated template for history?

## Primary references

- [Supplied Isometric sandbox Removal template](https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/operations-template/rvt_1KS4S43VPSBXA26X)
- [Biochar Protocol v1.1](https://registry.isometric.com/protocol/biochar/1.1)
- [Biochar Storage in Agricultural Soils module v1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1)
- [Current Biochar Protocol v1.3](https://registry.isometric.com/protocol/biochar/1.3)
- [Current Biochar Storage in Soil Environments module v1.3](https://registry.isometric.com/module/biochar-storage-soil-environments/1.3)
- [Isometric Component Blueprint Library](https://docs.isometric.com/user-guides/certify/component-blueprint-library#biochar-sequestration-1000-year-durability)
- [Isometric protocol versioning policy](https://docs.isometric.com/user-guides/registry/protocol-versioning)
- [Fidel, Laird, and Parkin (2017), PubMed record](https://pubmed.ncbi.nlm.nih.gov/28724102/)
