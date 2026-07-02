export const meta = {
  name: 'isometric-gap-check',
  description: 'Deep gap-check: Isometric protocol/module requirements vs. our docs and implementation, with adversarial verification',
  whenToUse:
    'Re-run after any Isometric protocol/module version bump, or to audit certification compliance. Pulls authoritative protocol content from the isometric MCP server and checks BOTH our interpretation docs and our actual code against it. Optional args: { liveTemplateInspection?: string (paste of `pnpm tsx scripts/isometric-smoke.ts inspect-template <prj>` for live-template drift), modules?: string[] (slug subset to limit scope) }.',
  phases: [
    { title: 'Bootstrap', detail: 'read versions.json + protocols_list → targets + version drift' },
    { title: 'Authority', detail: 'one agent per pinned module/protocol → authoritative requirement atoms' },
    { title: 'Coverage', detail: 'map each requirement atom onto our docs + code → candidate gaps' },
    { title: 'Verify', detail: 'adversarial refute pass — targeted lookups, batched (~12/agent), 1 retry on transient failure' },
    { title: 'Synthesis', detail: 'rank, group, run the known-gap validation oracle → markdown report' },
  ],
}

// ---------------------------------------------------------------------------
// Shared reference material embedded into subagent prompts. Subagents start
// with no context, so everything they need to do their slice lives here.
// ---------------------------------------------------------------------------

const GAP_TAXONOMY = `
Gap classes (assign exactly one per requirement):
- COVERED — present in authority, documented in our docs, built in schema/mapping, and enforced/gated.
- VERSION_DRIFT — we pin an older version than the latest CERTIFIED registry version.
- NOT_DOCUMENTED — required by authority but absent from our docs (the most dangerous blind spot).
- DOCUMENTED_NOT_BUILT — described in our docs but no schema column / INPUT_MAPPING tuple / gate.
- BUILT_NOT_GATED — schema/column exists but nothing enforces it before submission.
- INTERPRETATION_DRIFT — our doc/code contradicts the authoritative text (wrong interpretation).
- SUB_MATERIAL_EXCLUSION_UNDOCUMENTED — source is below the protocol materiality threshold but the exclusion is not justified anywhere in writing.
- DESIGN_DECISION_PENDING — a real gap where the grain or mechanism is genuinely undecided.
`

const OUR_DOCS = `
Our (non-authoritative) interpretation docs — read these to judge whether a requirement is DOCUMENTED:
- docs/isometric/requirements-shortlist.md   (~40-row requirement table, grouped by domain)
- docs/isometric/schema-mapping.md           (requirement → table.column coverage table)
- docs/isometric/p0-compliance-checklist.md  (15 P0 items with acceptance criteria)
- docs/isometric/condition-registry.md       (~10 conditional-required triggers)
- docs/isometric/simple-implementation-guide.md
- docs/isometric/integration-plan.md         (phase status)
- docs/isometric/openapi-index.md            (which Certify ops are wired)
- docs/isometric/versions.json               (our pinned versions)
- docs/adr/0001..0017.md                      (decisions; esp. 0003 removal unit, 0004/0005 GHG-statement & period emissions, 0013 durability compute split, 0014/0016 credit-batch=production-batch, 0015 single energy point, 0017 Method-B unlock)
`

const OUR_CODE = `
Our implementation — read these to judge whether a requirement is BUILT / GATED:
- src/lib/isometric/transformers/datapoint.ts  (INPUT_MAPPING, ~lines 35-199: (group_key, blueprint_key, input_key) → source field/unit/type. This is what we actually SUBMIT.)
- src/lib/isometric/transformers/ghg-entry.ts, measurement-sample.ts, data-upload.ts
- src/lib/isometric/utils/aggregation.ts        (production-run → AggregatedProductionData)
- src/lib/isometric/utils/durability-aggregation.ts
- src/db/schema/certification.ts                (certifierProjects, certifierRemovals, certifierGhgStatements, certifierDocumentUploads, certifierSensors)
- src/db/schema/credits.ts                      (creditBatches: samplingMethod, productionProcessId)
- src/db/schema/production.ts                   (productionRuns.energyConsumption JSONB, productionRunReadings)
- src/db/schema/production-processes.ts, products.ts, feedstock.ts
- src/lib/certification/readiness.ts            (deriveRemovalReadiness — the single submission gate)
- src/lib/certification/{readiness-facts,status,batch-health}.ts
- src/fn/certification/*.ts                     (submit-removal.ts, certify-context-core.ts, durability-readiness.ts, ghg-statements.ts, sources.ts, evidence-ledger.ts, submission-warnings.ts)
- drizzle/*.sql                                 (condition-enforcing migrations, e.g. durability 200-year guards ~0053/0054)
Use Grep/Glob/Read. Cite concrete file:line refs for every claim (presence AND absence — say what you grepped for).
`

