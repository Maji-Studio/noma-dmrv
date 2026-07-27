# The submission ledger is an internal data-access seam tested against real Postgres

> **Status: Accepted, design-only** (2026-06-10). Records a seam-placement
> and test-strategy decision from the certification reliability track
> (`docs/plans/2026-06-10-certification-reliability-track.md`, Phase 1).
> Deliberately narrow: it fixes *where the seam lives and how it is tested*
> for the submission-ledger claim module — not the module's interface
> details, which live in the plan.

## Context

Phase 1 of the certification reliability track deepens the submission-claim
choreography (read latest → decide → mapping lock → re-resolve → re-decide →
insert/reset draft) into one module,
`src/data-access/certification-submissions.ts`, with a single entry point
`claimSubmissionDraft`. A design-it-twice review on 2026-06-10 compared four
candidate interfaces. One was a ports-and-adapters design: the choreography
as a deep module in `lib/` over a five-verb `SubmissionLedgerPort`, a
Drizzle adapter in `data-access/`, and an in-memory adapter for tests, kept
honest by a contract suite run against both adapters.

The port had a real argument: the test suite already fakes this boundary
informally — `vi.mock`'d data-access primitives wrapping hand-rolled
in-memory ledgers, including passing `undefined as never` as the
transaction handle into a locked callback
(`tests/isometric-submit-removal.test.ts:342`). Formalizing that fake as a
typed second adapter looked like an upgrade.

## Decision

The submission ledger remains an **internal data-access seam**. No port, no
in-memory ledger adapter.

- `claimSubmissionDraft` imports `db` directly, like every other
  data-access module.
- The module is tested **DB-backed against real Postgres** via the existing
  vitest harness (`tests/setup.ts` + `.env.test` `DATABASE_URL`), in the
  per-run fixture style of `tests/applications-mutations.test.ts` /
  `tests/isometric-mapping-lock.test.ts`.
- For callers, the function itself is the seam: pipeline tests stub
  `claimSubmissionDraft` (a three-variant outcome union) and the hand-rolled
  in-memory ledger fakes are retired, not formalized.

## Why

The module's load-bearing behavior **is** Postgres semantics, and an
in-memory adapter is structurally blind to exactly the parts that matter:

- **`FOR UPDATE` queueing and READ COMMITTED visibility** — the in-lock
  re-read sees a concurrent winner's row only after that winner commits; a
  linearizable in-memory store shows staged writes, simulating the isolation
  model its author believes in rather than the one Postgres has.
- **Advisory-lock fine print** — `pg_advisory_xact_lock(hashtext(key))` has
  32-bit key collisions, release-at-commit, and session reentrancy; a keyed
  string mutex reproduces none of these.
- **Deadlock semantics** — Postgres detects ABBA and kills a victim with
  `40P01`; an in-memory mutex just hangs the test.
- **Cross-module lock interleaving** — the mapping and mirror locks
  interlock with `mirrorDocumentToSource`, owning-document mapping retirement,
  and admin repoint flows that live *outside* any ledger port. This is the
  exact race the in-lock re-decision exists for, and a fake cannot see those
  code paths at all.

A green in-memory suite would therefore read as confidence about locking
that it cannot supply. And with only one production adapter, the port is
indirection, not a seam — one adapter means a hypothetical seam.

## Consequences

- Claim-module tests require a running Postgres. This is already true for
  the existing DB-backed suites; no new CI infrastructure.
- Pipeline (`fn/`) tests get *simpler*, not heavier: they stub one function
  with a value-shaped outcome instead of six mocked primitives.
- **Revisit if** a second genuine adapter need appears (a different storage
  backend for the ledger), or the DB-backed suite's cost becomes
  prohibitive. Reopen this ADR then — do not introduce a port mid-refactor.
