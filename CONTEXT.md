# noma-dmrv

A biochar carbon-credit MRV (Monitoring, Reporting, Verification) system.
It traces biomass through pyrolysis to biochar application, aggregates the
result, and submits it to the Isometric carbon registry for verification.

## Language

### Production & energy

**Process stage**:
One of the three phases of the biochar workflow — *pre-processing*
(biomass preparation), *pyrolysis*, and *post-processing* (biochar
processing). Operators do not meter energy separately per stage — all
energy is recorded once per production run, with no per-stage split.
_Avoid_: phase, step.

**Production run**:
One pyrolysis batch at a reactor, the unit operators log energy and
diesel against. Production runs are the membership primitive for a
**credit batch** and roll up (applied-biochar scoped) into an Isometric
**Removal** through their derived application lineage — a run is *not*
1:1 with a Removal.

**Production run status**:
The run's lifecycle: *draft* → *running* → a terminal outcome.
*Complete* — the batch finished and its core quantities (feedstock
consumed, biochar output) are recorded. *Failed* — the run physically
happened and consumed feedstock but did not produce usable biochar;
its material stays in the mass balance (conversion loss, dump-back)
but never joins a credit batch. *Cancelled* — the record was created
in error; the event never happened and counts nowhere. Failed marks a
real event with a bad outcome; cancelled marks a record that should
not exist.
_Avoid_: void (old name for cancelled), aborted.

**Genset energy**:
Electricity produced by an on-site diesel generator. Operators measure
the diesel consumed in **litres**; genset energy in kWh is derived from
litres via a per-facility conversion yield.
_Avoid_: generator power, backup power.

**Readings file**:
The telemetry export operators upload per reactor — a CSV with a
canonical **UTC** timestamp on every row (required: timestamp,
temperature, pressure; optional: dryer/reactor frequency), matched
directly by header name, so one file can span multiple days. A
production run's readings are the slice of one or more readings files
inside the run's window. Replaces the older reactor-day format
(filename-encoded date, local time-of-day rows, and a per-reactor
**channel mapping** step declaring which column fed which reading) —
the canonical header does that job now, so no per-reactor mapping is
declared or stored.
_Avoid_: sensor dump, log file, reactor-day file, channel mapping.

**Emission estimate**:
A per-facility configured value (genset yield, default soil
temperature) used to derive submission data noma does not
measure directly. Distinct from a measured value.

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
One lab-analysed **replicate** characterising a **credit batch** (the
protocol production batch), analysed by an ISO 17025 lab — a record
carrying *both* the sampling event (code, time, mass) *and* the lab
chemistry (organic carbon, hydrogen, H/C_org, ash, …). A sampled credit
batch carries **≥3 Samples**; their mean and standard deviation
characterise that batch's biochar. Each Sample belongs to **exactly one
credit batch**, recorded against it directly — the batch's biochar is
**commingled across its production runs**, so no single run is
attributable (a run link survives only on legacy rows as provenance).
The Sample inherits the **durability tier** (200- vs 1000-year) its
**facility** declares, carried through its credit batch, and the ≥3 must
be **independent samples distributed across
the batch** (distinct sampling points/days — protocol §8.3.1), never
aliquots of a single grab. The lab's certificate of analysis is attached
as a `lab_report` **document**, not a separate record. Distinct from the
in-process spot-checks logged against a **production run** (the
~2-hourly field measurements) — those are internal-only and never
submitted. _Avoid_: anchoring or characterising at the production-run
grain (characterisation, the ≥3 count, and the record itself are per
credit batch); treating the certificate as its own record; conflating
with reactor **readings** (telemetry).

**Replicate**:
The role a **Sample** plays within its **credit batch**'s set — each
lab-analysed Sample is one replicate, and a sampled credit batch carries
≥3 so a mean, standard deviation and outliers can be derived. Per
protocol §8.3.1 the ≥3 are **independent samples taken from distinct
points (production runs / days) across the batch** and analysed
individually — *not* three aliquots of one grab — and the count is
judged **per credit batch**, never per production run. _Avoid_: replicate
as a lab aliquot; counting the ≥3 at the production-run grain.

