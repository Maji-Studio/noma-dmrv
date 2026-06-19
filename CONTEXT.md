# noma-dmrv

A biochar carbon-credit MRV (Monitoring, Reporting, Verification) system.
It traces biomass through pyrolysis to biochar application, aggregates the
result, and submits it to the Isometric carbon registry for verification.

## Language

### Production & energy

**Process stage**:
One of the three phases of the biochar workflow — *pre-processing*
(biomass preparation), *pyrolysis*, and *post-processing* (biochar
processing). The stages are physically real, but operators meter energy
once for the whole run, not per stage — so energy is **not apportioned
across stages**; a run's electricity and genset energy enter as single
combined figures.
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

**Reactor-day file**:
The telemetry export unit the PLC logger produces — one CSV per
reactor per calendar day, minute-interval rows keyed by time-of-day
only, with the reactor code and date carried in the filename. A
production run's readings are the slice of one or more reactor-day
files inside the run's window.
_Avoid_: sensor dump, log file.

**Channel mapping**:
The per-reactor declaration of which **reactor-day file** column feeds
each protocol-relevant reading — temperature, pressure, gas flow. Set
once per reactor, re-confirmed only when a file's header drifts from
it; an import never proceeds on a guessed mapping.
_Avoid_: column config, CSV schema.

**Emission estimate**:
A per-facility configured value (genset yield, default soil
temperature) used to derive submission data noma does not measure
directly. Distinct from a measured value.

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

**Feedstock bin**:
A storage bin holding a **feedstock type**, declared at creation or
locked on first intake. What a bin may feed follows from its held
type's declared usage — pyrolysis-usage stock may enter a production
run, blend-usage stock may enter a formulation — never from the bin
itself; an input bin has no kind of its own. Distinct from output bins,
which hold biochar lots and products.
_Avoid_: ingredient bin as a bin *kind*.

**Ingredient bin**:
Descriptive shorthand for a **feedstock bin** currently holding a
blend-usage feedstock type, drawn on when a biochar product is mixed
per a formulation; the biochar product form proposes only bins whose
held type matches the selected formulation's lines. Not a distinct
kind of bin.

**Bin movement**:
A single recorded change to a storage bin's stock — an intake, draw,
transfer, write-off, or adjustment — carrying its mass, actor, time,
and reason. Bin stock is the consequence of its movements; nothing
changes stock except a movement.
_Avoid_: stock change, log entry, audit record.

### Sampling, characterization & durability

**Sample**:
One lab-analysed **replicate** of a **credit batch**'s biochar, analysed
by an ISO 17025 lab — a record carrying *both* the sampling event (code,
time, mass) *and* the lab chemistry (organic carbon, hydrogen, H/C_org,
ash, …). Samples are drawn distributed across the batch period; a sampled
credit batch carries **≥3 Samples**, whose mean and standard deviation
characterise that batch's biochar. The lab's certificate of analysis is
attached as a `lab_report` **document**, not a separate record.
"Production sample" and "lab sample" are the same thing seen from two
ends — both distinct from in-process biochar spot-checks (operational,
internal-only, never submitted) and from reactor **readings**
(telemetry). _Avoid_: lab sample vs production sample as two entities;
treating the certificate as its own record; conflating with telemetry or
with internal in-process samples.

**Replicate**:
The role a **Sample** plays within its **credit batch**'s set — each
lab-analysed Sample is one replicate, and a sampled credit batch carries
≥3 so a mean, standard deviation and outliers can be derived. "Minimum 3
samples per batch" = ≥3 Sample rows for **one credit batch** (the
protocol's production batch), distributed across its period — not 3
sampling events on a single run. _Avoid_: replicate as anything other
than a Sample.

**Production process**:
A specific **feedstock type** converted under **consistent pyrolysis
conditions** (temperature, residence time) — the boundary the sampling
regime is scoped to (Isometric Biochar Protocol §8.3.1). A sequence of
**credit batches** of the same feedstock and conditions belongs to one
production process; its **Method A / Method B** state and ≥30-Sample
baseline accrue here. Changing the feedstock or the pyrolysis conditions
— or a flagged carbon-content deviation — starts a **new** production
process, resetting the baseline to zero with no history carried forward.
_Avoid_: equating it with a **reactor** (one reactor runs many
production processes over time) or a single **production run**.

**Method A / Method B**:
The two biochar **sampling-frequency** regimes (Isometric Biochar
Protocol §8.3.1), scoped to a **production process** — *not* a reactor.
The sampling/batch unit is the **credit batch** (one feedstock's
≤1-month production batch). *Method A* analyses every credit batch (≥3
**Samples** each); *Method B* is a reduced cadence (≥1 sampled credit
batch per 10), permitted only after that production process has
accumulated a ≥30-Sample Method A baseline. A new feedstock or changed
pyrolysis conditions starts a **new production process** whose baseline
**restarts from zero** — Method B never transfers across feedstocks.
These name a *sampling* cadence only — not a durability or persistence
model. _Avoid_: "declared per reactor"; "Method B transfers across
feedstocks"; treating Method A/B as durability methods.

