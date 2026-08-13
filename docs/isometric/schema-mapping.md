# Isometric Requirement-to-Implementation Mapping

> **Non-authoritative.** Status is verified against the current repository and
> the pinned sources in [`versions.json`](./versions.json). `Implemented` means
> the cited code path exists; it does not imply Isometric or verifier approval.

| Area | Current implementation evidence | Status | Remaining gap |
|---|---|---|---|
| Feedstock EC1-EC15 assessment | Ambient feedstock attributes in `src/db/schema/feedstock.ts` | missing | No criterion catalog or per-period assessment store; `feedstock_sc_assessments` was removed |
| Ineligible biomass mass accounting | Read-time lineage and roll-ups in `src/data-access/credit-batch-accounting.ts`; eligibility flags on feedstocks | partial | No Reporting-Period issuance gate for the >25% rule |
| Counterfactual storage | Counterfactual category and quantity inputs in `src/db/schema/feedstock.ts` | partial | No dated assessment, expiry, sourcing-change invalidation, or EC14 wildfire lifecycle |
| Market leakage | Method/result fields on feedstocks | partial | v1.2 EC combination evidence and replacement-emissions structure are missing |
| Production-process sampling | `production_processes` epoch/prerequisites, immutable `credit_batches.sampling`, Method-B checks in current credit-batch paths | partial | Sampled path exists; unsampled registry representation remains sandbox-only/unconfirmed |
| Credit-batch accounting | `src/data-access/credit-batch-accounting.ts` | implemented | This is the canonical lineage, roll-up, and stored-CO2e preview module; do not reintroduce summary columns |
| Reactor diagram and gas-loss controls | Reactor specifications; `sensor_data` and calibration-certificate documents (the original readings CSV is retained unchanged) | partial | noma does not inspect or normalize the CSV's pressure values; no explicit diagram version approval or annual calibration/leak-test event model |
| Lost/spilled mass | Incident reports and current mass-accounting code | missing | No incident-to-batch/application deduction ledger |
| Agricultural-soil chemistry | H/C, O/C, moisture, ash, metals, PAH, PCB, dioxin/furan fields in `src/db/schema/production.ts` | partial | H/C and O/C submission gates exist; the full v1.1 Table 2/WBC panel, lab accreditation, analytical method, and cadence are not fully gated; volatile matter and fixed carbon exist only on `production_samples`, not on the certification `samples` grain that feeds submission |
| 200-year durability submission | Builders and aggregation exist in `src/lib/isometric/transformers/measurement-sample.ts` | partial | H/C unit and explicit component-input binding are unconfirmed; submission fails closed |
| 1,000-year durability submission | `src/fn/certification/durability-measurement-samples.ts`, `src/lib/isometric/transformers/sequestration-binding.ts`, current preview/evidence builders, and tests | code-implemented, externally pending | Each local Sample builds one remote `MeasurementSample` with its stable identity, sampling instant, and paired total/inorganic carbon plus `s_fraction`; three response IDs feed each list input. Product mass is one standalone direct kg Datapoint. The current component remains `biochar_sequestration_1000_year_f_durable_max`; registry authority is preserved. Production is blocked, and fresh sandbox verification of the corrected grain, template migration, and Isometric confirmation remain outstanding |
| Stockpiling | `stockpile_events` in `src/db/schema/compliance.ts`, including the >12-month exception check | schema-implemented | No operator CRUD/alert workflow or submission/readiness integration |
| Application evidence | Application documents and GIS/logbook classifications | informational | Application evidence never blocks certification or Removal submission and raises no checks; uploads are retained for verifier follow-up. The pinned Biochar Protocol v1.1 places project-boundary evidence in the PDD and has no per-application boundary-logbook gate |
| Applied-mass scale evidence | Application/delivery mass and document references | partial | No legal-for-trade scale certification/attestation model |
| Custody handoffs | Chain-of-Custody trail reconstructed from domain lineage and evidence | missing | `custody_handoffs` does not exist; there is no canonical handoff ledger |
| Low-carbon procurement | `power_procurement_evidence` in `src/db/schema/compliance.ts` | schema-implemented | No conjunctive EC1-EC5 evaluator, annual intensity roll-up, or claim gate |
| Electricity/fuel metering | Run-level electricity and three diesel input fields in `src/db/schema/production.ts`; original readings CSV retained as `sensor_data` documents | partial | No queryable hourly electricity meter stream or complete meter/fuel evidence metadata |
| Registry energy mapping | `src/lib/isometric/transformers/datapoint.ts` and `src/lib/isometric/utils/aggregation.ts` | implemented | Electricity is one grid component; diesel uses separate `Generator diesel usage` and `Startup diesel usage` components. Display-name mapping remains an operational coupling |
| Transportation | Leg method, trip type, distance, mass, factor, and evidence references in `src/db/schema/logistics.ts` | partial | Fallback justification, per-record-type evidence gates, onward-trip proof, vehicle year/class, factor source/vintage remain open |
| BCU accounting | None | missing | No BCU schema, retirement, ownership, cap, additionality, or anti-double-count structures |
| Embodied inventory | Generic documents only | missing | No item/material/equipment inventory or complete factor records |
| GHG/SSR materiality assessment | None | missing | `ghg_materiality_assessments` does not exist; no issuance gate |
| Co-product allocation | None | missing | Add a no-co-products applicability record or an allocation model |
| Reversal risk | `credit_batches.buffer_pool_percent` | partial | Questionnaire, score history, derivation, and reassessment schedule are missing |
| Removal Sources | `src/lib/certification/removal-source-bindings.ts` and post-submit verification in `src/lib/isometric/source-binding-verification.ts` | implemented | Sources bind to exact inputs, including generated transport/durability ledgers and the safety-margin mass target |
| Safety margin | Named `Safety margin` mapping in `src/lib/isometric/transformers/datapoint.ts` | implemented | noma submits removal dry mass only; the fixed carbon intensity and its justification remain registry-owned |
| GHG Statement report | `certifier_ghg_statement_reports`, `src/fn/certification/ghg-statement-reports.ts` | implemented | Generated data summary is immutable after preparation/approval; external report URL remains supported for project-specific qualitative reports |
| Reporting window | `src/fn/certification/removal-reporting-window.ts` | partial | End is latest application date; start still uses earliest production start instead of earliest feedstock sourcing |
