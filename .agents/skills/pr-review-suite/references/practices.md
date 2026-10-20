# Review practices

These practices are independent axes. Never let a pass on one compensate for a
failure on another, and never produce a single cross-practice score.

Every model returns the schema enforced by the orchestrator. Findings must be
introduced by the target diff, actionable, and supported by exact repository
evidence. If there are no material findings, return an empty findings array and
name only meaningful residual risks.

## Standards

Compare the diff with the base branch's documented standards. Cite the governing
file and rule in `basis`. Repository rules override the smell baseline. Skip
mechanical checks already enforced by CI.

Documented-standard breaches may be hard violations. The following Fowler-style
smells are always judgement calls and require a concrete maintenance or
correctness cost:

- **Mysterious Name:** a name does not reveal what the value or behavior means.
- **Duplicated Code:** the same logic shape occurs in multiple changed places.
- **Feature Envy:** code reaches into another module's data more than its own.
- **Data Clumps:** the same fields or parameters repeatedly travel together.
- **Primitive Obsession:** a primitive stands in for a meaningful domain type.
- **Repeated Switches:** repeated conditionals branch on the same kind of value.
- **Shotgun Surgery:** one concern requires scattered edits across the diff.
- **Divergent Change:** one module changes for several unrelated reasons.
- **Speculative Generality:** abstractions or options have no current need.
- **Message Chains:** callers depend on long navigation chains.
- **Middle Man:** a layer mainly delegates without protecting a boundary.
- **Refused Bequest:** an implementation ignores most of its inherited contract.

Prefer the smallest safe fix. Do not manufacture a smell because another
solution is shorter.

## Spec

Use only the discovered issue, PRD, or user-supplied spec as the requirement
source. Quote the relevant requirement in `basis`. Report:

- missing or partially implemented requirements;
- behavior added without a requirement, including scope creep;
- behavior that appears implemented but contradicts the requirement;
- forced implementation where a missing decision or unavailable external
  artifact should have caused a question instead of guessed behavior.

Do not reinterpret repository standards as product requirements. If no spec is
available, skip this practice and report `no spec available`.

## Deep Correctness

Apply the base branch's `.greptile/rules.md`, scoped rules from
`.greptile/config.json`, `GLOSSARY.md`, and the canonical files selected from
`.greptile/files.json`.

Trace changed behavior through callers, validation, server actions,
data-access, persistence, caches, parallel implementations, tests, and external
payloads. Prioritize concrete failures involving:

- authorization, organization and facility isolation;
- lifecycle, lineage, certification immutability, and idempotency;
- transactions, concurrency, retries, and partial failure;
- units, decimals, rounding, dates, and time zones;
- migration safety and existing-row behavior;
- safe errors, secret/PII handling, and fail-closed behavior;
- cache/UI contract coherence;
- tests that do not prove the production path they claim.

For every finding, `basis` must name the violated rule or invariant, `evidence`
must name the execution path, and `problem` must state the observable
consequence. Do not report speculative preferences.

## Design

The orchestrator runs this practice only when the diff changes UI files, and
skips it when the base branch's practices file has no Design section.

Apply, as review criteria:

- `maji-design-app` step 5, "Self-check before the user sees it"
  (provided as `global-skills/maji-design-app/SKILL.md` in the context files):
  filler such as eyebrows, lines under a heading that restate it, helper text
  that repeats the label, and the same fact shown twice. The test for each:
  delete it; would anyone miss it?
- The project design skill's review list and owning docs are provided from the
  base branch in the context files:
  `.agents/skills/<project>-design/SKILL.md` § "Design review (advisory)" and
  the reference file it names. In noma that is `noma-design` and
  `references/design-review.md`.

Judge from the diff and the files it touches. Screenshots in the PR body are
evidence too. A hit from a report-only design check script is a lead to
confirm, not a finding.

`basis` names the rule and its owning doc section. `evidence` gives
`path:line`. `problem` states what the user sees. If a criteria file cannot be
read, say so in `residual_risks` instead of guessing the rule. Do not report
code structure, requirements or correctness here; other practices own them.

## Output and aggregation

Each model report stays separate beneath its practice:

```text
## Standards
### Codex (gpt-6-astra)
### Opus

## Spec
### Codex (gpt-6-astra)
### Opus

## Deep Correctness
### Codex (gpt-6-astra)
### Opus

## Design
### Codex (gpt-6-astra)
### Opus
```

Summarize counts and the worst severity within each practice only. Do not merge
duplicate findings across practices or pick an overall winner.
