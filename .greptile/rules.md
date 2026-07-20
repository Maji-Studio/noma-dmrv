# Deep review protocol

Greptile is the repository-wide correctness reviewer for noma-dmrv. CodeRabbit
and CI remain responsible for general review summaries, formatting, syntax,
linting, dependency advice, and routine style feedback.

## How to investigate a change

1. Reconstruct the intended behavior from `CONTEXT.md`, the applicable evergreen
   documentation, schema constraints, and existing production paths. Treat the
   code as evidence, not automatically as the specification.
2. Trace every changed value through callers, validation, server actions,
   data-access, database state, caches, UI derivations, and outbound provider
   payloads. Inspect parallel implementations of the same rule and flag drift.
3. Look beyond changed lines when the failure is caused by an unchanged caller,
   cleanup path, query, transaction boundary, trigger, fixture, or consumer.
4. Test the change mentally across success, rejection, retry, concurrent update,
   partial external failure, stale client state, archived parents, empty data,
   boundary values, and a different active facility.
5. Before commenting, state the concrete execution path, the invariant that is
   violated, and the observable user, security, accounting, or data consequence.
   Do not report speculative preferences as defects.

## Domain-critical invariants

- Domain terms in `CONTEXT.md` are exact. In particular, a production run is not
  a Removal, a credit batch is a production cohort, and bin stock changes only
  through bin movements.
- Facility context is a workflow boundary even while the application is
  single-organization. Attribution `userId` fields are not tenant boundaries.
- Production-run outcomes have distinct accounting meaning: failed is a real
  material event, cancelled is an event that never happened.
- Archived facility children disappear from lists and options but remain
  hydratable by ID; writes must reject archived parents and codes remain reserved.
- Certification submissions freeze their reachable source data. New or stale UI
  paths must not bypass lineage guards, locks, hashes, or idempotency ledgers.
- Credit-bearing quantities use exact decimal semantics. Conversions, rounding,
  aggregation, units, and null handling must stay consistent across database,
  TypeScript, forms, exports, and registry payloads.
- Readings carry canonical UTC timestamps. Human-entered dates and reporting
  windows must respect the facility timezone without environment-dependent
  parsing or off-by-one boundaries.

## High-value failure patterns

Pay special attention to:

- list/detail/aggregate queries that scope or filter differently;
- read-check-write sequences that are safe only without concurrency;
- multi-row mutations or external calls that can partially succeed;
- duplicated SQL and TypeScript implementations of one readiness or accounting
  rule;
- polymorphic records without foreign keys and cleanup that assumes cascades;
- optimistic cache entries or invalidation keys missing `facilityId`;
- schema defaults, Zod defaults, and create/update defaults that diverge;
- migrations whose snapshots and SQL disagree or that only work on an empty DB;
- provider retries that can create duplicate registry state;
- tests that pass because of row order, shared seed state, or leaked artifacts.

## Comment quality

Keep findings actionable and evidence-based. Do not produce PR summaries,
sequence diagrams, confidence theater, compliments, naming suggestions, style
nits, formatting feedback, or issues already enforced unambiguously by lint,
typecheck, or generated-file checks. Consolidate findings that share one root
cause, and withdraw or update a finding after the PR fixes it.
