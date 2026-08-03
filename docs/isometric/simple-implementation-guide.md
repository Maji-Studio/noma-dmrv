# Isometric Implementation Guide

> **Non-authoritative.** This guide explains the implementation currently in
> the repository for the version set in [`versions.json`](./versions.json).
> It is not a proposal for fields that do not exist.

## Status vocabulary

- **Implemented:** the end-to-end code path exists at the stated boundary.
- **Schema-implemented:** storage and constraints exist, but workflow or gating
  is incomplete.
- **Partial:** useful inputs or logic exist, but the requirement is not
  enforceable end to end.
- **Missing:** no dedicated structure exists.
- **Registry-owned:** configured or calculated in Isometric, not duplicated in
  noma.

## Feedstock eligibility

Feedstock attributes and eligibility labels exist, and credit-batch lineage is
loaded set-wise through
`src/data-access/credit-batch-accounting.ts`. That module is the canonical
place for credit-batch roll-ups; old stored summary columns must not be
reintroduced.

What is still missing is the decision record: one valid EC1-EC12 path, one of
EC13-EC14, EC15, and the Reporting-Period >25% cap. Counterfactual quantities
exist, but their dated validity and reassessment lifecycle do not.

Implementation rule: store the evidence and facts that cannot be derived;
derive mass fractions and pass/fail outcomes from current lineage. Do not store
an unversioned boolean as the only compliance record.

## Production batches and sampling

A credit batch is the protocol production batch. Lab samples attach at
credit-batch grain. A production process holds the current epoch and all-or-none
Method-B prerequisites. Each credit batch stores an immutable `sampled` or
`unsampled` choice.

Creating an unsampled batch checks the organization connection, facility
project mapping, prerequisites, and eligible sample history. The registry
representation for an unsampled durability claim is still unconfirmed, so this
is not a production-live Method-B submission claim.

At least three usable replicates are required for a sampled durability batch.
In-process `production_samples` are operational observations, not the submitted
lab-characterization grain.

## Durability paths

The facility declares one durability tier. Submission checks that the selected
template uses a compatible sequestration blueprint.

### 1,000-year

The sampled 1,000-year path is implemented and verified against the sandbox.
For each member credit batch, noma sends:

- total-carbon replicate values,
- product mass,
- `s_fraction` replicate values, where each value is the fraction of R0
  readings meeting the threshold.

The exact component-input binding lives in
`src/lib/isometric/transformers/sequestration-binding.ts`. The registry
computes the credited result. Production remains blocked, and the difference
between the live blueprint and module Eq.6 remains an explicit open question.

### 200-year

Aggregation and measurement-sample builders exist. Submission remains
fail-closed because the H/C unit conversion and explicit component-input table
have not been confirmed. Do not describe the 200-year path as live.

Generated durability evidence ledgers cover both tier formats, but evidence
generation does not make an unavailable registry path available.

## Stockpiles, custody, and materiality

`stockpile_events` exists with dates, risk/control fields, and a database check
requiring an exception reference beyond 12 months. No operator workflow or
submission gate currently consumes it.

There is no `custody_handoffs` table. The Chain-of-Custody Trail reconstructs
movement and evidence from domain lineage. That is useful traceability, but it
must not be described as a canonical handoff ledger.

There is no `ghg_materiality_assessments` table and no BCU model. Both are
missing, not partially implemented.

## Energy

Run data records electricity, reactor-startup/plant diesel, generator diesel,
and preprocessing fuel.

Submission uses:

- one `pyrolysis / grid_electricity_use / electricity_use` value;
- a `Generator diesel usage` component carrying generator plus preprocessing
  litres;
- a `Startup diesel usage` component carrying reactor-startup/plant litres.

Both diesel components use
`pyrolysis / fuel_usage_by_volume / volume_of_fuel`. Their fixed lifecycle
factor is bound in the registry template. noma neither converts diesel to kWh
nor stores that factor.

The component names are currently the discriminator because Certify exposes no
stable component-instance key. Unknown names fail closed.

`power_procurement_evidence` exists, but the EC1-EC5 criteria are conjunctive
and are not yet evaluated or gated. Run-level kWh is not an hourly,
calibration-backed electricity meter stream.

## Transportation and evidence

Transport legs carry method, trip type, distance/mass, factor, and evidence
references. Aggregation submits mass-distance by transport category.

Current gaps include:

- proof that the energy-usage method was unavailable;
- onward-trip evidence for one-way treatment;
- mandatory record types rather than “any one document”;
- gross/tare and scale calibration support;
- vehicle class/year and factor source/vintage.

Removal evidence is not attached wholesale to every Datapoint. The immutable
Source plan maps each document or generated ledger to exact intended inputs in
`src/lib/certification/removal-source-bindings.ts`, and the post-submit verifier
walks GHG-entry component attributions back to the targeted Datapoints.

## Safety margin

The active template's `Safety margin` is a named Removal-scope exception to the
normal PROJECT-scope miscellaneous-emissions rule. noma submits the same dry
biochar mass used by the storage claim. The fixed carbon intensity and its
justification are registry-owned. Renaming the component fails closed.

## GHG Statement report

An Admin can prepare a PDF data summary from the live Isometric GHG Statement
and its GHG Entries, review it, and approve an immutable version. Submission
rebuilds the source fingerprint and rejects a stale approved report.

At submission time, noma mints a verifier URL for the approved generated report
and records the report as submitted after the registry call succeeds or is
reconciled. An external report URL remains supported when qualitative project,
methodology, monitoring, exception, or human-review content is required.

## Idempotency and reconciliation

Removal, Datapoint, Source, measurement-sample, and GHG Statement creation use
stable references where the API supports them. A local
`certification_submissions` row locks the attempt and stores immutable payload
snapshots and hashes. Same-hash retries reuse or reconcile; changed reviewed
inputs create a superseding version.

Telemetry is the exception documented by ADR 0006: FileUpload and
DataUploadSubmission do not expose a supplier-reference recovery path, so noma
journals returned step IDs into the submission snapshot.

## What to verify before changing a claim

1. Confirm the pin in `versions.json`.
2. Read the relevant current schema, transformer, orchestration, and tests.
3. Distinguish sandbox-enabled from production-enabled code.
4. Check whether a value is noma-submitted, registry-fixed, or
   registry-computed.
5. Update the shortlist, schema mapping, checklist, and open question together
   when the boundary changes.