**Production process**:
A campaign of biochar production sharing **one feedstock under
consistent pyrolysis conditions** — the population a sampling regime
characterises over time, scoped to a facility. Many monthly **credit
batches** belong to one production process; it **spans reactors**
(physical reactor identity is *not* part of its boundary). A feedstock
change, a pyrolysis-condition change, or a flagged carbon-content
deviation starts a **new** production process. It owns the
**Method A / Method B** regime and, under Isometric, the ≥30-sample
baseline that unlocks Method B. Its established date is the
operator-entered date on which this process actually began operating,
not the date its database row was created; samples before that date never
count toward its baseline. _Avoid_: keying it to a reactor or to a single
credit batch; using record-creation time as the process start; "campaign",
"production line" as separate terms.

**Method A / Method B**:
The two biochar **sampling-frequency** regimes (Isometric Biochar
Protocol §8.3.1), declared per **production process**. The sampling unit
is the **credit batch** (the protocol production batch) — *not* the
production run. *Method A* characterises **every** credit batch; *Method
B* is a reduced cadence (≥1 sampled batch per 10) permitted only after a
production process has accumulated a ≥30-sample Method-A baseline, after
which the registry estimates each unsampled batch conservatively from
that process's samples in the prior 6 months. A credit batch's regime is
fixed when its production period begins: a later Method-B unlock never
reclassifies an in-progress or historical batch. These name a *sampling*
cadence only — they do **not** name any durability or persistence model.
_Avoid_: declaring the method per reactor; the production run as the
sampling unit; treating Method A/B as durability methods;
"representative method"; retroactively applying Method B.

**Method-B baseline**:
The ≥30 qualifying Method-A **Samples** from one **production process**
that permit its deliberate Method-B unlock. They must be dated on or after
the process's operational established date and before its unlock. This is an
unlock prerequisite, not the rolling 6-month population used to estimate a
particular unsampled batch. The baseline-floor invariant may prevent deleting,
moving, or redating a sample even before submission; it does not make ordinary
draft corrections immutable. _Avoid_: calling the rolling eligible pool the
baseline; counting rows from before the process began; treating unlock as a
certification submission.

**Eligible sample**:
A **Sample** counted toward a **production process**'s Method-B
conservative estimate: one taken within the **6 months before** the
production batch being estimated, from that same process while it is
demonstrably stable. The registry's unsampled-batch estimate
(mean − standard error) and its 3σ winsorisation run over the **eligible**
population only; samples older than 6 months drop out. _Avoid_: conflating
the rolling 6-month eligible window with the lifetime ≥30-sample baseline
that unlocks Method B (a process can be unlocked yet hold few *eligible*
samples); scoping eligibility to a reactor or facility rather than the
production process.