// Compact reference for the VERIFY stage only. The old verify prompt embedded the
// full OUR_DOCS + OUR_CODE lists and told each batch to read them ONCE — but with
// ~one batch per 6 candidates that meant the whole reference set was re-read dozens
// of times (the run's main token sink). Each claim already ships priorFileRefs from
// the coverage pass, so the verifier should confirm those + grep ONLY for the
// specific alternative hiding spots, never re-reading whole files.
const VERIFY_REFERENCE = `
Verify by TARGETED lookup, NOT by reading whole files (that was the cost driver):
1. Open each claim's priorFileRefs first — the coverage pass already cited file:line. Confirm or rebut exactly what it says.
2. Then grep ONLY for the specific places a real requirement could hide under a different name:
   - schema column under another name → grep src/db/schema/ for the concept
   - what we actually submit → grep src/lib/isometric/transformers/datapoint.ts (INPUT_MAPPING) for the group/blueprint/input key
   - a submission gate → grep src/lib/certification/readiness.ts + drizzle/*.sql (condition migrations)
   - an intentional decision/exclusion → grep docs/adr/ and docs/open-questions.md
   - a doc row using different wording → grep docs/isometric/{requirements-shortlist,schema-mapping,p0-compliance-checklist,condition-registry}.md
Do NOT dump entire files. Cite the file:line you actually checked (presence AND absence).`

const MCP_BOOTSTRAP_TOOLS =
  'select:mcp__isometric__how_to,mcp__isometric__protocols_list,mcp__isometric__protocols_get_metadata'

const MCP_AUTHORITY_TOOLS =
  'select:mcp__isometric__how_to,mcp__isometric__protocols_analyze,mcp__isometric__protocols_get_content,mcp__isometric__protocols_get_metadata,mcp__isometric__standard_operating_procedures_list,mcp__isometric__standard_operating_procedures_get'

// ---------------------------------------------------------------------------
// Structured-output schemas
// ---------------------------------------------------------------------------

const BOOTSTRAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['targets', 'driftFindings'],
  properties: {
    targets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'contentType', 'pinnedVersion', 'authorityUrl', 'latestCertifiedVersion', 'drift'],
        properties: {
          slug: { type: 'string' },
          contentType: { type: 'string', enum: ['protocol', 'module'] },
          pinnedVersion: { type: 'string' },
          authorityUrl: { type: 'string' },
          latestCertifiedVersion: { type: 'string' },
          drift: { type: 'boolean' },
        },
      },
    },
    driftFindings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slug', 'pinnedVersion', 'latestCertifiedVersion', 'note'],
        properties: {
          slug: { type: 'string' },
          pinnedVersion: { type: 'string' },
          latestCertifiedVersion: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
}

const REQUIREMENT_ATOMS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'version', 'atoms'],
  properties: {
    slug: { type: 'string' },
    version: { type: 'string' },
    atoms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['reqId', 'statement', 'type', 'sourceSection', 'sourceUrl'],
        properties: {
          reqId: { type: 'string', description: 'stable id, e.g. ghg-materiality-threshold' },
          statement: { type: 'string' },
          type: { type: 'string', enum: ['required', 'conditional'] },
          trigger: { type: 'string', description: 'for conditional reqs: the condition that makes it apply' },
          fields: { type: 'array', items: { type: 'string' } },
          threshold: { type: 'string' },
          formula: { type: 'string' },
          cadence: { type: 'string' },
          evidence: { type: 'string' },
          sourceSection: { type: 'string' },
          sourceUrl: { type: 'string' },
        },
      },
    },
  },
}

const COVERAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'results'],
  properties: {
    slug: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['reqId', 'statement', 'gapClass', 'evidence', 'fileRefs', 'sourceUrl'],
        properties: {
          reqId: { type: 'string' },
          statement: { type: 'string' },
          gapClass: {
            type: 'string',
            enum: [
              'COVERED',
              'NOT_DOCUMENTED',
              'DOCUMENTED_NOT_BUILT',
              'BUILT_NOT_GATED',
              'INTERPRETATION_DRIFT',
              'SUB_MATERIAL_EXCLUSION_UNDOCUMENTED',
              'DESIGN_DECISION_PENDING',
            ],
          },
          severity: { type: 'string', enum: ['P0', 'P1', 'advisory'] },
          evidence: { type: 'string', description: 'what was found / not found in docs and code' },
          fileRefs: { type: 'array', items: { type: 'string' } },
          sourceUrl: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['reqId', 'refuted', 'reason', 'fileRefs'],
  properties: {
    reqId: { type: 'string' },
    refuted: { type: 'boolean', description: 'true if the claimed gap is actually covered (false positive)' },
    reason: { type: 'string' },
    correctedClass: { type: 'string', description: 'if not refuted but the class was wrong, the corrected class' },
    correctedSeverity: { type: 'string', enum: ['P0', 'P1', 'advisory'] },
    fileRefs: { type: 'array', items: { type: 'string' } },
  },
}

// One verifier handles a BATCH of candidates and returns one verdict per reqId.
const VERDICTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: { type: 'array', items: VERDICT_ITEM },
  },
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function bootstrapPrompt() {
  return `You are the bootstrap step of an Isometric compliance gap-check for the noma-dmrv repo.

1. Read docs/isometric/versions.json. For each pinned protocol/module, extract: slug (from the authority URL path, e.g. https://registry.isometric.com/module/energy-use-accounting/1.2 → slug "energy-use-accounting", contentType "module"; /protocol/biochar/1.2 → slug "biochar", contentType "protocol"), pinnedVersion (minor, e.g. "1.2"), authorityUrl.

2. Load the isometric MCP tools with ToolSearch query: "${MCP_BOOTSTRAP_TOOLS}". Call mcp__isometric__how_to FIRST (server requires it). Then call mcp__isometric__protocols_list for content_type "protocol" AND for content_type "module".

3. For each target, find the latest CERTIFIED version on the registry from protocols_list. Set drift=true when latestCertifiedVersion > pinnedVersion. Emit a driftFindings entry for each drift with a one-line note.

Return the structured object. Targets must include EVERY pinned entry from versions.json (do not drop any). Do not analyze content here — that is a later step.`
}

function authorityPrompt(t) {
  return `You are extracting the AUTHORITATIVE requirement list for one Isometric ${t.contentType}: "${t.slug}" at our pinned minor version "${t.pinnedVersion}" (authority: ${t.authorityUrl}).

Load isometric MCP tools with ToolSearch query: "${MCP_AUTHORITY_TOOLS}". Call mcp__isometric__how_to FIRST (server requires it), then use mcp__isometric__protocols_analyze (token-efficient, targeted questions) at minor_version "${t.pinnedVersion}". Escalate to mcp__isometric__protocols_get_content for formula/threshold/materiality-heavy content where analyze may omit detail (especially ghg-accounting, energy-use-accounting, biomass-feedstock-accounting). Also check standard_operating_procedures_list/get if relevant.

Extract every distinct, individually-checkable requirement as a "requirement atom": required vs conditional (with its trigger), the data fields it needs, any numeric threshold, any formula, reporting cadence, and required evidence. Capture the source section heading and a source URL for each (this is the authority citation — it is mandatory).

Be exhaustive on these categories that we know are easy to miss:
- Direct process emissions from pyrolysis (CO, CH4, N2O) and how they must be quantified/reported.
- Period / facility-level emissions (staff travel, lab, consumables) and their accounting boundary.
- Materiality / de-minimis thresholds (what may be excluded, and the documentation required to exclude it).
- Net-removal equation inputs, uncertainty/buffer, co-product allocation, embodied emissions, durability inputs, transport accounting, feedstock eligibility caps.

IMPORTANT: extract requirements as the protocol states them. Do NOT look at our code here — this is the ground truth we will measure against. Return the structured object with slug="${t.slug}", version="${t.pinnedVersion}".`
}

