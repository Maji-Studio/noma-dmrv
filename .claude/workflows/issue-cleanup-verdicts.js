export const meta = {
  name: 'issue-cleanup-verdicts',
  description: 'Fan out over the open-issue backlog: verify each issue against current code, adversarially check destructive verdicts, collect stakeholder questions',
  whenToUse: 'Phase 1 of the /issue-cleanup skill. Requires a snapshot from scan-issues.mjs. args: { snapshotPath, indexPath, clusters?: [{ key, issues: number[] }] } — pass clusters to scope a run to a subset.',
  phases: [
    { title: 'Cluster', detail: 'partition the backlog into topic clusters', model: 'sonnet' },
    { title: 'Verify', detail: 'one agent per cluster checks every issue against the code' },
    { title: 'Skeptic', detail: 'adversarial refutation of every close/merge verdict' },
  ],
}

// NOTE for linters/reviewers: top-level await/return are the Workflow-runner
// contract for .claude/workflows/*.js — parse-error findings here are false
// positives (see memory: workflow-script-top-level-return).

// Tolerate args arriving as a JSON-encoded string (some callers stringify).
const input = typeof args === 'string' ? JSON.parse(args) : (args ?? {})
const { snapshotPath, indexPath } = input
if (!snapshotPath || !indexPath) {
  throw new Error('args.snapshotPath and args.indexPath are required — run scan-issues.mjs first')
}

const VERDICTS = ['close-implemented', 'close-obsolete', 'merge', 'split', 'enhance', 'grill', 'stakeholder-question', 'keep']
const DESTRUCTIVE = ['close-implemented', 'close-obsolete', 'merge']

const CLUSTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clusters'],
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'issues'],
        properties: {
          key: { type: 'string', description: 'short kebab-case topic slug, e.g. storage-bins' },
          issues: { type: 'array', items: { type: 'integer' }, description: 'issue numbers in this cluster' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'verdict', 'evidence', 'complianceSensitive'],
        properties: {
          number: { type: 'integer' },
          verdict: { type: 'string', enum: VERDICTS },
          evidence: { type: 'string', description: 'file:line refs, PR/commit refs, ADR/protocol refs — the concrete basis for the verdict' },
          complianceSensitive: { type: 'boolean', description: 'true if the issue touches Isometric protocol requirements, GHG math, or src/lib/isometric/' },
          mergeInto: { type: ['integer', 'null'], description: 'for verdict=merge: the canonical (oldest) issue number this one folds into' },
          proposedSlices: { type: ['array', 'null'], items: { type: 'string' }, description: 'for verdict=split: one line per proposed vertical slice' },
          openQuestions: { type: ['array', 'null'], items: { type: 'string' }, description: 'for verdict=grill: what is under-specified' },
          stakeholderQuestion: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['question', 'audience', 'blocks'],
            properties: {
              question: { type: 'string', description: 'the precise decision-ready question' },
              audience: { type: 'string', description: 'who answers it: DEC operators, Isometric, Maji product' },
              blocks: { type: 'string', description: 'what work is blocked until answered' },
              options: { type: ['string', 'null'], description: 'decision options with trade-offs, if enumerable' },
            },
            description: 'for verdict=stakeholder-question (and optionally alongside grill): the question to take to stakeholders',
          },
          staleNotes: { type: ['string', 'null'], description: 'for verdict=enhance: what in the body no longer matches the code' },
        },
      },
    },
  },
}

const REFUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reasoning'],
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    fallbackVerdict: { type: ['string', 'null'], enum: [...VERDICTS, null], description: 'if refuted: the verdict this should be instead (usually keep or enhance)' },
  },
}

const extractCmd = (numbers) =>
  `node -e 'const s=require(${JSON.stringify(snapshotPath)});` +
  `const want=new Set(${JSON.stringify(numbers)});` +
  `console.log(JSON.stringify(s.openIssues.filter(i=>want.has(i.number)),null,1))'`

const contextCmd =
  `node -e 'const s=require(${JSON.stringify(snapshotPath)});` +
  `console.log(JSON.stringify({recentlyClosedIssues:s.recentlyClosedIssues,recentMergedPRs:s.recentMergedPRs},null,1))'`