**Durability tier**:
The crediting time horizon a biochar batch is certified against.
Isometric's soil module offers exactly two: *200-year* (modelled from
the H/C_org ratio and soil temperature) and *1000-year* (from random
reflectance R₀ and non-reactive carbon). There is **no 100-year option**
under the Isometric biochar module — 100-year permanence belongs to
other standards (e.g. Puro / EBC) and to GWP-100, neither of which this
system credits against. _Avoid_: 100-year durability; permanence period
as a free-typed value.

**Carbon-rich-substance sequestration**:
The Isometric removal-template **component** (group `co2-stored`) that
turns applied biochar into the registry's stored-CO₂e figure. noma feeds
it from aggregated **Sample** chemistry and applied biochar mass; the
durable fraction (**durability tier**) scales the result. _Avoid_:
equating it with noma's local CO₂e estimate; "carbon component".

### External parties

**Supplier**:
An external organization feedstock is sourced from. A supplier has one
or more locations; each location carries the stored transport distance
its feedstock deliveries inherit. Deliberately distinct from
**Customer** — the same real-world company in both roles is two records;
a unified party registry was considered and rejected.
_Avoid_: vendor, party, external organization.

**Customer**:
An external organization biochar is delivered to. A customer has one or
more locations; a customer location is a GPS-pinned application site
carrying per-site defaults. Distinct from **Supplier**.
_Avoid_: client (collides with client components / API clients), buyer.

### Submission & registry

**Credit batch**:
noma's unit of biochar carbon accounting — the aggregated production and
application of biochar from **one feedstock under one production
process**, over a window of **at most one month** (enforced when the
certifier is Isometric). It *is* the Isometric protocol's **production
batch** — the lab-characterisation/sampling unit — so a sampled credit
batch carries **≥3 Samples**. Several credit batches run **concurrently**
(one per feedstock / production process); a calendar month is therefore
*not* a single batch. On submission, one or more credit batches group
into a single Isometric **Removal**. `creditBatches` carries a nullable
`removalId` FK. _Avoid_: "one month's production" as a single batch;
batch, issuance.

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

**Truck weighing**:
The gross-mass measurement of a transport vehicle before and after
unloading at a custody transfer point — feedstock arriving at the
facility, or biochar arriving at the application site. The difference
attests the transported wet mass; calibrated scale tickets are retained
verification evidence. Not specific to deliveries.
_Avoid_: truck weighing at delivery site (over-narrow).

**Evidence method**:
The per-application declaration of which of the certifier's two
acceptable proofs of biochar spreading the record satisfies — *visual*
(geotagged, timestamped photos/videos of stockpile, spreading,
incorporation) or *boundary* (a GIS field-boundary reference plus
logbook records). Exactly one method is declared per application;
what counts as missing evidence follows from the declared method.
_Avoid_: proof type, documentation mode.

**Geotag flag**:
The recorded outcome of checking an evidence photo's embedded GPS and
timestamp. A photo without them is accepted but flagged — the gap
surfaces as evidence health, never as an upload error.
_Avoid_: validation failure (the photo is not rejected).

**Distance override**:
A per-trip distance recorded on a delivery only when that trip's
routing differs from the destination's stored distance. Absence means
the stored distance governs — so later corrections to the stored
distance keep propagating.
_Avoid_: treating the override as the primary distance value.

### Operational oversight

**Attention item**:
A computed operational gap or next action surfaced from existing MRV
records — for example missing evidence, blocked certification readiness,
a failed verifier submission, or an active production run. It has no
independent lifecycle, assignee, or completion state; it disappears when
the underlying record changes.
_Avoid_: todo, task (unless a future manual work system is built).

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
- **N Credit batches** group into one **Removal**
- A **Credit batch** is one **feedstock**'s ≤1-month production batch and
  aggregates many **Production runs** of that feedstock
- A **Production process** (a feedstock under consistent pyrolysis
  conditions) spans a sequence of **Credit batches**; **Method A /
  Method B** and the ≥30-Sample baseline are scoped to it, restarting
  from zero when the feedstock or conditions change
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
> whole operation and can't separate the stages — so energy is recorded
> once, at the run, not split across **process stages**."
> **Dev:** "And staff travel — is that per **production run**?"
> **Domain expert:** "No, that's a **reporting period** figure. It
> doesn't belong on a run."

## Flagged ambiguities

- "energy" was used for both grid electricity and **genset energy** —
  resolved: they are distinct inputs with distinct carbon intensities.
- "diesel" conflated genset diesel and startup/plant diesel — resolved:
  genset diesel is accounted as **genset energy** (kWh); startup diesel
  stays volume-based (litres).