function coveragePrompt(t, atomsResult) {
  const atomsJson = JSON.stringify((atomsResult && atomsResult.atoms) || [])
  const liveNote = LIVE_TEMPLATE
    ? `\n\nLIVE TEMPLATE INSPECTION (authoritative snapshot of the actual Isometric removal template inputs — use it to judge whether INPUT_MAPPING covers the real bound inputs):\n${LIVE_TEMPLATE}\n`
    : `\n\n(No live-template inspection provided — judge INPUT_MAPPING coverage from code only; the report will note the live-template cross-check was skipped.)\n`

  return `You are mapping authoritative requirements for the Isometric ${t.contentType} "${t.slug}" (v${t.pinnedVersion}) onto the noma-dmrv codebase, to find compliance gaps.

For EACH requirement atom below, determine its coverage across three corners and assign exactly one gapClass.
${GAP_TAXONOMY}
${OUR_DOCS}
${OUR_CODE}
${liveNote}

Method per atom:
1. Is it DOCUMENTED in our docs? Grep the docs above for the concept; note the row/file:line or its absence.
2. Is it BUILT? Check schema columns + INPUT_MAPPING tuple (datapoint.ts) + aggregation. Note file:line or absence.
3. Is it GATED? Check readiness.ts / condition migrations / Zod. Note file:line or absence.
4. Does our doc/code CONTRADICT the authority text? → INTERPRETATION_DRIFT.
5. If sub-material: is the exclusion documented? If not → SUB_MATERIAL_EXCLUSION_UNDOCUMENTED.

Assign a severity (P0 = blocks valid credit issuance / wrong claim; P1 = required but lower-risk; advisory = nice-to-have or already-tracked). Every result needs evidence text, fileRefs (what you grepped, with file:line), and the atom's sourceUrl. Include COVERED atoms too (for coverage stats).

Requirement atoms (JSON):
${atomsJson}

Return the structured object with slug="${t.slug}".`
}

function verifyBatchPrompt(t, candidates) {
  const candidatesJson = JSON.stringify(
    candidates.map((c) => ({
      reqId: c.reqId,
      statement: c.statement,
      claimedClass: c.gapClass,
      claimedSeverity: c.severity || 'unspecified',
      priorEvidence: c.evidence,
      priorFileRefs: c.fileRefs || [],
      authority: c.sourceUrl || t.authorityUrl,
    })),
    null,
    2,
  )

  return `You are an adversarial verifier. Another agent claimed a BATCH of ${candidates.length} compliance gaps in noma-dmrv for the Isometric ${t.contentType} "${t.slug}". Your job is to REFUTE each one — prove it is actually covered — and you should DEFAULT to refuted=true for a claim unless you find concrete evidence that specific gap is real. False positives (including bogus P0s) are common in this repo; your job is to kill them. Investigate EACH claim independently on its own merits — do not let one claim's verdict bleed into another's.

Trust each claim's requirement statement as given (it was extracted from the authority) — your only job is to check whether OUR docs/code cover it. You do NOT need the protocol text or any MCP tools.
${VERIFY_REFERENCE}

For EACH claim decide:
- refuted=true if the requirement is in fact covered/documented/gated (give the file:line that proves it).
- refuted=false ONLY if, after genuinely searching, the gap stands. If the gap is real but the class or severity was wrong, set correctedClass / correctedSeverity.

You MUST return exactly ${candidates.length} verdicts — one per claim — each carrying its exact reqId verbatim. Drop none; invent none.

Claimed gaps (JSON):
${candidatesJson}`
}

