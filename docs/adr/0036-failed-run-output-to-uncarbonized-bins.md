# ADR 0036: Failed run output goes to Uncarbonized biochar bins

## Decision

A Failed production run records output above 0 kg wet, output moisture and an
Uncarbonized biochar bin. A Complete run uses an untagged biochar bin. Every
terminal save validates the effective row, including unchanged saves. Failed
remains available on create.

Both outcomes set `output_posted_at` and add stock layers in the matching bin.
Failed output appears in stock history and supports lost mass and stock counts.
Output edits follow the same dependency locks as Complete runs.

The Complete CHECKs `production_runs_complete_has_output` and
`production_runs_complete_has_output_posted_at` stay unchanged and apply only to
Complete runs. Failed output (wet output above 0 kg, output moisture, an
Uncarbonized biochar bin and `output_posted_at`) is enforced by the application
(lifecycle and data access) on every save, like the bin-tag pairing. Staging
holds Failed runs recorded before this rule. An older Failed run without
output stays readable and must get output on its next save.
Keeping Failed validation in the application also preserves facility archive
and restore cascades on those older rows.

## Rejected alternative

The 2026-09-29 decision returned failed output to feedstock bins through a
separate dump-back flow. Closed PR #1717 proposed that approach. Kenji rejected
it on 2026-11-27 as too complicated. Operators edit the run itself instead.
The no-output and bin-release behavior introduced in PR #1716 is also reversed;
Failed on create stays.

## Consequences

Uncarbonized material stays in the physical stock balance but never counts as
biochar or reaches products, credit batches, removals, certification or Sankey.
Energy activity remains recorded, while Failed output is excluded from biochar
dry mass and energy attribution denominators. Bin tags cannot change once
stock or history exists. Changing a Failed run to Complete requires reopening
it and selecting an untagged bin, subject to stock dependency locks.