// ---------- Phase 1: cluster (skipped when the caller scopes the run) ----------

let clusters = input.clusters
if (!clusters) {
  phase('Cluster')
  const res = await agent(
    `Read the open-issue index at ${indexPath} (Read tool). Partition ALL listed issues into topic clusters of roughly 8–12 issues each (fewer is fine for a leftover cluster). Cluster by domain area — e.g. storage/bins, certification/compliance, forms/UX, tables/list-design, data-integrity/validation, epics/large-features, questions — using the titles and labels. Every issue number appears in EXACTLY one cluster. Return only the clustering.`,
    { label: 'cluster-backlog', schema: CLUSTER_SCHEMA, model: 'sonnet', effort: 'low' },
  )
  clusters = res.clusters
}

// Defensive de-dup: an issue may only be judged once.
const seen = new Set()
clusters = clusters.map((c) => ({
  key: c.key,
  issues: c.issues.filter((n) => (seen.has(n) ? false : (seen.add(n), true))),
})).filter((c) => c.issues.length > 0)
log(`${clusters.length} clusters, ${seen.size} issues`)

// ---------- Phases 2+3: verify each cluster, then refute its destructive verdicts ----------

const verifyPrompt = (c) => `
You are auditing GitHub issues for the noma-dmrv repo against the CURRENT code in the working directory. The issues may be stale: written months ago, possibly already implemented, superseded, duplicated, too big, or under-specified.

Your cluster "${c.key}": issues ${c.issues.map((n) => '#' + n).join(', ')}.

1. Get the full issue data (bodies + comments + closing-PR refs):
   ${extractCmd(c.issues)}
2. Get dedup/shipped context (recently closed issues + last 100 merged PRs):
   ${contextCmd}
3. Read CONTEXT.md (domain glossary) and skim docs/adr/ filenames and docs/open-questions.md for decisions that supersede issues in your cluster.
4. For EVERY issue, verify its claims against the actual code (Grep/Read under src/, tests/e2e/) — never trust the issue body's description of the code. Then assign exactly one verdict:
   - close-implemented: the requested behavior already exists. Evidence MUST cite file:line and, when findable, the PR/commit that shipped it.
   - close-obsolete: superseded by an ADR, redesign, or newer issue. Evidence MUST cite the superseding ref.
   - merge: duplicate/overlapping with another OPEN issue. Set mergeInto to the OLDEST issue of the duplicate group (the oldest gets verdict keep/enhance/split, not merge).
   - split: too big to pick up in one PR. Fill proposedSlices with thin vertical slices (each demoable end-to-end).
   - enhance: keep, but the body is stale vs. current code. Fill staleNotes.
   - grill: keep, but under-specified for implementation. Fill openQuestions.
   - stakeholder-question: the issue is primarily an open question that needs an answer from DEC operators, Isometric, or Maji product before any work can proceed (typical for label "question"). Fill stakeholderQuestion with a decision-ready question, audience, and what it blocks.
   - keep: already clear and correct.

COMPLIANCE GUARDRAIL (hard rules):
- Any issue labeled compliance or question, or touching src/lib/isometric/, GHG math, or Isometric protocol requirements: set complianceSensitive=true and check docs/isometric/ (versions.json pins, condition-registry.md, p0-compliance-checklist.md) before judging. Local docs are non-authoritative interpretations; when protocol text decides the verdict, consult the isometric MCP server (ToolSearch "select:mcp__isometric__how_to", call how_to first).
- A complianceSensitive issue is NEVER close-obsolete on code evidence alone — it needs protocol/ADR evidence.
- Issues awaiting Isometric sign-off stay open (stakeholder-question, not close).
- When proposing merge/split of a complianceSensitive issue, acceptance criteria with protocol references must be preserved verbatim in your notes.

Also fill stakeholderQuestion (in addition to the verdict) on any grill/keep/enhance issue whose open questions can only be answered by external stakeholders, not by reading code.

Be conservative: when torn between a destructive verdict (close/merge) and keep, prefer keep — a separate adversarial pass will also try to refute your destructive verdicts, so only make them when the evidence is concrete. Return one verdict object per issue, all ${c.issues.length} of them.`

