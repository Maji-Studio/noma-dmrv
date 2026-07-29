# P0 Isometric Compliance Checklist

> Scope: the pinned Biochar Protocol v1.1 and its five modules in
> [`versions.json`](./versions.json). Status describes current repository state,
> not external approval.

| ID | Requirement area | Current state | Completion condition | Status |
|---|---|---|---|---|
| `P0-01` | Feedstock EC1-EC15 and >25% ineligible cap | Eligibility flags and read-time mass roll-ups exist; no assessment store or issuance gate | Versioned criterion evidence plus a Reporting-Period cap decision that blocks ineligible issuance | open |
| `P0-02` | Counterfactual lifecycle | Quantity/category inputs exist | Dated assessment, evidence window, expiry/reassessment, sourcing-change invalidation, and wildfire handling | open |
| `P0-03` | Method-B enforcement | Process epoch/prerequisites and immutable sampled/unsampled choice are implemented | Confirm the unsampled registry representation and enable it only after sandbox verification | partial |
| `P0-04` | Pyrolysis-gas calibration/leak testing | Pressure readings exist | Allowed-method record plus calibration/test standard, event, evidence, and submission/readiness gate | open |
| `P0-05` | Lost-mass accounting | Incident records exist | Auditable incident-to-run/delivery/application adjustment that reduces credited mass | open |
| `P0-06` | Durability submission | Sampled 1,000-year measurement-sample path works in sandbox; 200-year builders exist | Confirm 200-year units/bindings and production availability; retain fail-closed tier/template gates | partial |
| `P0-07` | Stockpile controls | `stockpile_events` and >12-month exception constraint exist | Operator workflow, duration/control alerts, and readiness/submission integration | partial |
| `P0-08` | Point-of-mixing | Ratio/timeline are representable | Irreversibility and fuel-unsuitability attestations before crediting | open |
| `P0-09` | Custody handoffs | No `custody_handoffs`; custody is reconstructed from lineage/evidence | Decide whether the derived trail suffices; otherwise add a canonical, integrity-checked handoff ledger | open |
| `P0-10` | Facility electricity intensity | Run-level electricity only | Facility-year roll-up and >200 GWh classification | open |
| `P0-11` | Low-carbon procurement EC1-EC5 | `power_procurement_evidence` exists | Conjunctive evaluator, qualified/non-qualified kWh split, and claim gate | partial |
| `P0-12` | Book-and-Claim Units | No BCU structures | Full eligibility, quantity/cap, ownership, retirement, additionality, decarbonization statement, and anti-double-count model before use | not adopted |
| `P0-13` | SSR/materiality assessment | No `ghg_materiality_assessments` | Versioned boundary/materiality assessment and appropriate issuance guard | open |
| `P0-14` | Reversal risk and buffer | Buffer percentage exists | Questionnaire, versioned score/derivation, events, and reassessment schedule | open |
| `P0-15` | Embodied emissions | Generic documents only | Reproducible full-lifecycle inventory and complete per-factor records | open |
| `P0-16` | Transport method hierarchy | Method is stored | Evidence-required fallback from energy usage to distance method | open |
| `P0-17` | Transport trip/evidence completeness | Return trip is representable; evidence references are permissive | Onward-trip proof for one-way plus required record types and scale calibration | open |
| `P0-18` | Transport factor quality | Factor value is stored | Source, vintage, mode/vehicle match, full-fuel-cycle basis, and recency gate | open |

Current implementation evidence belongs in
[`schema-mapping.md`](./schema-mapping.md). Do not mark a row complete because
the schema can store part of the requirement.
