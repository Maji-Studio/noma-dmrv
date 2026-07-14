export const meta = {
  name: 'pr-review-panel',
  description:
    'Multi-model review panel for one PR: gpt-5.6-sol (codex) + a fresh Claude reviewer in parallel, then one adversarial verifier that dedupes and confirms findings',
  whenToUse:
    'Called per-PR by the resolve-open-prs skill; standalone with args {pr, head, base?, context?} after the PR branch is checked out locally',
  phases: [
    { title: 'Review', detail: 'codex + claude reviewers in parallel' },
    { title: 'Verify', detail: 'single adversarial verifier dedupes and confirms', model: 'opus' },
  ],
}

// args may arrive stringified — normalize before use.
const input = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const pr = input.pr
const head = input.head
const base = input.base ?? 'staging'
const context = input.context ?? ''
if (!pr || !head) throw new Error('args must include {pr, head}; optional {base, context}')

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string', description: 'One-paragraph overall assessment' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'title', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          file: { type: 'string' },
          line: { type: 'number' },
          title: { type: 'string' },
          detail: { type: 'string', description: 'Concrete failure mode' },
          suggestedFix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['confirmed', 'rejected'],
  properties: {
    confirmed: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'title', 'detail', 'sources', 'evidence'],
        properties: {
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          file: { type: 'string' },
          line: { type: 'number' },
          title: { type: 'string' },
          detail: { type: 'string' },
          suggestedFix: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string', description: 'file:line proof the defect is real' },
        },
      },
    },
    rejected: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'reason'],
        properties: { title: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
}

const repoRules = `Repo rules that findings must respect (from .claude/CLAUDE.md):
pnpm only; layered architecture components -> hooks -> fn/ ("use server" + Zod) -> data-access/ (auth guard in every function) -> db; ActionResult<T> returns; never log PII; kebab-case files; no file over 1000 lines; no hard-coded magic numbers.`

const target = `PR #${pr}: branch ${head} vs base ${base}. The repo is the current working directory and ${head} is checked out; diff with \`git diff ${base}...${head}\` (fetch origin first if refs are missing).`

phase('Review')
const [codexReview, claudeReview] = await parallel([
  () =>
    agent(
      `You are a thin wrapper around the Codex CLI — do NOT review the code yourself. Read .claude/skills/codex-review/SKILL.md and follow its invocation rules exactly (binary lookup, Mode B custom prompt via stdin, artifact dir). Review target for the prompt's first line: "Target: the diff of branch ${head} against ${base} (git diff ${base}...${head})."
${target}
${context ? `Task context to include in the codex prompt: ${context}` : ''}
Codex can run long: pass an explicit 600000ms timeout to Bash, and if it still times out, re-run in the background and poll for the report file. When the report arrives, translate its findings into the structured output verbatim — raw and UNVERIFIED, do not filter or confirm them. If codex is unavailable or errors after one retry, return findings: [] and explain in summary.`,
      { label: `gpt-5.6:review-pr-${pr}`, model: 'sonnet', effort: 'low', schema: FINDINGS_SCHEMA, phase: 'Review' },
    ),
  () =>
    agent(
      `Fresh independent code review of ${target}
Read the PR body and linked issue first (\`gh pr view ${pr} --json title,body\`; \`gh issue view <n>\` if referenced) so you can judge spec fit, then review the full diff for bugs, regressions, security issues, missing tests, and requirement mismatches.
${repoRules}
${context ? `Task context: ${context}` : ''}
Report findings only — no praise, no summary padding. Every finding needs a concrete failure mode. If the diff is clean, return findings: [] and say so in summary.`,
      { label: `claude:review-pr-${pr}`, model: 'opus', schema: FINDINGS_SCHEMA, phase: 'Review' },
    ),
])

const raw = []
for (const [source, review] of [
  ['gpt-5.6-sol', codexReview],
  ['claude-opus', claudeReview],
]) {
  for (const f of review?.findings ?? []) raw.push({ ...f, source })
}
log(`${raw.length} raw findings (codex: ${codexReview?.findings?.length ?? 'n/a'}, claude: ${claudeReview?.findings?.length ?? 'n/a'})`)

if (raw.length === 0) {
  return {
    mergeReady: true,
    confirmed: [],
    rejected: [],
    reviewerSummaries: { codex: codexReview?.summary ?? 'unavailable', claude: claudeReview?.summary ?? 'unavailable' },
  }
}

phase('Verify')
const verdict = await agent(
  `Adversarially verify this batch of code-review findings for ${target}
False positives are common here, including bogus P0s — your default stance is REJECT unless you can prove the defect against the actual code (cite file:line evidence for every confirmation). First merge findings that describe the same defect (keep the clearest wording, union their sources), then verify each merged finding by reading the code. Style opinions that contradict the repo's documented conventions are rejections, not confirmations.
${repoRules}
Findings (JSON): ${JSON.stringify(raw)}`,
  { label: `verify-pr-${pr}`, model: 'opus', schema: VERDICT_SCHEMA, phase: 'Verify' },
)

const confirmed = verdict?.confirmed ?? raw.map((f) => ({ ...f, sources: [f.source], evidence: 'verifier unavailable — unverified' }))
return {
  mergeReady: confirmed.length === 0,
  confirmed,
  rejected: verdict?.rejected ?? [],
  reviewerSummaries: { codex: codexReview?.summary ?? 'unavailable', claude: claudeReview?.summary ?? 'unavailable' },
}
