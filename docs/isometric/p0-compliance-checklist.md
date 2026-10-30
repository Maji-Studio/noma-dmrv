# P0 Isometric Compliance Checklist

Read this for submission-critical completion conditions under the historical
interpretation pinned in [versions.json](./versions.json). Code checked
2026-10-30; scoped external checks are in the
[verification record](../archive/2026-10-30-isometric-verification.md). Status does not imply approval.

| ID | Requirement area | Current state | Completion condition | Status |
|---|---|---|---|---|
| `P0-01` | Feedstock eligibility | Evidence maintained outside noma (#942 q8) | Operator evidence outside the app; no local eligibility gate | external |
| `P0-02` | Counterfactual lifecycle | Evidence maintained outside noma (#942 q8) | External assessment and evidence; no delivery-level quantity/category store | external |
| `P0-03` | Method-B enforcement | Process epoch/prerequisites and immutable sampled/unsampled choice are implemented | Confirm the unsampled registry representation and enable it only after sandbox verification | partial |
| `P0-04` | Pyrolysis-gas calibration/leak testing | [Readings file (`sensor_data`)](./requirements-shortlist.md#project-reactor-monitoring) retained unchanged; uploaded-file presence gates readiness | Allowed-method record, calibration/test standard, event, evidence and calibration readiness gate; PDD-selected sub-atmospheric pressure route; no parsed-readings submission gate | open |
| `P0-05` | Lost-mass accounting | Incident records exist | Auditable incident-to-run/delivery/application adjustment that reduces credited mass | open |
| `P0-06` | Durability submission | Corrected per-Sample 1,000-year code exists; fresh sandbox verification is pending; 200-year builders exist | Verify corrected 1,000-year grain/template, confirm 200-year units/bindings and production availability; retain fail-closed tier/template gates | partial |
| `P0-07` | Legacy stockpiling check | `stockpile_events` and >12-month exception constraint exist as a legacy DB check only | Neither pinned Biochar v1.1.1 nor Agricultural Soils v1.1.0 specifies this rule; no protocol completion condition | not applicable |
| `P0-08` | Point-of-mixing | Ratio/timeline are representable | Irreversibility and fuel-unsuitability attestations before crediting | open |
| `P0-09` | Custody handoffs | No `custody_handoffs`; custody is reconstructed from lineage/evidence | Decide whether the derived trail suffices; otherwise add a canonical, integrity-checked handoff ledger | open |
| `P0-10` | Facility electricity intensity | Run-level electricity only | Facility-year roll-up and >200 GWh classification | open |
| `P0-11` | Low-carbon procurement EC1-EC5 | `power_procurement_evidence` exists | Conjunctive evaluator, qualified/non-qualified kWh split, and claim gate | partial |
| `P0-12` | Book-and-Claim Units | No BCU structures | Full eligibility, quantity/cap, ownership, retirement, additionality, decarbonization statement, and anti-double-count model before use | not adopted |
| `P0-13` | SSR/materiality assessment | No `ghg_materiality_assessments` | Versioned boundary/materiality assessment and appropriate issuance guard | open |
| `P0-14` | Reversal risk and buffer | Registry supplies risk score and buffer allocation | Confirm registry-owned assessment; local allocation display remains a follow-up | registry-owned |
| `P0-15` | Embodied emissions | Generic documents only | Reproducible full-lifecycle inventory and complete per-factor records | open |
| `P0-16` | Transport method hierarchy | Method is stored; distance-method justification lives in the PDD (#942 q11) | Maintain the justification in the PDD; no noma field or gate | outside noma |
| `P0-17` | Transport trip/evidence completeness | Every leg counts its round trip; uploaded proof is required per Delivery | Remaining scale/record completeness checks; any onward-trip exception needs its own evidence model | open |
| `P0-18` | Transport factor quality | Factor and justification are registry-fixed | Confirm registry factor source, vintage, fleet match and full-fuel-cycle basis; no competing local factor store | open |

Current implementation evidence belongs in
[`schema-mapping.md`](./schema-mapping.md). Do not mark a row complete because
the schema can store part of the requirement.
