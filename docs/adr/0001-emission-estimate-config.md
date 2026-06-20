# Energy submission data uses per-facility admin-configured estimates

> **Status: Accepted, partly superseded.** Shipped as integration-plan Phase
> 3.7 (2026-05-21). ADR 0015 supersedes the per-stage split portion after the
> active removal template moved to a single combined energy measurement point.
> The genset-yield decision remains active.

## Context

The original Isometric removal template split energy into three process stages
(biomass / pyrolysis / biochar) with separate grid-electricity and
diesel-genset components. noma's operators record only one combined
electricity figure and diesel litres per production run — they cannot
meter per stage, and they measure genset output as diesel litres, not
kWh.

## Decision

noma does **not** add per-stage operational columns. Instead, each
facility carries a small **emission-estimate config** — a genset
energy-yield (kWh per litre) and three stage-split percentages — stored
as columns on `certifier_projects` and edited in an admin page. At
submission time the transformer routes the combined per-run electricity
and genset energy across the per-stage template components using that
config.

ADR 0015 later removed the stage-split fields when the active template
collapsed energy to one combined grid-electricity datapoint and one combined
diesel-genset datapoint.

## Why

Splitting energy across stages is **emissions-neutral**: all three
electricity components share one carbon intensity, and all three genset
components share another, so `(a+b+c)×CI = a×CI + b×CI + c×CI`. The
split changes only the per-stage breakdown the registry displays, never
the verified total. Forcing operators to enter per-stage numbers they
cannot measure would be fake precision; a per-facility estimate is
honest about what it is.

## Consequences

- A submission's energy datapoints are only as accurate as the
  configured genset yield. The yield **is** emissions-affecting (unlike
  the now-superseded stage split) and must stay consistent with the LCA's diesel and
  genset carbon intensities (≈3.375 kWh/L).
- Per-reporting-period inputs (staff travel, pyrolyzer gas, lab
  electricity) are **not** covered by this decision — they remain zero
  stubs pending a separate apportionment decision
  (`docs/open-questions.md` → `isometric/phase-3.7-period-inputs`).
- Revisiting this — e.g. if operators gain per-stage metering — means
  adding real columns and is a deliberate, non-trivial change.
