# Greptile replacement: Codex PR reviewer research

**Research date:** 2026-07-29
**Status:** Decision recommendation, not an implementation specification

## Executive recommendation

Yes, we can replace the useful part of Greptile. The recommended path is a
two-stage rollout:

1. **Enable Codex Cloud automatic reviews now** as the immediate safety net.
   OpenAI's built-in GitHub integration can review every new PR, reads applicable
   `AGENTS.md` rules, and posts a normal GitHub review. This is the smallest
   operational surface and uses the Codex/ChatGPT integration rather than a
   repository API key. Its documented limitation is important: GitHub reviews
   report only P0/P1 findings, and the public setup does not document an exact
   model pin. It is therefore a good high-severity backstop, not a full Greptile
   clone. [OpenAI: Codex code review in GitHub][codex-cloud-review]
2. **Build a custom, advisory reviewer for the Greptile-depth pass** after a
   short calibration period. Pin `gpt-5.6-sol`, reuse the existing `.greptile`
   deep-review rules and scoped canonical documents, run Codex read-only, emit
   structured findings, and publish only findings that survive deterministic
   validation and deduplication. OpenAI explicitly supports custom PR bots with
   `openai/codex-action`, including a model, reasoning effort, permission
   profile, structured output, and a separate feedback job. [OpenAI:
   codex-action][codex-action]

Do **not** make the reviewer browse the web or rewrite its own rules while it is
reviewing a PR. Fresh vulnerability data and stack guidance should enter through
a separate, allowlisted updater that proposes a normal, human-reviewed PR.
Known-vulnerability matching should remain deterministic through Dependabot,
the GitHub Advisory Database, and optionally OSV; the model explains application
impact but does not decide whether a version range matches an advisory.

For this private repository, a GitHub Actions MVP is reasonable if it reviews
only trusted same-repository PRs. If "every PR" later includes untrusted public
forks, move the inference boundary to a small GitHub App/service that fetches
blobs through the GitHub API into an ephemeral container. Do not expose an API
credential or a persistent self-hosted Codex login to fork-controlled workflows.

## Why this fits the repository

The repository has already done much of the expensive product-design work:

- [`.greptile/rules.md`](../../.greptile/rules.md) defines a strong
  repository-wide investigation protocol and domain-critical invariants.
- [`.greptile/config.json`](../../.greptile/config.json) defines stable rule IDs
  for authorization, facility isolation, lineage, certification immutability,
  transactionality, exact decimal/time handling, migrations, safe failures,
  cache coherence, and regression-test quality.
- [`.greptile/files.json`](../../.greptile/files.json) maps changes to canonical
  context such as `CONTEXT.md`, architecture, auth, security, database, forms,
  testing, storage, traceability, Isometric routing, and relevant ADRs.
- [`docs/greptile-review-strategy.md`](../greptile-review-strategy.md) already
  assigns deep cross-file correctness to Greptile, routine syntax/style and PR
  overview to CodeRabbit/CI, and intent/risk acceptance to a human.

The replacement should preserve that split. It should not become a second
linter, formatter, dependency bot, or PR summarizer.

The current stack also demonstrates why model memory cannot be the freshness
mechanism. `package.json` pins Next.js `16.2.11`, the patched Active LTS version
from the July 2026 security release, while `docs/modern-patterns.md` still says
`16.2.6`. The Next.js release addressed four high- and five medium-severity
issues. This is ordinary documentation drift, not a model-quality problem.
[Next.js: July 2026 security release][next-july-security]

There is a second, actionable supply-chain mismatch to resolve independently of
the reviewer: every current GitHub workflow installs pnpm 9, but
`minimumReleaseAge` was added only in pnpm 10.16.0. The repo's
`minimumReleaseAge: 4320` intent is therefore not enforced by the documented
pnpm version in CI. pnpm documents that this setting delays all direct and
transitive versions and is specifically intended to reduce compromised-release
risk. [pnpm settings: `minimumReleaseAge`][pnpm-settings]

## Options considered

