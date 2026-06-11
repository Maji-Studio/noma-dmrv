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
diesel against. Production runs roll up (applied-biochar scoped) into
an Isometric **Removal**, reached from a credit batch through
application lineage — a run is *not* 1:1 with a Removal.

**Genset energy**:
Electricity produced by an on-site diesel generator. Operators measure
the diesel consumed in **litres**; genset energy in kWh is derived from
litres via a per-facility conversion yield.
_Avoid_: generator power, backup power.

**Emission estimate**:
A per-facility configured value (genset yield, stage-split percentages)
used to derive submission data noma does not measure directly. Distinct
from a measured value.

### Materials & formulation

**Feedstock type**:
The single catalog of input materials — covering both pyrolysis biomass
(wood chips, hardwood) and blend ingredients (compost, mineral, lime).
**Usage** is declared first when creating one: *pyrolysis* or *blend*.
Pyrolysis-usage entries are selected from the certifier's registry
catalogue when Isometric is the organization's certifier
(certifier-validated); blend-usage entries are general, internal-only,
and are **never submitted** to a registry.
_Avoid_: ingredient, material (the catalog is one thing; usage
disambiguates).

**Ingredient bin**:
A storage bin holding a **blend-usage feedstock type**, drawn on when a
biochar product is mixed per a formulation. A bin declares its feedstock
type at creation; the biochar product form proposes only bins whose
type matches the selected formulation's lines.

**Bin movement**:
A single recorded change to a storage bin's stock — an intake, draw,
transfer, write-off, or adjustment — carrying its mass, actor, time,
and reason. Bin stock is the consequence of its movements; nothing
changes stock except a movement.
_Avoid_: stock change, log entry, audit record.

### Submission & registry

**Credit batch**:
noma's unit of monthly carbon accounting — one month's aggregated
biochar production and application. On submission, one or more credit
batches are grouped into a single Isometric **Removal** (default 1:1
per month). `creditBatches` carries a nullable `removalId` FK.
_Avoid_: batch, issuance.

**Removal**:
The Isometric **submission unit** — a facility-scoped registry record
of verified, applied-biochar CO₂e accounting, held locally by a
`certifierRemovals` row. **N credit batches map into one Removal.** A
Removal aggregates the deduped union of **production runs** reached
through its member credit batches' application lineage, **applied-biochar
scoped** — each run weighted by `appliedDryKg / runTotalBiocharOutput`.
Submission is single-phase (`submitRemoval`) **to the registry**. There is
**no remote Removal status** in this integration, so a Removal's lifecycle
ends at *Submitted* (+ *Superseded* on a re-version) — never *Accepted* /
*Rejected*; that verifier lifecycle belongs to the GHG Statement. See
ADR 0003.

**GHG Statement**:
An **independent, period-anchored Isometric artifact** that rolls up
multiple **Removals** for a supplier-chosen reporting period. It is
**not** a synonym for a credit batch. Isometric creates a GHG Statement
from only `{ project_id, end_on }` and links Removals to it server-side
by reporting-period date range; local membership is reconciled back from
the statement's `removal_ids` (and stays **read-only** in noma — ADR 0004).
A GHG Statement is submitted to a **verifier** (not the registry directly);
its remote lifecycle runs *Awaiting verifier → Verified → Credits issued /
Verification failed*, read from `latestSubmission.metadata.remoteStatus`.
_Avoid_: equating a GHG Statement with one credit batch; attributing a
verifier status to a Removal.

**Reporting period**:
The time window a **GHG Statement** covers — the supplier chooses the
end date, Isometric derives the start. Distinct from the LCA window
(≈1 year for the Sifuri Halisi project), within which many monthly
credit batches and several GHG Statements fall.

**Submission ledger**:
The local journal (`certificationSubmissions`) of every outbound registry
submission — one row per (entity, version), status *draft → submitted →
accepted / rejected / superseded*. Every submit attempt is decided against
the ledger's latest row, never against the registry directly.
_Avoid_: sync log, submission history.

**Claim**:
The decision of what a submission attempt may do against the **submission
ledger**: create a new version, resume a stale draft, return the existing
result idempotently, or block.
_Avoid_: lock (the claim is a decision; the lock is one of its inputs).

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

### Provenance & lineage

**Rollback**:
The upstream trace from one **application** to its originating feedstock
batches, through the custody path Feedstock (+ Reactor) → Production Run
→ Biochar Product → Order → Delivery → Application.
_Avoid_: trace-back, upstream graph.

**Roll-up**:
The merged lineage of one **credit batch** — every member application's
**rollback** combined, production runs deduped, applied-biochar scoped.
Mirrors how a **Removal** aggregates runs. The chain-of-custody page is
anchored on this; a single application's rollback is its drill-down.
_Avoid_: aggregate view, batch graph.

**Trail**:
The dated, evidence-annotated reading of one application's **rollback** —
each custody step with its date and what attests it (documents, samples,
distance provenance). One reading, not two: it merges what a "timeline"
and an "attestation ledger" would each show.
_Avoid_: timeline, ledger, audit log.

**Mass balance**:
The dry-mass flow reading of a **credit batch**: feedstock → production
runs → biochar lots → applied, with every loss drawn as an explicit
labeled exit — **ineligible feedstock**, **conversion loss**, in-storage
mass. Ribbon widths always mean dry kg; columns are never normalized.
_Avoid_: volume flow.

**Conversion loss**:
The pyrolysis mass not retained in biochar (syngas, vapour, ash) —
expected process physics, not an error or a leak.
_Avoid_: shrinkage, waste.

### Tenancy

**Organization**:
A biochar operator company onboarded onto noma — the tenant boundary.
An Organization owns one or more **facilities**, and **every domain
record belongs to exactly one Organization** — including master data
(suppliers, customers, vehicles, drivers, feedstock types). Nothing is
shared across Organizations; new Organizations are seeded with a
starter catalog instead.
_Avoid_: client (collides with client components / API clients), tenant
(infrastructure word, not domain word), company.

**Platform Admin**:
A noma platform operator (Maji / Dark Earth staff). Creates and manages
**Organizations** and their users, and may enter any Organization's
workspace with full read/write — organization isolation is policy
toward other organizations, not toward the platform. Replaces the old
global `admin` role.
_Avoid_: superadmin, root.

**Member**:
A user's belonging to an **Organization**, carrying one org role —
*Owner* (first user, full control, an org never loses its last owner),
*Admin* (manages members and org settings; registry-facing submissions
are Admin-and-up), or *Member* (day-to-day MRV data entry). A user may
hold memberships in several Organizations, though one is the norm.
_Avoid_: teammate, seat.

## Relationships

- An **Organization** owns one or more facilities; every domain record
  belongs to exactly one **Organization**
- A user holds one or more **Memberships**, each in one **Organization**
  with one org role; a **Platform Admin** needs no Membership to act
  inside an Organization
- The LCA window contains many monthly **Credit batches**
- **N Credit batches** group into one **Removal** (default 1:1 per month)
- A **Credit batch** aggregates many **Production runs**
- A **Removal** is the Isometric submission unit — it aggregates the
  deduped union of **Production runs** reached through its member credit
  batches' application lineage, applied-biochar scoped
- A **GHG Statement** rolls up many **Removals** by reporting-period
  date range
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
