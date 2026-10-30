# Isometric Requirements Shortlist

> **Non-authoritative interpretation.** This is a shortlist, not a complete
> protocol extraction. Verify the linked Isometric source before implementation
> or a credit claim. Rows are grounded in
> [`versions.json`](./versions.json) and the
> [2026-07-24 v1.1 gap-check](../archive/2026-07-24-isometric-gap-check-v1-1.md).

Pinned versions and tagged registry URLs live only in
[versions.json](./versions.json). The [2026-10-30 public-source cross-check](../archive/2026-10-30-isometric-verification.md#public-source-cross-check)
records source scope, corrections and verification limits. It is not MCP
verification or a change to the project pin.

## Feedstock

| Requirement | When | Minimum records or computation | Source |
|---|---|---|---|
| Demonstrate an acceptable EC1-EC12 combination, one of EC13-EC14, and EC15 when applicable | Before crediting and when the relied-on facts change | Criterion outcomes and evidence for the path actually used | [BFA v1.2 eligibility](https://registry.isometric.com/module/biomass-feedstock-accounting/1.2#biomass-feedstock-eligibility) |
| FSC Mix should remain at or below 50% of project feedstock; PPDs for FSC Controlled Wood Sources and PEFC Controlled Sources should target FSC Mix at or below 25% | Project sourcing | Eligibility evidence stays outside noma; these are sourcing recommendations, not a general ineligible-biomass cap | [BFA v1.2.3 Appendix 3](https://registry.isometric.com/module/biomass-feedstock-accounting/1.2?tag=1.2.3#appendix-3-acceptable-forest-certification-programs-for-ec9) |
| Evaluate counterfactual storage: 15-year release, 50-year durable storage discount, and zero for evidenced government-managed/funded wildfire mitigation or restoration feedstock | Per applicable feedstock assessment | Counterfactual category, quantities, assessment date, evidence, reassessment/expiry | [BFA v1.2 counterfactual eligibility](https://registry.isometric.com/module/biomass-feedstock-accounting/1.2#counterfactual-storage-eligibility) |
| For potential market leakage, apply the v1.2 EC1-EC12 combination and calculate replacement emissions where an exemption does not apply | Per applicable feedstock | Highest-value replacement use; energy, embodied, and transport replacement emissions; C1/C2 evidence | [BFA v1.2 leakage criteria](https://registry.isometric.com/module/biomass-feedstock-accounting/1.2#eligibility-criteria-for-biomass-feedstocks-with-potential-market-leakage-impacts) |
| Apply the EC15 dedicated-energy eligibility test | Non-forestry feedstocks | Non-forestry status, energy-use share, and the applicable ethanol-radius facts | [BFA v1.2 dedicated energy](https://registry.isometric.com/module/biomass-feedstock-accounting/1.2#dedicated-energy-feedstock-eligibility) |

## Production and project controls

| Requirement | When | Minimum records or computation | Source |
|---|---|---|---|
| Define production batches and Method A/Method B sampling at the production-process grain | Each batch/process epoch | Immutable sampled/unsampled batch choice, process prerequisites, sample history, at least three replicates for a sampled batch | [Biochar v1.1 calculation](https://registry.isometric.com/protocol/biochar/1.1#calculation-of-cbiochar) |
| Include a reactor engineering design diagram and maintenance/construction information in the PDD | Validation and design change | Versioned drawing/evidence and PDD narrative | [Biochar v1.1 design diagram](https://registry.isometric.com/protocol/biochar/1.1#design-diagram-requirements) |
| Quantify pyrolysis-gas loss by an allowed method | During operation | Kinetics model, or sub-atmospheric pressure monitoring with required accuracy/cadence/calibration, or at least annual leak testing | [Biochar v1.1 pyrolysis-gas loss](https://registry.isometric.com/protocol/biochar/1.1#pyrolysis-gas-loss) |
| Measure total carbon using ASTM D5373 or an accepted equivalent on representative final product samples | Per required sample | Lab method, sample condition, result, and accredited-lab evidence | [Biochar v1.1 stored carbon](https://registry.isometric.com/protocol/biochar/1.1#calculation-of-cbiochar) |
| Quantify and deduct spilled or lost biochar and allocate the loss to the affected batch | Per incident | Incident, mass adjustment, affected lineage, and credited-mass deduction | [Biochar v1.1 required records](https://registry.isometric.com/protocol/biochar/1.1#required-records--documentation---coestored-n) |
| Keep legal, environmental, social, stakeholder, adaptive-management, and additionality support in the PDD | Validation and material change | Permits, risk/mitigation narratives, engagement evidence, response plan, additionality demonstration | [Biochar v1.1](https://registry.isometric.com/protocol/biochar/1.1) |

### Project reactor monitoring

Source read 2026-10-15 and monitoring thresholds rechecked publicly 2026-10-30. The project PDD selects the
sub-atmospheric pressure alternative under
[Biochar v1.1.1 §9.1.2](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1).
It requires at least one-minute recording, sensor accuracy of 2% full scale or
better, calibration meeting manufacturer requirements and at least annually,
and raw data available on request. PDD B.19 commits to at least five-year
retention; E.3 adds annual accredited leakage inspection. B.18 selects no
external reactor model. The route does not require continuous gas telemetry.
See [approved PDD evidence, #627](https://github.com/Maji-Studio/noma-dmrv/issues/627).

The same historical reading of §9.2.4 requires operational feedstock comparable
to the emissions test, flue-stack temperature within 10% of the test value,
one-minute temperature recording, 2% full-scale accuracy or better and at least
annual calibration meeting manufacturer requirements. §9.2.4.1 requires retaining
the signed accredited test report, raw temperature data, temperature-equipment
calibration records and manufacturer manuals for at least five years.
[Authoritative sections](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1)
remain the source to recheck before changing a gate.

The unchanged Readings file retains pressure/temperature evidence. Only uploaded
file presence gates readiness; noma does not check contents. The
[operator decision](./changes.md#2026-10-15-correct-reactor-monitoring-citations-and-retain-document-only-gates-627-slices-1-2-4)
and [integration contract](./integration-plan.md#reactor-time-series-upload)
distinguish that gate from optional parsed readings and registry submission.

## Agricultural-soil storage and application

| Requirement | When | Minimum records or computation | Source |
|---|---|---|---|
| Characterize total carbon, moisture, H/C, O/C, volatile matter or fixed carbon, ash, PAH, and the applicable contaminant panel | At the module cadence | Accredited lab reports, methods, QA/QC, replicates, and complete results | [Agricultural Soils v1.1 chemical characteristics](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#chemical-characteristics) |
| Apply WBC pollutant thresholds when local regulation does not supply the controlling limit | When the condition applies | Measured Pb/Cd/Cu/Ni/Hg/Zn/Cr/As, PAH, PCB, dioxin/furan results and threshold decision | [Agricultural Soils v1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1) |
| For 200-year durability, provide the blueprint's H/C, carbon, product-mass, and soil-temperature evidence | Per submitted batch/path | Raw sample statistics and facility soil-temperature reference; registry computes credited durability | [Agricultural Soils v1.1 quantification](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#quantification-of-coe) |
| For 1,000-year durability, provide at least three complete samples and at least 500 R0 measurements per Sample under ISO 7404-5 | Per submitted batch/path | Total-carbon replicates, product mass, the fraction of R0 readings above the 2% benchmark, and method evidence | [Agricultural Soils v1.1 quantification](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#quantification-of-coe) |
| Measure applied mass on a calibrated legal-for-trade scale | Each application | Gross/tare or equivalent weigh evidence and calibration support | [Biochar v1.1 applied mass](https://registry.isometric.com/protocol/biochar/1.1#measurement-of-mass-of-biochar-applied) |
| Supply field-management information and reassess reversal risk | With the GHG Statement and at required events/intervals | Irrigation, tillage, fertilizer, rotation, risk questionnaire/history, buffer derivation | [Agricultural Soils v1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1) |

## Energy

| Requirement | When | Minimum records or computation | Source |
|---|---|---|---|
| Classify facilities above 200 GWh/year as energy intensive | Annually | Facility-year electricity roll-up | [Energy v1.2 classification](https://registry.isometric.com/module/energy-use-accounting/1.2#definition-of-non-intensive-and-intensive-facilities) |
| Treat EC1-EC5 as conjunctive qualification criteria for claimed low-carbon procurement | For each low-carbon claim | Contract, sole EAC/REC ownership and retirement, generator timing, grid-region deliverability, temporal matching | [Energy v1.2 procurement](https://registry.isometric.com/module/energy-use-accounting/1.2#eligibility-criteria-for-low-carbon-power-procurement) |
| Meter electricity at the required interval and accuracy, with calibration/uncertainty support | Ongoing | At least hourly readings, meter accuracy and calibration metadata, any required discount | [Energy v1.2](https://registry.isometric.com/module/energy-use-accounting/1.2) |
| Support fuel quantities with meter/container/bill and calibration records | Each fuel reporting period | Litres or mass, time of use, evidence, and lifecycle factor source | [Energy v1.2](https://registry.isometric.com/module/energy-use-accounting/1.2) |

## Transportation

| Requirement | When | Minimum records or computation | Source |
|---|---|---|---|
| Use energy usage first; use the distance method only with evidence that energy data is unavailable | Each leg | Method choice; fallback justification retained in the PDD, outside noma (#942 q11) | [Transportation v1.1 calculation](https://registry.isometric.com/module/transportation/1.1#calculation-of-transportation-emissions) |
| Default to round trip unless an onward trip is evidenced | Each leg | Every leg counts its round trip (×2 of the one-way distance); no onward-trip exception is modelled | [Transportation v1.1 measurements](https://registry.isometric.com/module/transportation/1.1#measurements-co2esubtransportation-jsub) |
| For distance legs, retain calibrated weight, bill of lading, post-drop-off, and vehicle records | Each leg | Required record types, vehicle class/year, distance, mass | [Transportation v1.1 required records](https://registry.isometric.com/module/transportation/1.1#required-records--documentation---co2esubtransportation-jsub) |
| Use cited, full-fuel-cycle, mode-appropriate, recent emission factors | When a factor is selected or refreshed | Source, description, publication date, vehicle/capacity assumptions | [Transportation v1.1 factors](https://registry.isometric.com/module/transportation/1.1#acceptable-emission-factors) |
| Before adopting Book-and-Claim Units, implement all eligibility, ownership, retirement, cap, and equation requirements | Only if BCU use is proposed | Dedicated BCU structure and evidence; none exists today | [Transportation v1.1 BCU criteria](https://registry.isometric.com/module/transportation/1.1#book-and-claim-unit-eligibility-criteria) |

## Embodied emissions and reporting

| Requirement | When | Minimum records or computation | Source |
|---|---|---|---|
| Inventory all relevant products, materials, equipment, vehicles, and infrastructure across the full lifecycle | Project design and material change | Item/material makeup, weights, design life, replacements, lifecycle stages | [Embodied v1.0](https://registry.isometric.com/module/embodied-emissions/1.0) |
| Keep a complete record for every factor | Each inventory factor | Source, value/unit, basis tier, product and manufacturer, category, EPD expiry, verification standard/record, vintage | [Embodied v1.0](https://registry.isometric.com/module/embodied-emissions/1.0) |
| Review temporal allocation at renewal and revise it when the method changes or is not followed | Each crediting-period renewal, relevant method change or noncompliance | Allocation schedule, actual delivery, review event, early notification/reversal response | [Embodied v1.0](https://registry.isometric.com/module/embodied-emissions/1.0) |
| Begin the Reporting Period with feedstock sourcing and end it with application | Each GHG entry/reporting period | Earliest sourcing date and latest application date | [Biochar v1.1 reporting period](https://registry.isometric.com/protocol/biochar/1.1#calculation-approach-and-reporting-period) |
| Document excluded SSRs and distinguish the protocol's 5% verification materiality from any separate de-minimis rule | Validation and verification | Boundary justification and verifier materiality record | [Biochar v1.1 verification materiality](https://registry.isometric.com/protocol/biochar/1.1#verification-materiality) |
| Apply the Biochar Protocol's co-product allocation procedure when a co-product exists | Each applicable Reporting Period | Applicability statement or allocation inputs and calculation | [Biochar v1.1 co-product allocation](https://registry.isometric.com/protocol/biochar/1.1#co-product-allocation) |
| Retain verification-critical records for at least five years | Continuous | Carbon, mass, application, transport, and calculation records | [Biochar v1.1 required records](https://registry.isometric.com/protocol/biochar/1.1#required-records--documentation---coestored-n) |

Neither pinned [Biochar v1.1.1](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1)
nor [Agricultural Soils v1.1.0](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1?tag=1.1.0)
specifies a 12-month stockpiling expiry. Products have no protocol-derived expiry date.