| Option | Exact `gpt-5.6-sol` pin | Project rules | Inline/state control | Credential posture | Recommendation |
|---|---:|---:|---:|---|---|
| Codex Cloud automatic review | Not publicly documented | `AGENTS.md` | Managed, P0/P1 only | GitHub/Codex integration | **Enable now** |
| Custom `openai/codex-action` workflow | Yes | Full control | Full control | API credential; harden carefully | **Build as MVP for trusted PRs** |
| External GitHub App + ephemeral workers | Yes | Full control | Full control | Best isolation; more operations | **Target if forks or multiple repos matter** |
| Persistent self-hosted runner using a personal Codex login | Usually | Full control | Full control | Persistent subscription token near untrusted code | **Do not use** |
| CodeRabbit + deterministic CI only | No | Existing CI rules | Existing | Existing | Keep as complement, not replacement |

### Codex Cloud automatic review

OpenAI documents a repository toggle for automatic reviews. Codex reviews the
diff, follows repository guidance, and searches for applicable root and nested
`AGENTS.md` files. The same documentation recommends concise, durable,
repository-specific rules and explicitly says to leave mechanical checks to CI.
That aligns closely with the existing Greptile strategy.
[OpenAI: Codex code review in GitHub][codex-cloud-review]

Advantages:

- minimal code and credential management;
- automatic review on new PRs;
- normal GitHub review UX;
- likely the cleanest way to use subscription-backed Codex capacity.

Limits:

- public documentation says GitHub output is restricted to P0/P1;
- no public guarantee found that the repository can pin `gpt-5.6-sol`;
- no documented custom fingerprint/state API for Greptile-like rerun behavior;
- rules must be adapted into `AGENTS.md`, so scoped `.greptile/files.json`
  retrieval is not directly reusable.

Use it immediately, but evaluate it as a serious-defect backstop rather than
assuming it replaces the existing deep-review contract.

### Custom Codex Action

`openai/codex-action@v1` is the official programmable route. It installs Codex,
uses a proxy to the Responses API, accepts `model`, `effort`, a read-only
permission profile, a prompt file, and a JSON output schema, and returns the
final message for a separate publishing job. OpenAI's example checks out the PR
merge commit with credentials disabled and separates inference from the job that
has `pull-requests: write`. [OpenAI: Codex GitHub Action][codex-action-docs]

This route can pin `gpt-5.6-sol`. OpenAI currently describes it as the flagship
model for complex reasoning and coding, with a 1.05M-token context window and
API pricing of $5/M input tokens, $0.50/M cached input tokens, and $30/M output
tokens. Inputs above 272K tokens receive higher pricing, which is another reason
not to dump the whole repository into every prompt. [OpenAI: GPT-5.6 Sol
model][gpt-56-sol]

The Action route is API-billed. It should not be described as free merely
because interactive Codex use is flat-rate in this team's current setup. A
personal subscription login on a persistent runner would blur identity,
quota, revocation, and isolation boundaries and is not an acceptable CI secret.

### External GitHub App

A small App is the cleanest long-term Greptile analogue:

1. receive the PR webhook;
2. validate repository, installation, target branch, actor, and current head SHA;
3. fetch the base policy/context and PR blobs through a read-only installation
   token;
4. place them in a fresh, network-isolated container without credentials;
5. run Codex with `gpt-5.6-sol`;
6. validate structured results;
7. use a different, narrowly scoped installation token to publish the review.

This avoids secrets in PR-controlled workflows and handles forks consistently.
It adds service deployment, webhook verification, queues, storage, and
observability, so it is premature for a single private repository unless the
Actions MVP reveals a real security or reliability limitation.

## Recommended architecture

```text
Trusted base policy                         Untrusted PR evidence
AGENTS / .greptile rules                    title/body/commits/diff/head files
CONTEXT + scoped evergreen docs             screenshots/docs/comments/tests
          |                                           |
          +------------------+------------------------+
                             |
                    read-only inference job
                 gpt-5.6-sol, high effort
              no network, no writes, no secrets
                             |
                    schema-validated findings
                             |
              stale-SHA / line / fingerprint checks
                             |
                 separate GitHub publishing job
                   COMMENT review, no approval
```

