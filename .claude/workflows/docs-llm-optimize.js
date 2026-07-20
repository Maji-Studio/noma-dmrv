export const meta = {
  name: 'docs-llm-optimize',
  description: 'De-stale and compress /docs for LLM lookup: verify each doc against code, cut what the code already says, keep it short and cross-linked',
  whenToUse: 'When the evergreen docs in /docs have drifted from the code, or are too long/duplicative for on-demand LLM lookup.',
  phases: [
    { title: 'Audit', detail: 'per-doc: verify every claim against the real code, mark stale/redundant/keep' },
    { title: 'Rewrite', detail: 'per-doc: apply the cuts and corrections in place' },
    { title: 'Stitch', detail: 'cross-doc dedupe, link graph, docs index in CLAUDE.md' },
  ],
}

// Evergreen docs only. ADRs, archive/, plans/, qa/ are out of scope by design:
// ADRs are the durable "why" record and must not be compressed away.
const DOCS = args?.docs ?? [
  'docs/architecture.md',
  'docs/code-style.md',
  'docs/database.md',
  'docs/schema-overview.md',
  'docs/design-system.md',
  'docs/forms.md',
  'docs/testing.md',
  'docs/auth.md',
  'docs/security.md',
  'docs/storage.md',
  'docs/traceability.md',
  'docs/modern-patterns.md',
  'docs/troubleshooting.md',
  'docs/organization.md',
  'docs/mail-setup.md',
  'docs/open-questions.md',
]

// Docs whose value IS the accumulated bug/learning record — prune stale entries,
// but never compress for brevity's sake.
const LEARNING_DOCS = new Set(['docs/troubleshooting.md', 'docs/open-questions.md'])

const HOUSE_RULES = `
House rules for this repo's docs (from .claude/CLAUDE.md and CONTEXT.md):
- The reader is an LLM doing on-demand lookup, not a human reading front-to-back.
  Optimise for: found fast, trusted completely, short enough to load cheaply.
- CUT anything the code already states plainly. A doc should carry intent,
  invariants, gotchas, and pointers — not a restatement of function signatures,
  prop tables, or file listings that will silently rot.
- Prefer a pointer over a paraphrase: \`src/data-access/utils.ts\` beats an inlined copy.
- Prefer a link over a repeat: if another doc or an ADR (docs/adr/) already owns
  a topic, link to it and delete the local copy. ADRs are authoritative for "why".
- Keep domain terms exactly as CONTEXT.md defines them.
- Every doc opens with a one-paragraph "what this covers / when to read it" so a
  lookup can bail out in one read.
- No dated status, no changelog narration, no "we recently...", no TODOs
  (deferred work belongs in docs/open-questions.md).
- Code examples earn their place only when they show a non-obvious convention.
  One canonical example beats three variations.
`

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    doc: { type: 'string' },
    verdict: { type: 'string', enum: ['rewrite', 'light-touch', 'merge-away', 'delete'] },
    mergeTarget: { type: 'string', description: 'If merge-away/delete, the doc that should absorb it' },
    stale: {
      type: 'array',
      description: 'Claims contradicted by the current code, each with the file that disproves it',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          reality: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['claim', 'reality', 'evidence'],
      },
    },
    redundant: {
      type: 'array',
      description: 'Sections to cut: restating code, or owned by another doc/ADR',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string' },
          reason: { type: 'string' },
          replaceWith: { type: 'string', description: 'Pointer or link that replaces it, if any' },
        },
        required: ['section', 'reason'],
      },
    },
    missing: {
      type: 'array',
      description: 'Non-obvious invariants/gotchas present in code but absent from the doc',
      items: { type: 'string' },
    },
    targetLines: { type: 'number', description: 'Realistic post-rewrite line count' },
  },
  required: ['doc', 'verdict', 'stale', 'redundant', 'missing', 'targetLines'],
}

const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    doc: { type: 'string' },
    before: { type: 'number' },
    after: { type: 'number' },
    corrections: { type: 'array', items: { type: 'string' } },
    outboundLinks: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['doc', 'before', 'after', 'corrections', 'outboundLinks'],
}

phase('Audit')
log(`Auditing ${DOCS.length} evergreen docs against the code`)

