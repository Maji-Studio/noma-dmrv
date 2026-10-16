# Isometric Requirement-to-Implementation Mapping

> **Non-authoritative.** Status is verified against the current repository and
> the pinned sources in [`versions.json`](./versions.json). `Implemented` means
> the cited code path exists; it does not imply Isometric or verifier approval.

## Which write rules live where

`src/lib/certifier-policy/isometric.ts` owns unsampled Credit batch eligibility:
an Isometric facility connection, organization credentials, and computed Method-B
eligibility are required. Data-access gathers these facts in the write transaction
under the existing lock sequence; the module has no database or auth dependencies.

`validateBatchPeriod` applies noma's conservative one-calendar-month cap only to
Isometric batches (D14, [#368](https://github.com/Maji-Studio/noma-dmrv/issues/368)).
The shared date helper owns date validity and ordering for every certifier.
Create, update, membership, run options, and the certifier-aware form check use
this split. The Isometric-conditional DB constraint
`credit_batches_isometric_max_one_month` remains the backstop.

As an implementation decision of [#368](https://github.com/Maji-Studio/noma-dmrv/issues/368)'s
D14 follow-through, linking a facility to Isometric refuses archived facilities
and active credit batches with overlong periods under mapping and facility locks.
In the same transaction, it stamps active null-certifier batches `isometric` and
records activity, leaving archived batches unchanged. This app decision does not
change the protocol pin or claim a pinned v1.1 requirement; see
[ADR 0016](../adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md).

To move a rule between noma-wide and Isometric-only, record the decision here or
in the owning ADR, move its shared check or certifier condition, and align every
caller and any DB backstop. Cover Isometric and provider `null` in regression
tests. Keep provider-specific rules concrete until a second certifier needs a
shared interface.

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
| Registry energy mapping | `src/lib/isometric/semantic-binding-catalog.ts` and `src/lib/isometric/utils/aggregation.ts` | implemented | Electricity is one grid component; diesel uses separate `Generator diesel usage` and `Startup diesel usage` components. Display-name mapping remains an operational coupling |
| Transportation | Leg method, one-way distance (counted as a round trip), mass, vehicle type/model year, and evidence references in `src/db/schema/logistics.ts` | partial | Vehicle type/model year stay in the evidence ledger; mixed values are advisory. The factor is a fixed template input. Fleet coverage by the factor and its Source remains open, as do per-record-type evidence gates. Distance-method fallback justification lives in the PDD, outside noma |
| BCU accounting | None | missing | No BCU schema, retirement, ownership, cap, additionality, or anti-double-count structures |
| Embodied inventory | Generic documents only | missing | No item/material/equipment inventory or complete factor records |
| GHG/SSR materiality assessment | None | missing | `ghg_materiality_assessments` does not exist; no issuance gate |
| Co-product allocation | None | missing | Add a no-co-products applicability record or an allocation model |
| Reversal risk | Registry risk score and buffer contribution | registry-owned | Noma has no batch-level buffer input |
| Removal Sources | Evidence targets on `src/lib/isometric/semantic-binding-catalog.ts` roles, classified by `src/lib/certification/removal-source-bindings.ts`, and post-submit verification in `src/lib/isometric/source-binding-verification.ts` | implemented | Sources bind to exact inputs, including generated transport/durability ledgers and the safety-margin mass target |
| Safety margin | Named `Safety margin` mapping in `src/lib/isometric/semantic-binding-catalog.ts` | implemented | noma submits removal dry mass only; the fixed carbon intensity and its justification remain registry-owned |
| GHG Statement report | `certifier_ghg_statement_reports`, `src/fn/certification/ghg-statement-reports.ts` | implemented | Generated data summary is immutable after preparation/approval; external report URL remains supported for project-specific qualitative reports |
| Reporting window | `src/fn/certification/removal-reporting-window.ts` | partial | End is latest application date; start still uses earliest production start instead of earliest feedstock sourcing |