### 1. Trigger and scope

Run on:

- `pull_request` activity `opened`, `synchronize`, `reopened`, and
  `ready_for_review`;
- base branches `staging` and `main`;
- non-draft PRs;
- no `skip-codex-review` label;
- no bot authors by default, matching current Greptile policy.

Use a PR-number concurrency group with `cancel-in-progress: true`, then verify
the current PR head SHA immediately before publishing. GitHub supports canceling
superseded runs through workflow concurrency; this prevents paying to finish a
review that can only comment on an obsolete head. [GitHub Actions:
concurrency][github-concurrency]

Keep the current 100-file limit as the first guardrail. Also cap changed bytes,
generated files, total model wall time, and output count. A large PR should get a
single "manual deep review required" status rather than a shallow, expensive
pretence at completeness.

### 2. Trusted project knowledge

Build the system prompt from the **base SHA**, not the PR head:

1. authoritative repo instructions;
2. `.greptile/rules.md`;
3. the structured rules whose path scope intersects the changed files;
4. canonical files selected through `.greptile/files.json`;
5. a compact stack-freshness snapshot applicable to the versions in the base
   `package.json`;
6. deterministic advisory matches for the base and candidate lockfiles.

The PR head remains readable as evidence. Its `AGENTS.md`, docs, comments,
commit messages, and configuration are not allowed to change the reviewer's
instructions during that run. If the PR legitimately changes reviewer policy,
the new policy takes effect only after merge.

This preserves the existing "canonical docs, not dashboard copies" principle
and avoids indexing the entire repository. Codex can use read-only searches to
trace callers, callees, schemas, queries, and parallel implementations as the
existing rules require.

For Codex Cloud's built-in reviewer, copy only the smallest durable subset into
a root `## Code Review Rules` section in `AGENTS.md`, with nested rules only
where a module genuinely needs them. OpenAI recommends two or three concise
outcome-oriented rules to start, followed by calibration on representative PRs.
[OpenAI: custom Codex review rules][codex-cloud-review]

### 3. Inference

Suggested baseline:

- model: `gpt-5.6-sol`;
- reasoning effort: `high`;
- permission profile: read-only;
- network: disabled;
- repository writes: disabled;
- approval requests: disabled;
- no dependency installation and no execution of PR code;
- timeout: 20 minutes;
- maximum actionable findings: 10;
- review type: logic/correctness only.

OpenAI recommends benchmarking reasoning levels on representative work rather
than assuming the maximum is best. Start at `high`, compare `medium`, and retain
`high` only where the measured defect yield justifies its latency and spend.
[OpenAI: GPT-5.6 guidance][gpt-56-guide]

The model's required output should be JSON, not ready-to-post Markdown:

```json
{
  "head_sha": "40-char SHA",
  "findings": [
    {
      "rule_id": "enforce-auth-and-facility-scope",
      "priority": "P1",
      "path": "src/data-access/example.ts",
      "start_line": 42,
      "end_line": 44,
      "title": "Foreign facility ID bypasses the scoped query",
      "execution_path": "server action -> data-access update -> SQL predicate",
      "violated_invariant": "All writes are organization and facility scoped",
      "consequence": "A stale ID can mutate another facility's row",
      "evidence": ["src/fn/example.ts:31", "src/data-access/example.ts:42"]
    }
  ]
}
```

Do not ask for a confidence score. Require the execution path, violated
invariant, and observable consequence already specified by the Greptile rules.
The publisher, not the model, assigns the stable fingerprint.

### 4. Finding validation, state, and deduplication

Before publishing:

1. reject output whose `head_sha` is no longer current;
2. reject paths outside the repository or lines absent from the candidate;
3. verify that an inline anchor is part of the GitHub diff; otherwise place it
   in the review body with a file/line reference;
4. collapse findings sharing one root cause;
5. hash a normalized tuple such as
   `rule_id + path + nearest symbol + violated invariant + root-cause text`;
