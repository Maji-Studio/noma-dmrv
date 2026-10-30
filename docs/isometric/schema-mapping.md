# Isometric Requirement-to-Implementation Mapping

Read this for implementation coverage and remaining gaps. Code checked on
2026-10-30; pinned-source interpretations retain
historical provenance in [versions.json](./versions.json) and the
[requirements shortlist](./requirements-shortlist.md). Direct read probes and public-source checks are scoped in the
[verification record](../archive/2026-10-30-isometric-verification.md).
Implemented code does not imply verifier approval.

## Policy boundaries

`src/lib/certifier-policy/isometric.ts` owns Isometric-specific unsampled-batch
eligibility and period rules. The one-calendar-month cap is a conservative noma
choice, not a newly claimed pinned-protocol requirement. It applies to Isometric
batches and is enforced by schema, shared validation and submission checks.
Linking a facility refuses incompatible active batches and stamps active
null-certifier batches atomically. See
[ADR 0016](../adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md).
When changing ownership of a rule, align all callers and DB backstops, and cover
both Isometric and provider-null paths.

| Area | Current implementation evidence | Status | Remaining gap |
|---|---|---|---|
| Feedstock EC1-EC15 assessment | Evidence maintained outside noma (#942 q8) | external | No local criterion assessment store or eligibility gate |
| Feedstock eligibility evidence | Maintained outside noma (#942 q8) | external | No intake eligibility flag or ineligible-mass exit; BFA Appendix 3 sourcing recommendations are not a general 25% cap |
| Counterfactual storage | Evidence maintained outside noma (#942 q8) | external | No delivery-level category, quantity or baseline columns |
| Market leakage | Evidence maintained outside noma (#942 q8) | external | No delivery-level method or result columns |
| Production-process sampling | `production_processes` epoch/prerequisites, immutable `credit_batches.sampling`, Method-B checks in current credit-batch paths | partial | Sampled path exists; unsampled registry representation remains sandbox-only/unconfirmed |
| Credit-batch accounting | `src/data-access/credit-batch-accounting.ts` | implemented | This is the canonical lineage, roll-up, and stored-CO2e preview module; do not reintroduce summary columns |
| Reactor diagram and gas-loss controls | Reactor specifications and calibration-certificate documents; the [Readings file (`sensor_data`)](./requirements-shortlist.md#project-reactor-monitoring) is retained unchanged on the production run | partial | Readiness gates Readings file presence only, independent of parsed readings; noma does not check its contents; no explicit diagram version approval or annual calibration/leak-test event model. Temperature-equipment calibration records (§9.2.4.1) can be retained as generic `calibration_certificate` documents (`src/db/schema/documentation.ts`); noma does not track equipment-specific calibration schedules or validity |
| Lost/spilled mass | Incident reports and current mass-accounting code | missing | No incident-to-batch/application deduction ledger |
| Agricultural-soil chemistry | H/C, O/C, moisture and ash fields in `src/db/schema/production.ts`; validation contaminant results are maintained outside noma | partial | H/C and O/C submission gates exist; Sample moisture is readiness-gated on sampled credit batches and retained as evidence only, with no moisture measurement submitted (Kenji, 2026-10-15; [decision and sources](./changes.md#2026-10-15-sample-moisture-retained-as-evidence-only-942-q1)); noma computes and submits dry biochar mass; validation-level characterization and contaminant compliance are managed outside noma; lab accreditation, analytical method, and cadence are not fully gated; volatile matter and fixed carbon exist only on `production_samples`, not on the certification `samples` grain that feeds submission |
| 200-year durability submission | Builders and aggregation exist in `src/lib/isometric/transformers/measurement-sample.ts` | partial | H/C unit and explicit component-input binding are unconfirmed; submission fails closed |
| 1,000-year durability submission | `src/fn/certification/durability-measurement-samples.ts`, the measurement-sample bindings in `src/lib/isometric/semantic-binding-catalog.ts` (wired by `src/lib/isometric/transformers/sequestration-binding.ts`), current preview/evidence builders, and tests | code-implemented, externally pending | Each local Sample builds one remote `MeasurementSample` with its stable identity, sampling instant, and paired total/inorganic carbon plus `s_fraction`; three response IDs feed each list input. Product mass is one standalone direct kg Datapoint. The current component remains `biochar_sequestration_1000_year_f_durable_max`; registry authority is preserved. Production is blocked, and fresh sandbox verification of the corrected grain, template migration, and Isometric confirmation remain outstanding |
| Legacy stockpiling check | `stockpile_events` in `src/db/schema/compliance.ts`, including the >12-month exception check | legacy DB check only | Not a requirement of pinned Biochar v1.1.1 or Agricultural Soils v1.1.0; no protocol compliance gap is implied |
| Application evidence | Application documents and GIS/logbook classifications | informational | Application evidence never blocks certification or Removal submission and raises no checks; uploads are retained for verifier follow-up. The pinned Biochar Protocol v1.1 places project-boundary evidence in the PDD and has no per-application boundary-logbook gate |
| Applied-mass scale evidence | Application/delivery mass and document references | partial | No legal-for-trade scale certification/attestation model |
| Custody handoffs | Chain-of-Custody trail reconstructed from domain lineage and evidence | missing | `custody_handoffs` does not exist; there is no canonical handoff ledger |
| Low-carbon procurement | `power_procurement_evidence` in `src/db/schema/compliance.ts` | schema-implemented | No conjunctive EC1-EC5 evaluator, annual intensity roll-up, or claim gate |
| Electricity/fuel metering | Run-level electricity and three diesel input fields in `src/db/schema/production.ts`; Readings file retained unchanged | partial | No queryable hourly electricity meter stream or complete meter/fuel evidence metadata |
| Registry energy mapping | `src/lib/isometric/semantic-binding-catalog.ts` and `src/lib/isometric/utils/aggregation.ts` | implemented | Reviewed component-ID contracts select electricity and separate generator/preprocessing versus startup diesel quantities; display names have no binding authority. See ADR 0032 |
| Transportation | Leg method, one-way distance (counted as a round trip), mass, vehicle type/model year, and evidence references in `src/db/schema/logistics.ts` | partial | Vehicle type/model year stay in the evidence ledger; mixed values are advisory. The factor is a fixed template input. Fleet coverage by the factor and its Source remains open, as do scale and transport-record completeness checks. Each Delivery already needs uploaded proof before submission. Distance-method fallback justification lives in the PDD, outside noma |
| BCU accounting | None | missing | No BCU schema, retirement, ownership, cap, additionality, or anti-double-count structures |
| Embodied inventory | Generic documents only | missing | No item/material/equipment inventory or complete factor records |
| GHG/SSR materiality assessment | None | missing | `ghg_materiality_assessments` does not exist; no issuance gate |
| Co-product allocation | None | missing | Add a no-co-products applicability record or an allocation model |
| Reversal risk | Registry risk score and buffer contribution; displayed by `src/components/certification/registry-carbon-result-card.tsx:RegistryCarbonResultCard` | registry-owned | Noma has no batch-level buffer input |
| Removal Sources | Evidence targets on `src/lib/isometric/semantic-binding-catalog.ts` roles, classified by `src/lib/certification/removal-source-bindings.ts`, and post-submit verification in `src/lib/isometric/source-binding-verification.ts` | implemented | Sources bind to exact inputs, including generated transport/durability ledgers and the safety-margin mass target |
| Safety margin | Reviewed automatic-source contract and `src/lib/isometric/semantic-binding-catalog.ts` | implemented | noma submits removal dry mass only; the fixed carbon intensity and its justification remain registry-owned |
| GHG Statement report | `certifier_ghg_statement_reports`, `src/fn/certification/ghg-statement-reports.ts` | implemented | Generated data summary is immutable after preparation/approval; external report URL remains supported for project-specific qualitative reports |
| Reporting window | `src/fn/certification/removal-reporting-window.ts` | partial | End is latest application date; start still uses earliest production start instead of earliest feedstock sourcing |