function synthesisPrompt(driftFindings, confirmed, moduleStats) {
  return `You are writing the final Isometric compliance gap-check report (Markdown) for noma-dmrv.

Inputs:

VERSION DRIFT (we pin older than latest certified):
${JSON.stringify(driftFindings || [], null, 2)}

PER-MODULE STATS { slug, atoms, candidates, confirmed }:
${JSON.stringify(moduleStats || [], null, 2)}

CONFIRMED GAPS (survived adversarial verification):
${JSON.stringify(confirmed || [], null, 2)}

LIVE-TEMPLATE CROSS-CHECK: ${LIVE_TEMPLATE ? 'performed (inspection provided)' : 'SKIPPED — no inspect-template output provided'}

Produce a report with:
1. # Isometric Requirements Gap-Check  + a one-paragraph executive summary (counts by severity, headline drifts).
2. ## Version drift — table: module | pinned | latest certified | note.
3. ## Gaps by module — for each module a subsection; within it, findings sorted P0 → P1 → advisory. Each finding: gap class (badge), the requirement statement, the authority URL, our file:line refs, and a concrete recommended action. Distinguish "must build" vs "must document the exclusion" vs "decision pending".
4. ## Known-gap validation oracle — confirm these FOUR user-flagged gaps each appear somewhere in the findings above:
   (a) pyrolyzer CO direct emission, (b) pyrolyzer CH4 direct emission (note grain vs ADR 0016 credit-batch=production-batch), (c) staff-travel period emission (PROJECT-scope Component authored in the Isometric UI — ADR 0018; noma keeps no journal copy), (d) sampling activities <1% materiality (P0-13).
   For any of the four NOT present in the findings, emit a line: "⚠️ BLIND SPOT — known gap '<name>' was not independently detected; the check missed it." (This is a self-test of the workflow.)
5. ## Coverage summary table — module | atoms checked | candidates | confirmed gaps.
6. A trailing note if the live-template cross-check was skipped, and how to enable it (paste \`pnpm tsx scripts/isometric-smoke.ts inspect-template <prj>\` output as args.liveTemplateInspection).

Return ONLY the Markdown report (it is the deliverable, not a message).`
}

// ---------------------------------------------------------------------------
// Optional inputs
// ---------------------------------------------------------------------------

const LIVE_TEMPLATE = args && args.liveTemplateInspection ? String(args.liveTemplateInspection) : null
const MODULE_FILTER = args && Array.isArray(args.modules) ? args.modules : null
// Adversarial verification is batched to keep agent count + redundant doc-reads
// down: one verifier handles up to this many candidate gaps. Larger batch =
// fewer agents/tokens, slightly less depth per claim. Default 12 (run 2 used 6 →
// ~59 verify agents; combined with the targeted VERIFY_REFERENCE this roughly
// halves both agents and tokens). Override via args.verifyBatchSize.
const VERIFY_BATCH_SIZE = args && Number(args.verifyBatchSize) > 0 ? Math.floor(Number(args.verifyBatchSize)) : 12

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// One retry for a verify batch that died on a transient API error. Run 2 lost 8
// batches this way, stranding ~48 candidates as "kept unverified" — and at the
// larger batch size each failure now strands 12, so the retry is what keeps the
// cheaper run trustworthy. agent() returns null only after its own internal
// retries are exhausted, so this is a fresh second attempt; it costs tokens only
// when a failure actually happened.
async function verifyBatch(t, batch, label) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await agent(verifyBatchPrompt(t, batch), {
      label: attempt === 1 ? label : `${label}:retry`,
      phase: 'Verify',
      schema: VERDICTS_SCHEMA,
    })
    if (r) return r
  }
  return null
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

phase('Bootstrap')
const bootstrap = await agent(bootstrapPrompt(), { label: 'bootstrap', phase: 'Bootstrap', schema: BOOTSTRAP_SCHEMA })