6. query prior bot reviews/comments for that fingerprint;
7. publish only new findings for the current head.

Every machine-authored body should contain a hidden marker:

```html
<!-- noma-codex-review:v1 fingerprint=<sha256> head=<sha> -->
```

Maintain one sticky summary comment with:

- latest reviewed SHA;
- run status and duration;
- active finding fingerprints;
- findings resolved since the prior head;
- skipped/oversized reason, if applicable.

For persistent findings, keep the original discussion thread and mark it still
active in the sticky summary instead of posting a duplicate inline comment.
For resolved findings, update the summary once; do not delete history.

Publish a single `COMMENT` review tied explicitly to the current `commit_id`.
GitHub's review API supports a review body plus multiple line comments and warns
that comments tied to older commits can become outdated. It requires only
`pull requests: write`. [GitHub REST: create a PR
review][github-create-review]

The bot should never auto-approve or request changes during calibration. Its
workflow check means "latest head was reviewed successfully," not "the model
authorizes merge."

### 5. Privilege separation

Use three logical jobs, whether they are GitHub Actions jobs or service stages:

| Stage | Reads | Writes | Secrets |
|---|---|---|---|
| Collect | PR diff/head, base context | ephemeral artifact only | none |
| Infer | ephemeral checkout/artifact | structured result only | inference credential behind proxy only |
| Publish | validated result + current PR metadata | PR review/comment/check | short-lived GitHub token only |

OpenAI warns that PR titles/bodies, hidden HTML comments, commit messages,
repository instruction files, and screenshots can all carry prompt injection.
Its Action guidance says to use the narrowest permission profile, avoid shell
interpolation, drop `sudo`, and run the Action last in its job because the model
may alter host state. [OpenAI: codex-action security][codex-action-security]

For the inference job:

- use `safety-strategy: drop-sudo`;
- use a read-only permission profile;
- pass untrusted GitHub fields through environment variables or data files,
  never direct `${{ }}` expansion inside shell scripts;
- make Codex the last step in that job;
- pass only the structured output to a fresh publisher job;
- pin every third-party Action to a full commit SHA, matching current CI
  practice.

GitHub likewise recommends default read-only permissions and warns that
`pull_request_target` or `workflow_run` combined with untrusted code can expose
write privileges, secrets, or caches. Do not solve fork access by checking out
and executing the fork under `pull_request_target`. [GitHub Actions: secure
use][github-secure-use]

### 6. Authentication

For an initial Action MVP, use a dedicated OpenAI project/service-account
credential with:

- model-request permission only;
- a project spend cap and alerts;
- no unrelated API resources;
- rotation separate from personal credentials.

OpenAI now supports GitHub Actions workload identity federation: GitHub exchanges
an OIDC token for a short-lived OpenAI token, and mappings can assert exact
`repository`, `ref`, and `workflow_ref` claims. OpenAI recommends
`workflow_ref` over the mutable workflow name. Prefer this when the chosen
Codex runner officially supports the exchange flow; otherwise use a small
Responses/SDK wrapper rather than inventing an undocumented token handoff to
`codex-action`. [OpenAI: WIF for GitHub Actions][openai-wif]

The OpenAI project boundary also matters for source confidentiality. OpenAI
states that API data is not used for training unless the customer opts in, but
default abuse-monitoring logs can retain customer content for up to 30 days.
Eligible customers can request Modified Abuse Monitoring or Zero Data
Retention. Confirm the project's data-control setting before sending the private
repository. [OpenAI: API data controls][openai-data-controls]

### 7. Fork and bot behavior

GitHub does not pass normal secrets to workflows triggered by fork PRs, gives
their `GITHUB_TOKEN` read-only permissions, and treats Dependabot PRs like fork
PRs. [GitHub Actions: fork behavior][github-events]

Therefore:

- **same-repository trusted PR:** automatic custom review;
- **Dependabot PR:** deterministic dependency/security checks by default; a
  custom model review only if the inference boundary is external;
