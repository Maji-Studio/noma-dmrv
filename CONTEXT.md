# noma-dmrv

A biochar carbon-credit MRV (Monitoring, Reporting, Verification) system.
It traces biomass through pyrolysis to biochar application, aggregates the
result, and submits it to the Isometric carbon registry for verification.

## Language

### Production & energy

**Process stage**:
One of the three phases of the biochar workflow — *pre-processing*
(biomass preparation), *pyrolysis*, and *post-processing* (biochar
processing). Operators do not meter energy separately per stage; the
per-stage split is an estimate.
_Avoid_: phase, step.

**Production run**:
One pyrolysis batch at a reactor, the unit operators log energy and
diesel against. Each production run maps to exactly one Isometric
**Removal**.

**Genset energy**:
Electricity produced by an on-site diesel generator. Operators measure
the diesel consumed in **litres**; genset energy in kWh is derived from
litres via a per-facility conversion yield.
_Avoid_: generator power, backup power.

**Emission estimate**:
A per-facility configured value (genset yield, stage-split percentages)
used to derive submission data noma does not measure directly. Distinct
from a measured value.

### Submission & registry

**Credit batch**:
noma's unit of submission — one month's accounting. A credit batch
submits as exactly one Isometric **GHG Statement**.
_Avoid_: batch, issuance.

**GHG Statement**:
The Isometric reporting-period (monthly) summary submitted for
verification and credit issuance. One noma **credit batch** = one GHG
Statement, which contains one **Removal** per **production run**.
noma's `creditBatches` table is structurally a GHG Statement; the table
keeps its name (renaming would touch ~50 files) but the integration
maps it to a GHG Statement, not a Removal.

**Reporting period**:
The time window an LCA covers (≈1 year for the Sifuri Halisi project).
A reporting period contains many monthly **credit batches** / **GHG
Statements**.

**Removal**:
The Isometric registry record of one **production run**'s verified CO₂e
accounting. A **GHG Statement** contains many Removals — one per run.

**Monitored input**:
An Isometric removal-template input whose value comes from the
supplier's operational data, supplied per submission.
_Avoid_: variable input, measured input.

**Fixed constant**:
An Isometric removal-template input bound in the registry to a
policy-level value (an emission factor, a global-warming potential) —
the same for every submission. Contrast **monitored input**.

**Zero stub**:
A placeholder mapping that emits `0` for a **monitored input** noma
cannot yet source. A template carrying any zero stub must not be used
against a production registry project.

## Relationships

- A **Reporting period** contains many **Credit batches**
- A **Credit batch** submits as exactly one **GHG Statement**
- A **Credit batch** aggregates many **Production runs**
- A **GHG Statement** contains one **Removal** per **Production run**
- A **Removal** is built from **Monitored inputs** (per-submission data)
  and **Fixed constants** (registry-bound policy values)
- An **Emission estimate** is configured per facility and supplies
  **Monitored input** values noma does not measure directly

## Example dialogue

> **Dev:** "The template wants pyrolysis-stage electricity separately
> from biomass-stage electricity — do operators record that?"
> **Domain expert:** "No. On-site we read one electricity meter for the
> whole operation. Splitting it across **process stages** is an
> **emission estimate**, not a measurement."
> **Dev:** "And staff travel — is that per **production run**?"
> **Domain expert:** "No, that's a **reporting period** figure. It
> doesn't belong on a run."

## Flagged ambiguities

- "energy" was used for both grid electricity and **genset energy** —
  resolved: they are distinct inputs with distinct carbon intensities.
- "diesel" conflated genset diesel and startup/plant diesel — resolved:
  genset diesel is accounted as **genset energy** (kWh); startup diesel
  stays volume-based (litres).