const results = await pipeline(
  DOCS,

  (doc) =>
    agent(
      `You are auditing \`${doc}\` in the noma-dmrv repo (a biochar carbon-credit MRV app: Next.js 16 App Router, Better Auth, Drizzle/Postgres, Isometric registry integration).

Read the doc in full. Then VERIFY IT AGAINST THE ACTUAL CODE — this is the part that matters. Do not take the doc's word for anything:
- Grep/read the files, exports, tables, routes, env vars, commands and config it names. Anything that no longer exists, or now behaves differently, is \`stale\`.
- Check that every command, path, and code snippet still resolves.
- Look for non-obvious invariants in the code the doc fails to mention (\`missing\`) — especially ones an LLM would violate by default.

Then judge it as a lookup target:
${HOUSE_RULES}
${LEARNING_DOCS.has(doc) ? `
IMPORTANT — \`${doc}\` is a LEARNING/BUG record. Its accumulated entries are the whole point.
Do NOT propose cutting entries for brevity. Only mark an entry redundant if the underlying
bug is provably fixed in code or the question is provably resolved. Tightening the prose of
an entry is fine; losing the entry is not. Target a modest reduction at most.
` : ''}
Set \`verdict\`:
- \`rewrite\` — needs real surgery (stale claims and/or heavy fat)
- \`light-touch\` — mostly fine, small corrections
- \`merge-away\` — too thin to stand alone; name the doc that should absorb it
- \`delete\` — entirely superseded by code or an ADR

Read only. Do not edit anything. Return the audit.`,
      { label: `audit:${doc.replace('docs/', '')}`, phase: 'Audit', schema: AUDIT_SCHEMA, model: 'opus', effort: 'high' },
    ),

  (audit, doc) => {
    if (!audit) return null
    if (audit.verdict === 'delete' || audit.verdict === 'merge-away') {
      // Deletions are the user's call, not the workflow's — surface, don't act.
      log(`${doc}: proposed ${audit.verdict}${audit.mergeTarget ? ` → ${audit.mergeTarget}` : ''} (not applied)`)
      return { doc, proposal: audit, applied: false }
    }
    return agent(
      `Rewrite \`${doc}\` in the noma-dmrv repo, in place, using the Edit/Write tools.

Here is the verified audit of it (the stale items were each confirmed against the code — trust them):
${JSON.stringify(audit, null, 2)}

Apply it:
1. Fix every \`stale\` claim to match \`reality\`. If you cannot confirm the correction yourself against the code, re-check the cited evidence file before writing it — never guess.
2. Cut every \`redundant\` section, leaving the \`replaceWith\` pointer/link where one is given.
3. Add the \`missing\` invariants, tersely — one line each unless the trap genuinely needs two.
4. Compress the rest toward ~${audit.targetLines} lines.

${HOUSE_RULES}
${LEARNING_DOCS.has(doc) ? `\nREMINDER: \`${doc}\` is a learning/bug record — preserve every entry whose underlying issue is still live. Tighten wording only.\n` : ''}
Link generously to sibling docs (\`docs/*.md\`) and to ADRs (\`docs/adr/NNNN-*.md\`) using relative markdown links, so a reader can fan out on demand instead of reading everything. Verify each link target file actually exists before writing it.

Preserve the file's existing heading style and any content that is genuinely load-bearing. When in doubt about whether something is load-bearing, keep it — a wrong deletion is worse than a long doc.

Report before/after line counts (\`wc -l\`), the corrections you made, and the outbound links you added.`,
      { label: `rewrite:${doc.replace('docs/', '')}`, phase: 'Rewrite', schema: REWRITE_SCHEMA, model: 'opus', effort: 'high' },
    ).then((r) => ({ doc, proposal: audit, applied: true, rewrite: r }))
  },
)

const done = results.filter(Boolean)
const rewritten = done.filter((r) => r.applied && r.rewrite)
const proposals = done.filter((r) => !r.applied)

phase('Stitch')
log(`Rewrote ${rewritten.length} docs; ${proposals.length} structural proposals held back for review`)

// Barrier is genuine here: the stitcher needs the whole post-rewrite corpus at once
// to spot cross-doc duplication and dangling links.
const stitch = await agent(
  `All evergreen docs in \`docs/*.md\` have just been independently audited and rewritten for LLM lookup. Each agent saw only its own doc, so cross-doc problems are now the likely defects.

Per-doc summaries:
${JSON.stringify(rewritten.map((r) => r.rewrite), null, 2)}

Structural proposals deliberately NOT applied (report these, do not act on them):
${JSON.stringify(proposals.map((p) => ({ doc: p.doc, verdict: p.proposal.verdict, mergeTarget: p.proposal.mergeTarget })), null, 2)}

Do four things, editing files as needed:
1. **Dangling links** — every relative markdown link in \`docs/*.md\`, \`CLAUDE.md\` and \`CONTEXT.md\` must resolve to a file that exists. Fix or remove the ones that don't.
2. **Cross-doc duplication** — where two docs now explain the same thing, keep the better one and replace the other with a link. Pick the owner by topic, not by length.
3. **Docs index** — the "Docs Index" section of \`.claude/CLAUDE.md\` is the entry point for every lookup. Make each line's trigger condition accurate for what its doc now actually contains. Keep it the same terse format. Do not restructure the rest of CLAUDE.md.
4. **Entry paragraphs** — confirm each doc opens with its one-paragraph "what this covers / when to read it". Add it where missing.

Then run \`pnpm lint\` and report the result. Return a short markdown report: total lines before/after across the corpus, the most significant corrections made (stale claims that would have actively misled an LLM), the cross-doc merges you performed, and the held-back structural proposals as an explicit decision list for the user.`,
  { label: 'stitch:cross-doc', phase: 'Stitch', model: 'opus', effort: 'high' },
)

return {
  rewritten: rewritten.map((r) => r.rewrite),
  heldBackProposals: proposals.map((p) => ({
    doc: p.doc,
    verdict: p.proposal.verdict,
    mergeTarget: p.proposal.mergeTarget,
  })),
  report: stitch,
}