- **untrusted fork PR under Actions MVP:** collect and run ordinary no-secret
  CI, then require a maintainer-controlled manual review trigger or skip with a
  visible status;
- **untrusted fork PR under GitHub App architecture:** automatic review is safe
  because the App, not the fork workflow, owns credentials and no PR code is
  executed.

Do not set `allow-users: "*"`. OpenAI explicitly warns that this can turn an
Action into an API-quota abuse endpoint. [OpenAI: codex-action
security][codex-action-security]

## Fresh stack knowledge without unsafe self-modification

### Separate vulnerability intelligence from practices

These are different data products and should have different update paths.

#### Vulnerabilities: deterministic and continuous

Primary mechanisms:

1. **Dependabot alerts and security updates** for the actual dependency graph.
   GitHub raises alerts when an advisory is added or the dependency graph
   changes; security updates can open a PR to the minimum patched version.
   [GitHub: Dependabot alerts][dependabot-alerts] [GitHub: security
   updates][dependabot-security-updates]
2. **GitHub Advisory Database/API** for scheduled queries and provenance.
   GitHub-reviewed advisories are curated and mapped to supported ecosystem
   packages; the REST API can query global advisories by ecosystem, package,
   severity, and time. [GitHub Advisory Database][github-advisory-db]
   [GitHub global advisory API][github-advisory-api]
3. **OSV batch API** as an optional second source, queried by concrete package
   version. It provides `/v1/querybatch` and vulnerability records.
   [OSV API][osv-api]
4. **pnpm audit** as a lockfile/package check once the repository upgrades to a
   supported pnpm. pnpm 11 uses the registry bulk advisory endpoint and
   machine-readable JSON. [pnpm audit][pnpm-audit]

The model receives only the matched advisory IDs, affected package/version,
fixed version, severity, official summary, and source URL. It may determine
whether changed application code makes the impact reachable, but it may not
override the semver match.

Cadence:

- Dependabot/advisory alerts: continuous;
- scheduled advisory reconciliation: daily;
- critical/high match: open or update a remediation PR immediately;
- weekly report only when there is drift, an unfixable advisory, or an
  acknowledged exception nearing expiry.

The current `.github/dependabot.yml` intentionally disables routine version
updates with `open-pull-requests-limit: 0`; GitHub documents that security
updates can still operate when enabled in repository settings. Verify that the
dependency graph, alerts, and security updates are enabled in Settings.
[GitHub: Dependabot configuration][dependabot-config]

#### Best practices: curated and human-reviewed

Maintain a small source manifest, for example:

```yaml
next:
  package: next
  official_docs: https://nextjs.org/docs
  releases: https://nextjs.org/blog
  advisories: https://github.com/vercel/next.js/security/advisories
  refresh: weekly
drizzle:
  package: drizzle-orm
  official_docs: https://orm.drizzle.team/docs/overview
  releases: https://github.com/drizzle-team/drizzle-orm/releases
  refresh: monthly
```

Add entries for React, Better Auth, Drizzle, Zod, React Hook Form, TanStack
Query/Table, Tailwind, Base UI, AWS SDK, Playwright, Vitest, and TypeScript.
Sources must be owned by the project or be an official specification/API.

A scheduled updater should:

1. read the dependency versions from the default branch;
2. fetch only allowlisted official docs, release notes, and security advisories;
3. compare source content hashes and version applicability;
4. generate a proposed delta with exact citations, retrieval time, applicable
   version range, and expiry/recheck date;
5. open one normal PR;
6. run the same CI and sentinel reviewer evaluations;
7. require human approval for changes to reviewer policy or trusted knowledge.

It must never:

- merge its own PR;
- change `.github/workflows/**`, `AGENTS.md`, `.greptile/**`, `CONTEXT.md`, or
  governing docs without designated review;
- treat generated prose as instruction before merge;
- browse arbitrary search results or community posts;
- lower a security rule because a framework default changed;
- silently replace project-specific policy with upstream preferences.

Suggested cadence:

