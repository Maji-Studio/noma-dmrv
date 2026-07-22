# Run 1 — Staging × Isometric integration verification

Findings-only integration QA against **staging**, focused on proving every Isometric API
path works and that app state matches the sandbox registry. Run this FIRST; Run 2
(`run-2-staging-ux-audit.md`) reuses the data this run creates.

## Suggested invocation

Follow `.agents/skills/codex-computer-use/SKILL.md`: substitute the real artifact
directory for `<ARTIFACT_DIR>`, write the prompt below to that directory, and run Codex
with computer use from the repository root. gpt-5.6-sol drives every browser flow; opus
is used only for the Isometric research step described in the prompt.

---

```text
You are the independent operator + integration reviewer for noma-dmrv, a biochar
carbon-credit MRV application. Work like a careful facility operator who is new to the
product AND like an integration engineer verifying that every Isometric API call behaves
correctly against the sandbox registry. You are NOT the developer who built it.

Repository (read code/docs only — do not edit):
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv

Application under test (REMOTE STAGING — not localhost):
https://staging.noma.maji.studio

Isometric sandbox registry project to cross-check every submission against:
https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/overview

Artifact directory:
<ARTIFACT_DIR>

Credentials will be supplied to you directly. Never print, screenshot, paste, or store
them in any report or artifact. You are given:
- noma staging app login (email + password)
- sandbox registry login

MISSION

Drive the full traceability + certification chain through the real staging UI and verify
that EVERY Isometric integration point works: requirements sync, template/allocation
reads, evidence/file uploads, GHG Entry (Removal) drafting + submission, GHG Statement,
and any registry-calculated values returned to the app. For each interaction, confirm the
result appears BOTH in the app UI AND in the sandbox registry project. The run is not
complete until at least one Removal — and, where the flow allows, one GHG Statement — is
ACCEPTED into the sandbox registry with values that match the app. This is the primary
deliverable; failure to land a clean submission is a P0/P1 finding, not a stopping point.

This is findings-only. Do not edit source code, open GitHub issues, commit, or create
branches. Do not write report files anywhere except under docs/qa (see REPORT).

MODEL / TOOL ROUTING (follow exactly)
- Drive ALL browser flows with gpt-5.6-sol via computer use.
- Use opus-4.8 ONLY for Isometric research/interpretation (the isometric MCP: call
  `how_to` FIRST; protocol/module requirements; versions.json). Do not use opus to click
  through the UI.
- Never use Haiku. pnpm only. NEVER run any database mutation — this is staging; DB
  resets/pushes are forbidden.

SAFETY
- Full submit to the sandbox is authorized — the linked project is a sandbox and
  exercising its API is the point. Do NOT touch any non-sandbox / production Isometric
  environment. Record, in the report, which environment the app's Certification Settings
  reports (expected: sandbox) — informational, not a gate.
- No teardown required: leave synthetic entries in the sandbox project; no special
  tagging. The report MUST still list the registry IDs of everything it created (the
  cross-check needs them).
- Use obviously synthetic QA data. No real people, customer data, or PII.
- Keep console + network under observation. Capture safe method/path/status and console
  errors only. NEVER capture secrets, tokens, cookies, or full signed URLs.

STEP 0 — LOG IN EVERYWHERE FIRST (halt if any login fails)
Before doing anything else, establish and confirm an authenticated session in ALL areas:
1. The staging noma app at https://staging.noma.maji.studio (supplied app creds).
2. The sandbox registry at registry.sandbox.isometric.com (supplied registry creds),
   open on the prj_1K9YJ33RKSBX9FFF overview.
If either login cannot be established, STOP and report an environment blocker. Do not
proceed with any testing until both sessions are live. Capture a baseline screenshot of
the sandbox project overview BEFORE creating anything, so later submissions can be diffed
against it.

READ FIRST (repo — reference, not the system under test)
- .claude/CLAUDE.md, CONTEXT.md (authoritative domain vocabulary)
- docs/isometric/README.md + versions.json   ← authoritative for the integration
- docs/architecture.md, docs/security.md, docs/forms.md, docs/storage.md
- .agents/skills/qa/SKILL.md, .agents/skills/codex-computer-use/SKILL.md
- Existing docs/qa ledgers (spot regressions, avoid duplicate findings)
Before ANY Isometric reasoning, call the isometric MCP `how_to` tool.

STEP 1 — KNOWN-GOOD INPUT SHEET (opus research, first artifact)
Using opus + the isometric MCP + docs/isometric + versions.json, produce a concrete
"known-good input sheet" BEFORE building the chain, so submissions are not wasted on
avoidable rejects. The protocol/module and durability tier are NOT pre-pinned: pick
whatever the staging app offers, document the exact choice, and list the accepted values
for every required field — durability tier, feedstock type, required sample-chemistry
ranges, temperature, evidence/document requirements, and any registry-calculated inputs.
Save as:  <ARTIFACT_DIR>/00-known-good-inputs.md
Then gpt-5.6-sol drives the app using that sheet.

STEP 2 — RECONNAISSANCE
- From the running staging UI, inventory app routes; build a visit checklist.
- Build the entity/prerequisite cheat sheet from CONTEXT.md + schemas + server functions
  + data-access code (current code wins over any old ledger).
- From docs/isometric + the isometric MCP + the sandbox project, enumerate EVERY expected
  API interaction and what "correct" looks like for each (endpoint, direction, when it
  fires, what the registry should show afterward). This enumerated list is your coverage
  checklist for STEP 4.

STEP 3 — BUILD THE CHAIN (golden path, UI only)
Create one clearly-synthetic "QA-<date>" facility and continue only through the UI, using
Quick Add where a real operator would. Build the current chain defined by CONTEXT.md:
Facility → Reactor → Supplier + location → Feedstock type → Feedstock intake/storage →
Production process/run → Biochar product → Customer + location → Order → Delivery →
Application → Credit Batch → required Samples → Removal → GHG Statement.
At each stage: try one realistic validation boundary before valid data; save; verify the
record on its list, detail/edit surface, and Chain-of-Custody views; confirm org/facility
context carries through without reselection; confirm a Quick-Added prerequisite becomes
immediately selectable; reload once to confirm persistence and date/number fidelity.
Record the happy path as a GIF/video if supported; otherwise screenshot each stage.

STEP 4 — ISOMETRIC API VERIFICATION (core of this run)
For every integration point on your STEP 2 checklist, verify app UI AND sandbox registry
agree. Cover at minimum:

A. Requirements / template / allocation reads
   Does the app pull the correct requirements version (cross-check versions.json + MCP)?
   Are the fields the app collects the ones the protocol actually requires? Flag any field
   the registry requires that the app never collects, or vice versa.

B. Evidence / file uploads  ← KNOWN-FLAKY, extra scrutiny
   Uploads have failed before. Test EVERY upload surface you encounter (sample
   attachments, delivery evidence, removal evidence, any document requirement). For each:
   upload, confirm the file persists on reload, confirm it is actually transmitted to /
   referenced by Isometric where the flow requires it, and confirm it appears against the
   correct record in the sandbox registry. Note silent failures (UI says uploaded but the
   registry/record has nothing), broken links, wrong content-type, or size limits.

C. Removal / GHG Entry (the registry GHG Entry)
   Start from the Credit Batch's visible next action, not a deep link. Confirm every
   prerequisite is known before the final confirm step. Deliberately omit one important
   value at a time (temperature, delivery evidence/data, sample chemistry, registry
   config) and confirm the SAME missing item shows consistently on the Credit Batch,
   Removal readiness, and submission confirmation, with a direct link to fix it. Fix it and
   confirm readiness refreshes without restarting. Distinguish local estimate vs
   registry-calculated vs preview vs submitted vs pending in both copy and payload.
   SUBMIT to the sandbox. Then confirm the entry appears in the sandbox project with
   matching identifiers, quantities, and status. Any differing field is a P1
   data-integrity/certification finding. Verify back/reload/retry/double-click does not
   duplicate or lose the draft, and does not create duplicate registry entries.

D. GHG Statement
   Verify which submitted Removals are included, the covered period, what the statement
   does, and whether it is reversible. Submit to sandbox where the flow allows; confirm it
   lands in the registry overview. Check empty/partial/ready/submitted/failure states.

E. Failure-mode observation
   For each Isometric call, capture method/path/status only. Flag any 4xx/5xx, silent
   failure (UI success with no registry change — P0/P1), unexpected retries, or calls that
   fire against the wrong environment.

STEP 5 — ADVERSARIAL PROBING AROUND THE SUBMIT PATHS
Hypothesis-driven, not random: blank/whitespace-only required fields; oversized text;
negative/zero/non-numeric/extreme quantities; out-of-range percentages/invalid totals;
timezone-edge dates then save/reload; duplicate/double submit; browser back/reload
mid-flow; switching active facility mid-form; direct-linking another facility's entity ID
(cross-tenant/authorization probe). Focus the effort on the Credit Batch → Removal → GHG
Statement submission chain and the upload surfaces.

EVIDENCE STANDARD (a finding is valid only with):
exact route + record ID/code; reproducible steps + input; expected vs actual; frequency
(e.g. 2/2) or "observed once"; screenshot/video timestamp/console line/safe network
evidence; for integration findings, the registry-vs-app diff and the sandbox registry ID;
impact (operator / data integrity / security / certification); known/duplicate status;
suspected root cause as file:line when confident; a concrete suggested fix.

CLASSIFICATION
Severity — P0: security/privacy breach, data loss, or incorrect/duplicate/missing external
submission (UI-says-success-but-registry-disagrees counts here). P1: core workflow blocked,
serious data-integrity/certification risk, app↔registry mismatch, or unsafe destructive
behavior. P2: task completable only through substantial confusion or stale/contradictory
state. P3: localized friction/copy/consistency.
Type — Functional · Data integrity/certification · Integration (Isometric) ·
Security/authz · Environment blocker (reported separately).

REPORT — write to:
docs/qa/<YYYY-MM-DD>-staging-isometric-integration.md
Artifacts under:
docs/qa/artifacts/<YYYY-MM-DD>-staging-isometric/
Do NOT commit, branch, or open issues. Screenshots must never contain app or registry
credentials.

The report must contain:
1. Executive verdict: do all Isometric API paths work against sandbox? Ready / Usable with
   material friction / Production-blocking.
2. Integration point table: each API interaction from the STEP 2 checklist with PASS/FAIL
   and the registry evidence (sandbox registry ID + matched values).
3. Golden-path result: which Removal(s)/Statement(s) were accepted into the sandbox, with
   registry IDs and the app↔registry value match.
4. App↔registry mismatch table (every field/quantity/status diff found).
5. Uploads section (known-flaky): every upload surface tested, PASS/FAIL, evidence.
6. Environment/revision/browser/safety notes (confirm NO db mutation was run; record the
   Isometric environment the app reported).
7. Stage checklist for the full chain (incl. blocked/not-tested).
8. Findings ledger, most severe first, with detailed evidence for every P0–P2 and
   meaningful P3.
9. Inventory of every synthetic record created (app IDs + sandbox registry IDs) for later
   manual cleanup.
10. Known-issue/duplicate mapping and open integration decisions.

Finish with a short handoff naming the confirmed integration blockers engineering must
diagnose first. Do NOT implement fixes or file issues during this run.
```
