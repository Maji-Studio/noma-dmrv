# Isometric energy-source requirements for `rmv_1KYMTX0T9SBX1VXA`

Date: 2026-07-28  
Scope: read-only research; no Isometric issue was resolved/disputed and no GHG Statement was submitted.

## Executive conclusion

`ISS-77`, `ISS-78`, and `ISS-79` are **not hard gates to GHG Statement submission merely because they are open data-check issues**. Isometric's official Certify guidance says data-check issues do not gate submission; the same issue workflow applies to GHG Statements and LCAs. It also says issues must be resolved before validation. In other words:

- **Submission:** the open omissions are not themselves a submission blocker.
- **Verification/validation:** the underlying evidence requirements are real and must be resolved with evidence or a justified dispute.
- **Current sandbox UI:** the statement's Submit button is disabled, but that cannot be attributed to these three issues. The statement also has no verifier and no report. No write was made to isolate those conditions.

The repository's product decision that incomplete evidence mirroring is advisory for noma readiness is therefore compatible with Isometric's submission UX, but it does **not** mean that source evidence is optional for verification.

## Connector availability

A deferred-tool search for an Isometric registry/MCP connector returned no Isometric tool. The research therefore used only:

1. Isometric's authenticated sandbox UI;
2. Isometric's official Energy Use Accounting modules and Certify documentation; and
3. the generated Isometric OpenAPI snapshot committed in this repository.

## Live findings

Authenticated sandbox record:

- GHG Entry: [`rmv_1KYMTX0T9SBX1VXA`](https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/ghg-entry/rmv_1KYMTX0T9SBX1VXA)
- GHG Statement: [`ggs_1KTKDDXDXSBXHGNJ`](https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/ghg-statement/ggs_1KTKDDXDXSBXHGNJ)

The issue log classifies all three as open `Omission` issues named `Datapoint missing source(s)`:

| Issue | Datapoint | Live value | Isometric guidance |
|---|---|---:|---|
| `ISS-77` | Startup `volume_of_fuel` | `0 L` | Fuel meter/log, container reading, utility bill, or equipment runtime plus manufacturer consumption data |
| `ISS-79` | Generator `volume_of_fuel` | `50 L` | Same allowable primary fuel records |
| `ISS-78` | Shared diesel emission factor | `2.7 ± 0.14 kgCO₂e/L` | Citation for the factor, such as an EPD/LCA or database dataset report/attachment |

The emission-factor Datapoint is shared (`46` usages and `2` template usages), so one suitable Source attached to that shared Datapoint can support all of those usages. It does not need to be a separate operator PDF for every Removal.

After 36 checks, the GHG Statement still showed:

- status `Draft`;
- Submit disabled;
- Report `—`; and
- no verifier value.

The UI provided `Mark as addressed`, `Dispute`, and `Comment` actions for the issues. These were inspected but not used.

## What the protocol requires

### Fuel quantities (`ISS-77`, `ISS-79`)

Energy Use Accounting v1.2 §6.4 says fuel usage must be monitored for relevant in-gate operations and lists acceptable evidence: on-site meter readings, container-weight readings, utility bills, or equipment runtime combined with manufacturer consumption ratings. Allocations that include unrelated equipment must be justified and accepted during third-party verification; meter and calibration records must be retained for five years.  
Source: [Isometric Energy Use Accounting v1.2, §6.4](https://registry.isometric.com/module/energy-use-accounting/1.2#required-records-and-documentation---coe-1).

The current v1.3 retains materially the same requirements at §6.5.  
Source: [Isometric Energy Use Accounting v1.3, §6.5](https://registry.isometric.com/module/energy-use-accounting/1.3).

For this Removal:

- `50 L` needs a dated primary record supporting the generator/preprocessing quantity and its allocation to the reporting period/removal.
- The blanket data check also flags `0 L`. The module does not state a zero-value exemption, but neither does it explicitly require a fuel-purchase document when no fuel was consumed. The defensible paths are:
  1. attach the same contemporaneous production-energy log with an explicit zero startup-fuel entry; or
  2. dispute `ISS-77` with the monitored-zero rationale and let Isometric/the verifier resolve it.

Simply ignoring `ISS-77` is not a verification-ready outcome.

The existing production-readings CSV is not fuel evidence: its canonical columns cover timestamp, temperature, pressure, and optional equipment frequencies only (`src/lib/production-readings/readings-csv.ts:1-25`).

### Diesel emission factor (`ISS-78`)

Energy Use Accounting v1.2 §6.2 and v1.3 §6.3 require the factor to match the fuel and combustion process, prefer regional/site-specific data, represent full-life-cycle well-to-wheel emissions, and use CO₂e based on the applicable 100-year GWP. Accepted families include GREET, CA-GREET, Ecoinvent, US Federal LCI/LCA Commons, and equivalent LCA databases. Direct-combustion-only factors are permitted only if missing life-cycle emissions are accounted for separately.  
Sources: [v1.2 §6.2](https://registry.isometric.com/module/energy-use-accounting/1.2#acceptable-emissions-factors---coe-1), [v1.3 §6.3](https://registry.isometric.com/module/energy-use-accounting/1.3).

Therefore the needed Source is not necessarily an operator-authored document. It should be a stable citation artifact—dataset report/export, database documentation, EPD, or LCA—that supports the **exact** `2.7 ± 0.14 kgCO₂e/L` value and its scope. An arbitrary diesel-factor PDF is insufficient if it does not reconcile to that magnitude, uncertainty, geography, fuel, process, and well-to-wheel boundary.

## Submission gating versus verification

Isometric's official Certify LCA guide states:

- data checks flag issues before submission;
- issues are not gating to submission;
- addressing, disputing, or commenting is recommended for every issue; and
- issues must be resolved before validation.

It explicitly says the process for GHG Statements and LCAs is the same.  
Source: [Isometric Certify — Build an LCA, “Data checks”](https://docs.isometric.com/user-guides/certify/lca).

The generated API contract is consistent with that distinction:

- `CreateDatapointRequest.source_ids` is required but may be an empty array (`src/lib/isometric/generated/mrv.openapi.json:869-947`), allowing draft Datapoints without evidence.
- `SubmitGhgStatementRequest` contains only `ghg_statement_report_url` (`src/lib/isometric/generated/mrv.openapi.json:6037-6046`).
- `POST /ghg_statements/{id}/submit` exposes no issue-acknowledgement field (`src/lib/isometric/generated/mrv.openapi.json:8864-8925`).

The OpenAPI shape does not prove that the server will accept every otherwise-invalid statement; no submission request was made. It does prove that open issue IDs are not passed as part of the submit request.

## Recommended noma treatment

1. Keep source completeness **advisory for Removal creation/submission**, but state clearly that unresolved source omissions remain before verification.
2. Add a production-energy evidence artifact/source that reconciles the run-level startup, genset, and preprocessing litres to the submitted component values. It can be bound to both `volume_of_fuel` Datapoints; it should cite the underlying logs/meters/receipts rather than merely restating database fields.
3. Manage the diesel factor Source once on the shared fixed Datapoint/template and reuse it across Removals.
4. For an explicit monitored zero, either bind the production-energy log showing zero or use Isometric's `Dispute` workflow with a documented rationale. Do not fabricate a fuel receipt.

