# Failed-run returns to uncarbonized bins

Status: Accepted.

## Decision

A failed-run return is a named addition to `bin_movements`, not a fresh intake
or a negative consumption allocation. Original run consumption remains intact.
`failed_run_return` adds measured wet kg to an active uncarbonized feedstock bin
of the same organization, facility and explicitly assigned feedstock type.
Only runs whose consumed allocations resolve to one feedstock type qualify.
Mixed-type returns are refused rather than guessing which material survived.
Tagged bins continue to refuse fresh intake, run draws and formulation draws.

Each return freezes source run version, measured wet consumption, run moisture,
consumed dry mass and allocation IDs, original intake IDs and wet masses in its
snapshot. Actor attribution uses the context user ID, including an immutable
ID snapshot; snapshots contain no names or email addresses. Replay creates a
holding identified by the movement, with its own measured dry-to-wet basis.
Later losses and counts reduce that holding without rewriting material returned
at the run boundary.

Several returns and compatible destinations are allowed. The source run row
lock serializes their shared allowance: total active returned dry grams cannot
exceed consumed dry grams derived from measured wet draws and run moisture.
No tolerance or intake-moisture estimate expands that allowance. Returns may be
wetter and heavier than original wet consumption, for example after quenching.
They must contain positive dry solids, occur at or after run end and not in the
future, and carry a reason and organization-scoped request key.

Corrections append an exact wet/dry reversal with the original moisture basis,
and optionally a freshly validated replacement. Both link to the original;
a partial unique index permits one reversal. No original row is edited or
deleted. Replays skip reversed originals and reversal legs; signed aggregate
balances agree. Later dependent withdrawals, losses and counts prevent correction;
unrelated additions do not. Every affected historical and current wet balance
must remain nonnegative, including both destinations when a correction moves stock.

Writers lock the request first and replay committed matching facts before
mutable eligibility checks. Facility references precede sorted source and
destination bins, the source run, and the existing certification artifact
protocol. All references and history are organization-scoped. Certification
Sent takes precedence, including unknown/in-flight states and earlier Sent
history. Registry return can release Sent but cannot release stock dependencies.

## Lifecycle contract

The lifecycle guards refuse reopening and material-basis changes while
active returns exist, including indirect allocation rewrites. Unchanged
allocations may proceed. Deletion is refused whenever return history exists,
even after full reversal. Reversing every return releases the active dependency,
not its retained audit evidence. The existing Failed to Cancelled refusal stays.

## Boundaries

No re-pyrolysis, transfers, emissions or credit-batch membership changes are
introduced. Future transfers need paired conserved legs carrying the same
provenance. Return, reversal and replacement remain linked movement events;
a return is never labeled intake or stock count. Public REST/MCP commands remain separate work.

## Rejected alternative and reuse

A separate reverse-lineage table was rejected: it would duplicate movement facts
and require a second stock and provenance ledger. The #33 projection reads the
`bin_movements` return rows through `source_production_run_id` and
`feedstock_dry_delta_kg`. The #34 transfers reuse the same table and columns for
paired conserved legs, rather than introducing a separate lineage store.