**Method-B evidence snapshot**:
The immutable representations of the **eligible samples** used by a submitted unsampled
Method-B **Removal** (the registry's GHG Entry). Subject to the Method-B
baseline floor and normal validation, ordinary sample corrections remain
editable while no submitted Removal depends on them. Submission
dependency-locks every contributing sample version, even when the sample's
own credit batch or Removal remains draft; later changes require a
correction/supersession path rather than an in-place edit. This lock is a
decided target contract — its enforcement is not yet built (ADR 0017
amendment, 2026-07-12). _Avoid_: locking
every baseline sample merely because Method B was unlocked; checking only
whether the sample's own batch has been submitted; treating a mutable sample
ID alone as the evidence version (the snapshot needs an audit revision or a
canonical content snapshot/hash).

**Durability tier**:
The crediting time horizon a **facility** certifies its biochar against.
Isometric's soil module offers exactly two: *200-year* (modelled from
the H/C_org ratio and soil temperature) and *1000-year* (from random
reflectance R₀ and non-reactive carbon). A facility declares **one**
tier; its **credit batches**, their **Samples**, and its Isometric
**removal template** all inherit it — there is no per-batch or
per-production-process override. There is **no 100-year option** under
the Isometric biochar module — 100-year permanence belongs to other
standards (e.g. Puro / EBC) and to GWP-100, neither of which this system
credits against. _Avoid_: 100-year durability; a per-batch or
per-production-process tier; permanence period as a free-typed value.

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
noma's production-cohort unit of carbon accounting — the production
runs of **one feedstock** at one facility within a ≤1-month window.
This makes a credit batch the Isometric protocol's **production
batch**: the lab-characterisation and sampling unit (one feedstock,
consistent pyrolysis conditions, < 1 month). A facility running
several feedstocks in a month therefore has several **concurrent**
credit batches, one per feedstock. The `startDate`/`endDate` window
means production period, not application period. Batch membership is
production runs — each run one feedstock, matching the batch; member
applications are derived from lineage. On submission, one or more
credit batches group into a single Isometric **Removal** (default 1:1
per cohort). A credit batch's production emissions are claimed by
exactly one Removal — recorded on the batch as the claiming Removal —
so they are never double-counted across entries (ADR 0020).
_Avoid_: batch, issuance; "production batch" as a separate entity —
the credit batch *is* noma's production batch.

**Removal**:
The Isometric **submission unit** — a facility-scoped registry record
of verified, applied-biochar CO₂e accounting, held locally by a
`certifierRemovals` row. **N credit batches map into one Removal.** A
Removal aggregates the deduped union of **production runs** reached
through its member credit batches' application lineage. Attribution
basis splits by emission-input bucket (ADR 0020): **stored** quantities
are ex-post applied-scoped (each run weighted by its applied share);
the **production** bucket submits in full, once, on the claiming
Removal; the **delivery** bucket is applied-scoped.
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

**Measurement-sample submission**:
The Isometric API object noma POSTs to carry a credit batch's durability
chemistry — **one per credit batch**, bearing the batch's **mean +
standard deviation** (its ≥3 **Samples** reduced to a summary; the raw
replicate values are evidenced by the attached COA and the durability
evidence ledger). The registry aggregates the per-batch list server-side.
Deliberately distinct from a noma **Sample**: ≥3 Samples in, **one**
measurement-sample submission out. _Avoid_: calling it a "sample"
unqualified (collides with the lab Sample); submitting raw replicates in
place of the mean + std-dev.

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
The merged lineage of one **credit batch** — every derived member
application's **rollback** combined, production runs deduped,
applied-biochar scoped. Mirrors how a **Removal** aggregates runs. The
chain-of-custody page is anchored on this; a single application's
rollback is its drill-down.
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

### Geography & transport

**Transport distance**:
The road distance (km) of a **transport leg**, fed to Isometric's
distance-based transport equation. A distance computed from coordinates
by the map's routing service is an **estimate** — modeled from a road
graph, not the hauled distance on a bill of lading or weigh ticket. It
is a *suggested default*, always operator-editable, and in the same
measured-vs-derived family as an **emission estimate**. Document-backed
distances (bill of lading, weigh ticket) are the authoritative form.
_Avoid_: treating a routed distance as a measurement.

**Distance source**:
The provenance of a stored distance — `map_estimate` (routed via the
map's routing service), `manual` (hand-entered), or `document`
(bill-of-lading / weigh-ticket backed). Lives wherever a distance can be
written (supplier, customer location, transport leg) and is inherited by
a derived leg from its supplier/customer default. Orthogonal to a leg's
`isDerived` flag. Without a configured routing key there is no
`map_estimate` path — distance entry stays manual.

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
- **N Credit batches** group into one **Removal** (default 1:1 per month)
- A **Credit batch** aggregates many **Production runs**
- A **Removal** is the Isometric submission unit — it aggregates the
  deduped union of **Production runs** reached through its member credit
  batches' application lineage; attribution basis splits by
  emission-input bucket (ADR 0020) — production is claimed in full once
  by the claiming Removal, stored and delivery remain applied-biochar
  scoped
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