| Knowledge | Cadence | Triggered refresh |
|---|---|---|
| Next.js/React/Better Auth advisories | daily machine check | any advisory or package update |
| Other direct dependencies | daily machine check | any advisory or package update |
| Next.js/React official practice delta | weekly | package minor/major update |
| Other stack practice delta | monthly | package minor/major update |
| Reviewer rules and source allowlist | quarterly | material false positive/negative |
| Canonical project docs | change-driven | architecture/domain PR |

Next.js now has regular security releases, and its official upgrade guide
provides a `pnpm next upgrade` path for current versions. These are good inputs
to a proposal workflow, not authorization for unattended upgrades.
[Next.js upgrade guide][next-upgrade]

## Cost, timeout, and concurrency

The repository contains roughly 11.8 MB of relevant TypeScript, Markdown, JSON,
and workflow text across `src`, `tests`, `docs`, `.greptile`, and `.github`.
Sending all of it every time would exceed the model's context window or cross
the 272K-token higher-price threshold. Retrieval must be scoped.

At current list prices:

- 150K uncached input tokens + 5K output tokens is approximately **$0.90** for
  one model response;
- 16 reviews at that size are approximately **$14.40**;
- synchronize-triggered reruns, tool turns, and reasoning tokens can materially
  increase the actual total.

Those figures are planning examples, not a budget promise. Record actual input,
cached input, output, duration, cancellation, and findings per run. Set an
OpenAI project monthly spend limit before rollout.
[OpenAI: GPT-5.6 Sol model and pricing][gpt-56-sol]

Recommended controls:

- one active run per PR; cancel superseded runs;
- 20-minute hard timeout;
- one automatic retry only for transient provider errors;
- 100-file and changed-byte limits;
- no review on drafts or bot PRs by default;
- compact trusted prefix and scoped context;
- no second "verify the reviewer" model call until evaluation shows it improves
  precision enough to justify the cost;
- skip unchanged fingerprints on update reviews;
- do not block ordinary CI while waiting for the advisory reviewer.

## Rollout and evaluation

### Phase 0: immediate backstop

- Enable Codex Cloud code review and Automatic reviews.
- Add a minimal root `## Code Review Rules` section derived from the highest
  value existing Greptile invariants.
- Confirm GitHub App permissions and disable any unnecessary write ability for
  review-only operation.
- Keep Greptile config intact as the source material during transition.

### Phase 1: offline evaluation

- Build a corpus from historical PRs, starting with PR #489 and other PRs with
  known Greptile, CodeRabbit, CI, and human findings.
- Include synthetic sentinel changes for:
  - missing `requireOrgScope`;
  - facility filter omitted from an aggregate;
  - certification source mutated after submission;
  - check-then-write stock race;
  - decimal-to-float credit calculation;
  - timezone boundary;
  - edited historical migration;
  - positional test selector;
  - prompt injection in an `AGENTS.md`, PR body, commit message, and code
    comment.
- Measure actionable precision, known-defect recall, duplicates, review
  completion on latest SHA, latency, and cost.

### Phase 2: shadow custom Action

- Run the custom reviewer on trusted PRs.
- Publish one sticky summary but no inline findings for one to two weeks.
- Compare against Codex Cloud, CodeRabbit, CI, and humans.
- Tune scopes and rules before tuning model effort.

### Phase 3: advisory inline review

- Post validated inline `COMMENT` reviews.
- Keep status non-blocking for at least a month.
- Require human verification of every finding, as current repository guidance
  already requires.
- Track findings by stable rule ID and fingerprint.

### Phase 4: optional merge check

Only consider making "latest head reviewed" required after:

- reruns are reliable;
- stale reviews cannot publish;
- false-positive rate is acceptable by rule;
- provider outages have a documented maintainer bypass;
- the bypass is auditable and cannot be set by an untrusted PR author.

Even then, require review completion, not model approval. Product intent,
protocol interpretation, and merge responsibility remain human.

## Acceptance criteria

The custom reviewer is ready to replace Greptile when:

- it reviews every eligible latest PR head or records an explicit skip reason;
- it cannot execute PR code, reach arbitrary networks, or access a publishing
  token during inference;
