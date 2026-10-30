# Isometric implementation guide

Read this for the boundary between local records and registry authority. For
coverage and gaps, use [schema mapping](./schema-mapping.md); for submission
invariants, use [integration contract](./integration-plan.md). Code checked
2026-10-30. Protocol interpretations remain non-authoritative and follow
[versions.json](./versions.json).

## Status vocabulary

- **Implemented:** the code path exists at the stated boundary; no external approval implied.
- **Schema-implemented:** storage exists, but workflow or gating is incomplete.
- **Partial:** useful inputs exist without complete enforcement.
- **Missing:** no dedicated structure exists.
- **Registry-owned:** configured or computed in Isometric.
- **Externally pending:** local code exists; registry confirmation is outstanding.

## Grains and ownership

A credit batch is a production batch. Lab Samples belong to that batch;
`production_samples` are separate operational observations. A Removal claims
Application by credit-batch slices, so a batch can contribute later applications
to a later Removal. Production-side attribution follows
[ADR 0020](../adr/0020-production-emissions-front-loaded-per-credit-batch.md).

The sampled 1,000-year path is code-implemented and sandbox-only. Each physical
Sample produces its own measurement-sample submission with paired total carbon,
measured inorganic carbon, reflectance fraction and sampling instant. Product
mass is a separate Datapoint. The corrected remote grain and template migration
await fresh sandbox confirmation; production is blocked. The 200-year paths
remain gated and unsampled 1,000-year is unsupported. See
[template guide](./sandbox-template-authoring.md#storage-support).

Noma records measured operating quantities. Registry-fixed factors,
justification Sources and credited results remain Isometric's responsibility.
Local CO₂e and durability calculations are explanatory previews.
Reviewed component-ID contracts select automatic sources and entry support;
component names do not determine binding.

## Evidence boundaries

Delivery proof gates Removal submission; Application evidence health is
informational. A pending upload counts as neither uploaded proof nor confirmed
registry evidence. Source attribution targets exact inputs, not every input
in a Removal. Sample moisture stays evidence and is not submitted as a moisture
measurement.

The unchanged Readings file gates readiness by presence. Its contents remain
the operator's responsibility; parsed readings are independent and there is no
reactor time-series upload. Transport distances are stored one-way; aggregation
applies the round trip once. Vehicle type/year can be recorded, while emission
factors stay in the registry template.

Feedstock eligibility, counterfactual/leakage evidence and distance-method
justification remain outside noma under the recorded operator decisions.
The legacy stockpile exception constraint is not a pinned-protocol expiry rule;
see [schema mapping](./schema-mapping.md).

## Before changing a claim

Check the pin, authoritative source and relevant current code/tests. Distinguish
code support, a historical sandbox observation and fresh registry verification.
Keep open external checks in [open questions](../open-questions-isometric.md),
and check [registry behavior](./registry-behavior.md) before trusting API filters
or readback shapes.