const refutePrompt = (v, clusterKey) => `
Adversarially verify a proposed backlog action for the noma-dmrv repo (cluster "${clusterKey}"). Proposed: issue #${v.number} gets verdict "${v.verdict}"${v.mergeInto ? ` (merge into #${v.mergeInto})` : ''}.
Claimed evidence: ${v.evidence}

Try to REFUTE this. Steps:
1. Pull the full issue: ${extractCmd([v.number, ...(v.mergeInto ? [v.mergeInto] : [])])}
2. Check the claimed evidence against the actual code (Read/Grep). For close-implemented: does the code REALLY cover every part of the issue, including edge cases and acceptance criteria? For close-obsolete: does the superseding ref actually make this issue moot, or only part of it? For merge: are the two issues truly the same work, or do they only overlap?
3. ${v.complianceSensitive ? 'This issue is compliance-sensitive: verify the evidence includes protocol/ADR grounds (docs/isometric/, docs/adr/), not just code. Code-only evidence for close-obsolete = automatic refute.' : 'Check whether the issue has compliance implications the verdict missed.'}

Default to refuted=true if uncertain — a wrongly-closed issue is worse than a kept one. If refuted, set fallbackVerdict (usually keep, or enhance when the body is merely stale).`

phase('Verify')
const results = await pipeline(
  clusters,
  (c) => agent(verifyPrompt(c), { label: `verify:${c.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }),
  async (res, c) => {
    if (!res) return null
    // NEVER mutate agent/parallel results in place — the runner clones (and may
    // freeze) values crossing the sandbox boundary, so mutations silently vanish.
    // Rebuild the verdict list functionally from a rulings map instead.
    const destructive = res.verdicts.filter((v) => DESTRUCTIVE.includes(v.verdict))
    const byNumber = new Map()
    if (destructive.length) {
      const rulings = await parallel(destructive.map((v) => () =>
        agent(refutePrompt(v, c.key), { label: `skeptic:#${v.number}`, phase: 'Skeptic', schema: REFUTE_SCHEMA })
          .then((r) => ({ number: v.number, r })),
      ))
      for (const item of rulings.filter(Boolean)) byNumber.set(item.number, item.r)
    }
    const verdicts = res.verdicts.map((v) => {
      if (!DESTRUCTIVE.includes(v.verdict)) return { ...v }
      const r = byNumber.get(v.number)
      // An agent that died mid-refute leaves its verdict unvetted — fail safe to keep.
      if (!r) return { ...v, originalVerdict: v.verdict, verdict: 'keep', refutation: 'skeptic agent unavailable — fail-safe downgrade' }
      if (r.refuted) {
        const fallback = r.fallbackVerdict && r.fallbackVerdict !== v.verdict ? r.fallbackVerdict : 'keep'
        return { ...v, originalVerdict: v.verdict, verdict: fallback, refutation: r.reasoning }
      }
      return { ...v, skepticConfirmed: r.reasoning }
    })
    log(`${c.key}: ${verdicts.length} verdicts, ${destructive.length} skeptic-checked`)
    return { cluster: c.key, verdicts }
  },
)

// ---------- merge + summarize ----------

const clustersOut = results.filter(Boolean)
const all = clustersOut.flatMap((r) => r.verdicts.map((v) => ({ ...v, cluster: r.cluster })))
const byVerdict = {}
for (const v of all) byVerdict[v.verdict] = (byVerdict[v.verdict] ?? 0) + 1
const failedClusters = clusters.filter((c) => !clustersOut.some((r) => r.cluster === c.key)).map((c) => c.key)
if (failedClusters.length) log(`NOT COVERED (agent failure — re-run these): ${failedClusters.join(', ')}`)

return {
  totals: byVerdict,
  downgradedBySkeptic: all.filter((v) => v.originalVerdict).map((v) => ({ number: v.number, from: v.originalVerdict, reason: v.refutation })),
  stakeholderQuestions: all.filter((v) => v.stakeholderQuestion).map((v) => ({ number: v.number, ...v.stakeholderQuestion })),
  verdicts: all,
  failedClusters,
}
