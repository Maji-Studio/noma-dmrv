# Guided Removal template setup (#1276)

Kenji's decisions (2026-10-20, on #1276): a full-page setup with a step rail and a What happens column; only fitting templates are offered (replaces #1200 decision 1); credit batches still pick only ready templates; a component added later reopens as "1 to decide" and New Removal stays blocked until answered; Owner and Admin run setup, Members see a read-only summary; answers are per organization and template, with a one-line note under Facility; no recommended template; durability is per project and never asked.

## 1. Data model (no schema change)

Everything maps onto the observation `lineSources` and `certifier_projects.default_removal_template_id`. Proposals stay unsaved until Apply, which stores them as `origin: "reviewed"`, so `effectiveContract`, readiness and fingerprints are unchanged.

New pure module `src/lib/certification/removal-template-setup-plan.ts`:

- `templateFitsFacility(template, durabilityOption)` returns `{ fits } | { reason }`: `credit_type === "REMOVAL"`, `assertSequestrationTemplateSelectable` passes, every sequestration blueprint is in `expectedSequestrationBlueprintKeys(tier)` (same rule as `removalTemplateTierCompatibilityBlocker`), at least one storage component. Reduction templates are dropped without a name; Removal templates that do not fit are named once with a short reason.
- `setupPlan(definition, gateAdjustedLineSources, problems, changes)` puts each component in one bucket:
  - **decided**: `lineNeedsReview` is false (bootstrap, carried, reviewed). Folded, read-only.
  - **noma's default**: needs review and `isAcceptableProposal` holds, or no catalog candidate. Default: Operating, the single source if one, otherwise the first non-`none` policy from `allowedEntryPolicies`. Alternatives: source or entry, plus scope "Project level (not sent)" for a deployment's direct end-of-life emissions. Fixed-only and unsupported shapes default to no entry; `lineHasNoSource` still blocks them.
  - **open decision**: `clash` (two or more components whose only candidate is the same source; each competing component is an option, the others get entries), `source` (`hasCatalogDisambiguation` with two or more candidates; options plus "Neither, entry"), `added` (`changes[id] === "added"` on a template with any reviewed or carried line; noma's proposal listed first, not preselected).
- `assignmentsFromPlan(plan, answers, overrides)` builds `ReviewLineContractsInput.assignments`; throws on an unanswered decision or an answer or override outside the offered options.

A component added later already lands as `proposed`; `linesToDecideCount` counts it and `templateLinesNeedReview` blocks New Removal through `readiness.ts`. The plan only labels it `added`.

## 2. Server (PR 1, Codex)

`src/fn/certification/removal-template-setup.ts`:

- `loadRemovalTemplateSetup(facilityId)`: read, org scope plus `requireOrgFacility`, stores nothing. Returns facility, project name and tier; `fitting[]` (id, name, component count, plan, ready, `semanticFingerprint`, `fullFingerprint`); `notFitting[]` with reasons; default id and its to-decide count; `batchesWithoutTemplate[]` (id, code, version); `batchesOnOtherTemplates[]` (code, template name); `viewerCanManage`. Non-default, unpinned templates go through `readOnlyEntry`; default and pinned ones through `loadRemovalTemplateFacts`. Every response passes through `reviewLineSources` (#1237).
- `applyRemovalTemplateSetup({ facilityId, removalTemplateId, fingerprints, answers, overrides, makeDefault, batches: [{ id, expectedVersion }] })`:
  1. `requireOrgRole(ctx, "admin")` before any read (Owner passes by rank).
  2. `loadSetupTarget`, then the fit check.
  3. `loadRemovalTemplateFacts` observes the template in its own transaction (as `startRemovalTemplateSetup` does). Missing observation: `templateNotFullyRead`. Fingerprints differ from the planned ones: stale error ("The template changed in Isometric. Review it again.").
  4. One `db.transaction`: facility boundary lock; `reviewLineContractsInTransaction` (skipped with no assignments); re-check sources and refuse with `templateLinesNeedReview` / `templateNotFullyRead`; `updateFacilityDefaultRemovalTemplateInTransaction` if `makeDefault`; `switchCreditBatchRemovalTemplateInTransaction` per batch (batch in the facility, no pin; a pin added since load is stale; activity event recorded). Any refusal rolls everything back.

Data-access: split `reviewLineContracts`, `updateFacilityDefaultRemovalTemplate`, `switchCreditBatchRemovalTemplate` into `…InTransaction(ctx, tx, …)` cores. Public wrappers stay, with their Admin and archived-facility guards, the not-ready switch refusal and their tests. `loadRemovalTemplateReview`, `loadRemovalTemplateReviewEntry` and `readOnlyEntry` stay untouched.

Also: schemas in `src/schemas/removal-template-setup.ts`; query key `certificationKeys.removalTemplateSetup(facilityId)`; hooks `useRemovalTemplateSetup`, `useApplyRemovalTemplateSetup` (invalidates certification, credit batches, activity, onboarding); link builder `removalTemplateSetupHref(facilityId, { templateId?, step?, makeDefault? })` (the Settings pane with the dialog params). `certificationRemovalTemplatesHref` keeps its signature.

Lock order: boundary lock, then observation advisory lock, then batch locks. Confirm no path takes the observation lock before the boundary lock.

## 3. UI (PR 2, Claude)

- Superseded 2026-10-21 (Kenji's pick of variant A on #1276): no route. The setup is a stepper dialog opened from the Settings Removal templates card; deep links are `?section=removal-templates&setup=<step>&template=<id>&makeDefault=false` on the Settings pane, and Members only see the card.
- Page: `PageHeader` "Set up Removal template", facility subtitle, back link to Settings. Vertical step rail:
  - **Template**: radio cards for fitting templates only, then one line naming those not offered and why. One fit is preselected; more than one, no preselection and Continue waits for a pick.
  - **Decisions**: numbered decision blocks, then the folded "noma decided N components" list with Change on noma's defaults. Decided components are read-only: "Decided for every facility using this template".
  - **Apply**: Now → After default; "Also set it on N credit batches without a template" (codes linked); one line naming batches on other templates; What changes; button "Make default and set on N batches".
  - Going back through the rail. One fit with 0 decisions opens on Apply (2 clicks). A sticky What happens aside at `lg`, stacked below the step on phones.
- Settings pane: `RemovalTemplateSummaryCard` replaces `RemovalTemplateReviewPanel`: name, status (Ready, or "N to decide"), Used by (linked batches), Decided by you, Decided by noma, Entries per batch. Owner and Admin get Review decisions and Change template; Members the same card without buttons, names not IDs. Empty state "Set up template". Caption: "The template this facility's credit batches use. Component decisions apply to every facility using the template."
- Switch dialog: "Decide components" in `credit-batch-template-switch-dialog.tsx` links to the Decisions step for that template with Make default unchecked.
- Remove the old screen: `removal-template-review-card`, `-panel`, `removal-template-line-row`, `removal-template-line-sections` and their tests; reused labels (`SOURCE_LABELS`, `ENTRY_POLICY_LABELS`) move into a slim copy module. Update GLOSSARY (Removal template, Components to decide) and `docs/design-decisions.md`.
- Not #965: that removed a multi-entity onboarding wizard with Back and Skip that duplicated create sheets. This is one configuration task with 0 to 3 real questions, entered from the summary or a blocker, never gating first run, no Skip, storing nothing until Apply.

## 4. PRs

1. PR 1 (Codex): plan module, fit check, two actions, InTransaction splits, schemas, hooks, link builder. No UI change.
2. PR 2 (Claude): route, page, summary card, Member read-only, switch dialog link, old screen removed, docs. After PR 1.
3. PR 3 (Codex): delete `startRemovalTemplateSetup`, `setFacilityDefaultRemovalTemplate`, fn-level `reviewRemovalTemplateLines` and their hooks once unused; port their guard tests to the apply action. After PR 2.

## 5. Tests

- PR 1 unit: `setupPlan` on the 2026-10-15 sandbox fixture and a Protocol default fixture (bootstrapped gives 0 decisions; Protocol default gives the electricity clash and the diesel source; `added` becomes a decision; no candidate gives an entry default; `assignmentsFromPlan` refusals); `templateFitsFacility` per tier, deprecated 1000-year, no storage component.
- PR 1 DB integration `tests/removal-template-setup.integration.test.ts`: Member rejected before any registry read; cross-org facility refused; archived facility refused and rolled back; stale fingerprint; a batch held by a Removal rolls back default and decisions; a batch pinned meanwhile is stale; success makes the template ready, sets the default, pins N batches with N activity events. Keep `removal-template-review-read-only.integration.test.ts`, `credit-batch-removal-template.test.ts`, `removal-template-review.test.ts` green.
- PR 2: component tests (step gating, zero-decision path, Member card without buttons, "N to decide" after an added component); planned E2E file: tests/e2e/removal-template-setup.spec.ts on the sandbox (skipped without credentials). Before | After at 1440 and 390: Settings pane, the three steps, Member card, switch dialog link target.

## Follow-ups

- Changing a component after Apply: today `reviewLineContracts` refuses decided components and written entries complicate an edit. Read-only after Apply, Change template as the repair; separate issue.
- Telling users when a template changes on Isometric: #1285.