- PR-controlled instructions cannot replace base-branch reviewer policy;
- every inline comment maps to a valid current diff anchor;
- persistent findings do not create duplicate threads;
- at least 80% of comments are actionable during the calibration window;
- known high-impact sentinel defects are reliably found;
- deterministic dependency tooling, not the LLM, owns CVE/version matching;
- knowledge updates arrive only through cited, human-reviewed PRs;
- monthly cost and p95 latency stay within agreed budgets.

## Decision

Adopt **Codex Cloud automatic review immediately**, then build the **custom
gpt-5.6-sol Action reviewer as an advisory MVP for trusted same-repository PRs**.
Preserve CodeRabbit and deterministic CI. Add the external GitHub App boundary
only if untrusted forks, multiple repositories, or credential isolation justify
the operational cost.

The next implementation ticket should cover only Phase 0 and the Phase 1
evaluation harness. Do not build publishing/state machinery until the historical
corpus demonstrates that the custom pass finds meaningful issues beyond the
built-in P0/P1 review and CodeRabbit.

## Primary sources

- [OpenAI: Codex code review in GitHub][codex-cloud-review]
- [OpenAI: Codex GitHub Action][codex-action-docs]
- [OpenAI: codex-action source and inputs][codex-action]
- [OpenAI: codex-action security guidance][codex-action-security]
- [OpenAI: GPT-5.6 Sol][gpt-56-sol]
- [OpenAI: GPT-5.6 model guidance][gpt-56-guide]
- [OpenAI: GitHub Actions workload identity federation][openai-wif]
- [OpenAI: API data controls][openai-data-controls]
- [GitHub Actions secure use reference][github-secure-use]
- [GitHub workflow events and fork behavior][github-events]
- [GitHub Actions concurrency][github-concurrency]
- [GitHub REST pull request reviews][github-create-review]
- [GitHub Advisory Database][github-advisory-db]
- [GitHub global advisory API][github-advisory-api]
- [GitHub Dependabot alerts][dependabot-alerts]
- [GitHub Dependabot security updates][dependabot-security-updates]
- [GitHub Dependabot configuration][dependabot-config]
- [OSV API][osv-api]
- [pnpm audit][pnpm-audit]
- [pnpm dependency-resolution security settings][pnpm-settings]
- [Next.js July 2026 security release][next-july-security]
- [Next.js upgrade guide][next-upgrade]

[codex-cloud-review]: https://developers.openai.com/codex/integrations/github/
[codex-action-docs]: https://developers.openai.com/codex/github-action
[codex-action]: https://github.com/openai/codex-action
[codex-action-security]: https://github.com/openai/codex-action/blob/main/docs/security.md
[gpt-56-sol]: https://developers.openai.com/api/docs/models/gpt-5.6-sol
[gpt-56-guide]: https://developers.openai.com/api/docs/guides/latest-model
[openai-wif]: https://developers.openai.com/api/docs/guides/workload-identity-federation/github-actions
[openai-data-controls]: https://developers.openai.com/api/docs/guides/your-data
[github-secure-use]: https://docs.github.com/en/actions/reference/security/secure-use
[github-events]: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
[github-concurrency]: https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency
[github-create-review]: https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request
[github-advisory-db]: https://docs.github.com/en/code-security/concepts/vulnerability-reporting-and-management/github-advisory-database
[github-advisory-api]: https://docs.github.com/en/rest/security-advisories/global-advisories
[dependabot-alerts]: https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-alerts
[dependabot-security-updates]: https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates
[dependabot-config]: https://docs.github.com/en/code-security/concepts/supply-chain-security/about-the-dependabot-yml-file
[osv-api]: https://google.github.io/osv.dev/api/
[pnpm-audit]: https://pnpm.io/cli/audit
[pnpm-settings]: https://pnpm.io/settings#minimumreleaseage
[next-july-security]: https://nextjs.org/blog/july-2026-security-release
[next-upgrade]: https://nextjs.org/docs/app/getting-started/upgrading
