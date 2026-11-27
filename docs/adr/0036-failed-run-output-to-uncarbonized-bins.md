# ADR 0036: Failed run output goes to Uncarbonized biochar bins

## Decision

A Failed production run records output above 0 kg wet, output moisture and an
Uncarbonized biochar bin. A Complete run uses an untagged biochar bin. Every
terminal save validates the effective row, including unchanged saves of legacy
rows. Failed remains available on create.

Both outcomes set `output_posted_at` and add stock layers in the matching bin.
Failed output appears in stock history and supports lost mass and stock counts.
Output edits follow the same dependency locks as Complete runs. Older Failed
rows remain readable but must meet these rules when saved. The application
enforces this without new Failed DB CHECK constraints.

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