let targets = (bootstrap && bootstrap.targets) || []
// A module-scoped rerun must narrow drift reporting too, or partial runs
// surface drift rows for modules the run never checked.
let driftFindings = (bootstrap && bootstrap.driftFindings) || []
if (MODULE_FILTER) {
  targets = targets.filter((t) => MODULE_FILTER.includes(t.slug))
  driftFindings = driftFindings.filter((d) => MODULE_FILTER.includes(d.slug))
}
if (!targets.length) {
  return {
    report: '# Isometric Requirements Gap-Check\n\nBootstrap returned no targets (could not read versions.json or the module filter excluded everything). Nothing to check.',
    driftFindings,
    confirmedCount: 0,
    modules: [],
  }
}

log(`Checking ${targets.length} pinned protocol(s)/module(s); ${driftFindings.length} version drift(s) found at bootstrap.`)

// Fully pipelined: authority → coverage → adversarial verify, per module, no barriers.
const perModule = await pipeline(
  targets,
  // Stage 1 — authority extraction (the ground truth)
  (t) => agent(authorityPrompt(t), { label: `authority:${t.slug}`, phase: 'Authority', schema: REQUIREMENT_ATOMS_SCHEMA }),
  // Stage 2 — coverage mapping onto our docs + code
  (atomsResult, t) => {
    if (!atomsResult || !(atomsResult.atoms || []).length) throw new Error(`no atoms for ${t.slug}`)
    return agent(coveragePrompt(t, atomsResult), { label: `coverage:${t.slug}`, phase: 'Coverage', schema: COVERAGE_SCHEMA })
  },
  // Stage 3 — adversarial verification, BATCHED: one verifier per
  // VERIFY_BATCH_SIZE candidates, each doing targeted file:line lookups (not a
  // whole-codebase re-read) with one retry on transient failure. Verdicts are
  // matched back by reqId.
  async (coverage, t) => {
    const results = (coverage && coverage.results) || []
    const candidates = results.filter((r) => r.gapClass !== 'COVERED')
    const batches = chunk(candidates, VERIFY_BATCH_SIZE)
    const verdictBatches = await parallel(
      batches.map((batch, bi) => () =>
        verifyBatch(t, batch, `verify:${t.slug}:batch${bi + 1}/${batches.length}`),
      ),
    )
    const verdictByReqId = {}
    verdictBatches.filter(Boolean).forEach((vb) => {
      ;(vb.verdicts || []).forEach((v) => {
        if (v && v.reqId) verdictByReqId[v.reqId] = v
      })
    })
    const confirmed = []
    candidates.forEach((c) => {
      const v = verdictByReqId[c.reqId]
      if (v && v.refuted) return // false positive — dropped (reason recorded in v.reason)
      const merged = {
        module: t.slug,
        reqId: c.reqId,
        statement: c.statement,
        gapClass: (v && v.correctedClass) || c.gapClass,
        severity: (v && v.correctedSeverity) || c.severity || 'P1',
        evidence: c.evidence,
        fileRefs: [].concat(c.fileRefs || [], (v && v.fileRefs) || []),
        sourceUrl: c.sourceUrl,
        verifierNote: v ? v.reason : 'no verdict returned for this reqId (kept conservatively)',
      }
      confirmed.push(merged)
    })
    return {
      module: t.slug,
      atoms: results.length,
      candidates: candidates.length,
      confirmed,
      droppedFalsePositives: candidates.length - confirmed.length,
    }
  },
)

const liveModules = perModule.filter(Boolean)
const allConfirmed = liveModules.flatMap((m) => m.confirmed)
const moduleStats = liveModules.map((m) => ({
  slug: m.module,
  atoms: m.atoms,
  candidates: m.candidates,
  confirmed: m.confirmed.length,
  droppedFalsePositives: m.droppedFalsePositives,
}))

log(`Coverage complete: ${allConfirmed.length} confirmed gap(s) across ${liveModules.length} module(s) after adversarial verification.`)

phase('Synthesis')
const report = await agent(
  synthesisPrompt(driftFindings, allConfirmed, moduleStats),
  { label: 'synthesis', phase: 'Synthesis' },
)

return {
  report,
  driftFindings,
  confirmedCount: allConfirmed.length,
  modules: moduleStats,
  liveTemplateChecked: !!LIVE_TEMPLATE,
}
