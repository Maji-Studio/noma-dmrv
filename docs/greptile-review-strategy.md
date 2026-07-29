# Greptile Review Strategy

## Decision

Use Greptile as noma-dmrv's **deep, cross-file correctness reviewer**. Keep
CodeRabbit as the **general PR reviewer** for summaries, walkthroughs, routine
static analysis, style, syntax, and developer workflow.

| Concern | Primary owner |
|---|---|
| Cross-file behavior, domain invariants, authorization, organization isolation, facility workflow scope, accounting, concurrency, idempotency, migrations, and failure paths | Greptile |
| PR summary, changed-file overview, style, syntax, formatting, dependency advice, and tool output | CodeRabbit and CI |
| Product intent, protocol interpretation, risk acceptance, and merge decision | Human reviewer |

This split uses Greptile's repository graph where it can add the most value
without creating two versions of the same review. Greptile documents
`strictness: 1` as the verbose setting and supports limiting output to `logic`
comments; both are set in [the versioned config](../.greptile/config.json)
([Greptile file reference](https://www.greptile.com/docs/code-review/greptile-config-reference)).

## Evidence from the initial rollout

[PR #489](https://github.com/Maji-Studio/noma-dmrv/pull/489) provided a useful
baseline. CodeRabbit was temporarily rate-limited, while Greptile found two
valid test-isolation defects: orphaned application-document rows and a table row
selected by position rather than entity identity. It reran after the fixes and
recognized both as resolved.

Greptile missed the more important cross-consumer contract risk: the regression
test exercised only the list badge while the certification wizard implemented
the same evidence decision separately. The test could therefore stay green
while the original badge-versus-wizard contradiction returned. The repository
rules now explicitly require tracing claims through parallel implementations
and require tests to prove the production path they name.

This example is the calibration target: retain concrete defect detection, but
push Greptile toward system contracts that require repository-wide context.

## Version-controlled configuration

The root [`.greptile/`](../.greptile/) folder is the durable source of review
behavior. Greptile recommends this format over the legacy root `greptile.json`;
it is read on PRs, supports scoped context and rules, and can evolve through the
normal review process
([Greptile configuration](https://www.greptile.com/docs/code-review/greptile-config)).

- [`config.json`](../.greptile/config.json) defines logic-only verbose review,
  target branches, bot exclusions, generated-file exclusions, update reviews,
  a non-blocking status check, compact output, and stable scoped rule IDs.
- [`rules.md`](../.greptile/rules.md) defines the investigation method and the
  small set of cross-cutting domain invariants that apply to the whole tree.
- [`files.json`](../.greptile/files.json) points Greptile to canonical project
  context. Scopes load specialized documents only for relevant changes.

The repository config deliberately disables Greptile's summary, issue table,
confidence section, and sequence diagram. CodeRabbit already owns the PR-level
overview. Greptile should spend its output budget on evidence-backed inline
findings, including comments outside the changed lines when an unchanged caller,
cleanup path, query, or consumer creates the failure.

`triggerOnUpdates` remains enabled so a deep review cannot silently describe an
old commit. Draft reviews are disabled in the dashboard; exploratory commits
should not generate review churn. The `skip-greptile` label is the documented
escape hatch for an exceptional PR, and only PRs targeting `staging` or `main`
are reviewed.

## Canonical context and drift control

Do not copy project policy into reviewer dashboards. The sources of truth are:

- [.claude/CLAUDE.md](../.claude/CLAUDE.md) for repository operations and
  architecture guardrails;
- [CONTEXT.md](../CONTEXT.md) for domain language and entity grain;
- [architecture.md](architecture.md), [security.md](security.md), and
  [database.md](database.md) for system boundaries and persistence invariants;
- specialized evergreen docs and ADRs referenced with scopes in
  [`files.json`](../.greptile/files.json).

When architecture or domain semantics change, update the canonical document in
the same PR. Change a structured Greptile rule only when its measurable invariant
or path scope changes. Stable rule IDs make later narrowing or disabling
traceable.

Changes to `.greptile/**`, `.coderabbit.yaml`, `.claude/CLAUDE.md`, `AGENTS.md`,
`CONTEXT.md`, and the referenced governing docs need explicit human review. A PR
must not be allowed to weaken its own reviewer unnoticed.

Dashboard settings are organization defaults and are less auditable. Keep them
minimal and aligned with the repo posture:

- auto-review updates on; draft reviews off;
- verbose/Low threshold;
- summaries, confidence, issue table, and sequence diagram off;
- comments outside the diff and a non-blocking status check on;
- auto-approve, auto-enable-new-repos, and T-Rex off;
- professional instructions that define Greptile as the deep reviewer.

Repository configuration takes precedence over ordinary dashboard defaults;
organization-enforced rules remain highest priority
([Greptile precedence](https://www.greptile.com/docs/code-review/greptile-config)).
Do not add enforced organization rules unless a policy truly must apply to every
repository and cannot be safely overridden.

## Operating model

For every finding:

1. Verify the execution path, invariant, and consequence against the actual
   code. AI findings are evidence, not authority.
2. Fix valid findings with the smallest safe change and focused regression
   coverage.
3. Reply briefly to false positives and provide negative feedback. Positive
   feedback should mark genuinely useful findings.
4. If both bots report the same root cause, resolve it once. Do not create two
   remediation threads.
5. Confirm the latest commit has completed review before merge.

Greptile learns from reactions and explanatory replies, but stable policy belongs
in version control. Do not teach permanent rules conversationally in both bots;
promote them to the canonical docs or `.greptile/` instead
([Greptile learning](https://www.greptile.com/docs/code-review/training-the-learning-system),
[CodeRabbit learnings](https://docs.coderabbit.ai/knowledge-base/learnings)).

Keep Greptile advisory during calibration. The status check is intentionally
non-blocking and auto-approval remains disabled. Make it a required merge check
only after it reliably reviews the latest head and outages or filters cannot
deadlock normal work.

## Maintenance

Review weekly for the first month:

- actionable findings divided by all Greptile findings;
- duplicates already reported by CodeRabbit or CI;
- false positives grouped by rule ID;
- high-impact issues found only by Greptile;
- missed reruns on later commits and review latency.

Tighten a noisy rule or scope before reducing depth. Keep logic-only comments.
Move strictness from `1` to `2` only if scoping and feedback cannot produce an
acceptable signal-to-noise ratio. When Greptile misses an important issue, add a
measurable rule or a targeted context file before enabling style or syntax
comments.

Quarterly:

- compare Greptile-only, CodeRabbit-only, duplicate, and human-only findings;
- review learned behavior for conflicts with versioned policy;
- validate both JSON files against the current Greptile reference;
- confirm every referenced file and scope still matches the module layout;
- inspect Greptile and CodeRabbit release notes for changed defaults;
- review GitHub App access, branch protection, and enabled repositories;
- run a disposable sentinel PR for auth scope, migration safety, form
  round-trips, and certification idempotency, then close it without merging.

The setup is healthy when CodeRabbit supplies a readable general review while
Greptile's comments are predominantly concrete runtime, data-integrity,
authorization, and domain-invariant findings on the latest PR head. Security
reviews must name Organization isolation as the tenant boundary; a missing
facility predicate is a workflow-scope defect unless it also enables
cross-organization access.
