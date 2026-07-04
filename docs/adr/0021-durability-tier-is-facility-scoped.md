# Durability tier is declared per facility, inherited downward

Status: accepted (2026-07-04)

A **durability tier** (Isometric's *200-year* vs *1000-year* soil-permanence
horizon) is now declared **once per facility** and inherited by everything below
it — the facility's **credit batches**, their **Samples**, and the facility's
Isometric **removal template**. `facility.durabilityOption` is the single source
of truth; the former per-batch `creditBatch.durabilityOption` column is removed
and tier is read from the facility wherever needed. The facility field was
previously a non-authoritative *default* (`defaultDurabilityOption`) that merely
pre-filled an independently-editable per-batch toggle.

## Considered options

- **Per production process (physically correct).** Tier eligibility is set by
  feedstock + pyrolysis conditions — exactly the boundary of a *production
  process* (CONTEXT.md) — so a facility running a high-temperature coffee-husk
  process (1000-year-capable) and a woodchip process (200-year) could differ.
  Rejected as **too complex to manage** for the current product stage.
- **Per credit batch (the prior model).** Maximum flexibility, but nothing tied
  the batch's declared tier to the facility's Isometric removal template, which
  is the concrete bug this decision closes (a 200-year batch submitted against a
  1000-year-authored template, failing with a misleading missing-INPUT_MAPPING
  error).
- **Per facility (chosen).** Simplest to reason about and to keep the removal
  template, batches, and samples in agreement. One tier per facility.

## Consequences

- A facility that genuinely produces both tiers must pick one (conservatively) or
  be modelled as two facilities. Accepted trade for simplicity.
- The Isometric removal template is not auto-selected; submission **validates**
  that the template's `co2-stored` sequestration blueprint matches the facility
  tier and fails closed early with an actionable message otherwise.
- Product framing (2026-07-04): **1000-year is the available tier**; 200-year is
  surfaced but disabled ("available later") in the facility / durability UI. This
  is independent of the durability *submission* staging gate
  (`DURABILITY_MEASUREMENT_SAMPLES_LIVE`), which still gates all live durability
  POSTs. Refines ADR 0013 (registry-computed durable fraction) and ADR 0016
  (credit batch = production batch); does not change who computes `F_durable`.
