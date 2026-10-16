# Template-driven emissions entries: plan

- **Owner:** Kenji Nguyen
- **Status:** proposed; decisions settled 2026-10-15, no implementation yet
- **Last reviewed:** 2026-10-15, against `staging` @ `d34135911`; reviews on PR #1057 (§9)
- **Decision record:** [ADR 0032](../adr/0032-per-batch-emissions-entries-bound-to-template-lines.md) and §2 below are authoritative. Provenance only: the raw answers to two question rounds were collected on an external decisions page.

This plan authorizes no registry changes and no production submissions. Template re-authoring in Isometric is tracked separately in #1020.

## 1. Goal

Operators can fill every line of the target Removal template ("LCA based template Cula", `rvt_1M2QJGQS21S0A8H5`) per credit batch. Two kinds of line are added: lines noma cannot derive from records, and lines that need more than the run figures. Every number shows where it came from, needs evidence, and goes out once.

**Cula lines and where each gets its number** (template read on 2026-10-15; Cula's facility is 1000-year):

| Line | Blueprint / inputs | Source after this plan |
|---|---|---|
| Biomass to processing site, truck | `transport` today, `mass_distance_based_ci_emissions` after #1020 | Feedstock transport legs (unchanged) |
| Metered electricity, total site | `metered_energy_based_ci_emissions` (`initial_readout`, `final_readout`) | One meter-reading entry per batch until #1020 makes it a single kWh figure; after that, run kWh plus entries |
| Startup diesel usage | `fuel_usage_by_volume` | Run diesel plus entries |
| Generator diesel usage | `fuel_usage_by_volume` | Genset and preprocessing litres plus entries |
| Pyrolyzer CO, Pyrolyzer CH₄ | `ghg_direct_emissions` (`concentration`, `mass_flow`) | One entry per batch, both values typed |
| Biochar to storage site, truck | as the feedstock line | Delivery transport legs (unchanged) |
| CO₂ stored | legacy `carbon_rich_substance_sequestration`; 1000-year line after #1020 | Applications and lab results (unchanged) |
| Lab electricity EU, India | `grid_electricity_use` (`electricity_use`) | Entries |
| Sampling consumables | `mass_based_ci_emissions` (`mass`) | Entries |
| Sample shipping to EU, to India | `mass_distance_based_ci_emissions` (`mass_distance`) | Entries; sample transport legs no longer feed this |
| Staff travel local, flights | `distance_based_ci_emissions` (`distance`) | Entries, on a batch the operator picks |

## 2. Decisions (2026-10-15)

| Topic | Decision |
|---|---|
| Operating lines | Stay on each Removal and are entered per batch. #1020 drops the move to project level. |
| Pyrolyzer CO, CH₄ | Ordinary entries per batch, typed by the operator. The form shows Cula's line description (with the 36,792 / 17,520 formula) and the batch's dry feedstock beside the gas-mass field. Nothing is computed for the operator. |
| Entry dates (2026-10-16) | Single lines cover the whole batch and store its start date; other create dates are optional and default to facility today clamped to the batch window. Explicit dates keep their validation; updates never move single-line dates. |
| Sample shipping | Entered per line. Sample transport legs are hidden in the app, API and MCP, and stop feeding Removals. There is no production data to keep. Sample labs are deferred. |
| Lab electricity, consumables | Typed per batch with evidence. |
| Project-wide flight | Goes on one batch the operator picks. |
| Empty lines | Shown as "Not recorded" on the batch sheet (`docs/ux-writing.md`, missing values; Kenji, 2026-10-15, replacing "0 so far"). They show 0 only once confirmed. Operators can mark a line "Nothing to record" at any time with an optional note, provided it has no counting value entries or positive automatic figure. In the Removal flow, one confirmation covers the remaining empty lines and records a zero per line. |
| Extra fuel or electricity | Added on top of the run figures. The form shows the run total and the earlier entries, and the sum is sent. |
| Meter readings | While a template asks for readings, the operator enters both. The form follows the template: two fields if it has two inputs, one if it has one. |
| Late entries | Go on the next Removal from the same batch. If none is left, they go on the facility's next Removal covering their date (§7, deferred to #1059). |
| Evidence | Required, marked as a certification requirement, and the Removal cannot be submitted without it. Recorded zeros are exempt. |
| #291 chain | Superseded. #639, #640, #641, #642, #893, #626 and #638 are folded in, and #894 is closed. |
| Testing | Kenji copies Cula into the sandbox (not 1:1). Tests use a fixture of Cula as read on 2026-10-15. A read-only production key is needed before the first real submission. |
| Naming | "Emissions entry", with an "Add entry" button. "Activity" stays the history log of #1037-#1047. |
| Durability | Build for both tiers. The Cula facility is 1000-year: one credit batch per Removal (`THOUSAND_YEAR_REMOVAL_BATCH_LIMIT`, `src/data-access/certifier-removals.ts`). |
| Corrections | A submitted Removal is never corrected on noma's initiative. Edits reopen only when Isometric changes the state: a statement fails verification, or a statement noma submitted is back in DRAFT. The Removal is then marked "correction needed", and resubmitting supersedes it (Kenji, 2026-10-15). |
| Reference template | The sandbox "Dark Earth Carbon Template (15 Oct)" (`rvt_1KS4S43VPSBXA26X`, edited in place) is more correct than Cula. It is the shape #1020 brings production to: 15 components, trucks as mass × distance, single-kWh electricity, the 1000-year storage line, two lab and two sample lines, pyrolyzer CO and CH₄, and staff travel. |

## 3. What the code tells us

**Template**
- The template is a facility default, `certifier_projects.default_removal_template_id` (`src/db/schema/certification.ts`). It is validated in `src/fn/certification/facility-mapping.ts`.
- It is fetched live and uncached through `listGhgEntryTemplates` (`src/lib/isometric/projects.ts`) inside `loadFacilityCertifierFacts` (`src/fn/certification/certify-context-core.ts`).
- No definition is stored. The submission snapshot keeps the template id and a normalized sequestration slice only (`materializeRemovalSubmissionSnapshot`, `src/fn/certification/removal-submission-build.ts`).
- Isometric input type `fixed | monitored` comes from `GhgEntryTemplateComponentInput` (`src/lib/isometric/generated/certify.d.ts`). Fixed inputs carry a prebound datapoint and are never posted (`resolveTemplateInputs`, `src/fn/certification/removal-template-inputs.ts`).

**Binding**
- The catalog is keyed blueprint → input → roles by group (`SEMANTIC_BINDING_CATALOG`, `SemanticInputBinding`, `src/lib/isometric/semantic-binding-catalog.ts`). Role strategies are `aggregated-datapoint`, `measurement-sample` and `project-scope-forbidden`.
- `PERIOD_INPUT_TUPLES` (`src/lib/isometric/datapoint-mapping.ts`) is the ADR 0018 guard. The sandbox's zero stub is `allowsPeriodInputStub`.
- The two diesel components are told apart by display name (`PYROLYSIS_DIESEL_SPLIT`, `resolveDatapointSource`).
- `findUnbindableTemplateInputs` (`src/lib/isometric/template-binding-coverage.ts`) flags `unmapped | ambiguous | project-scope | unrecognized-component`.
- The only place that has `component.id`, the template input and the aggregate together is `resolveTemplateInputs`, which calls `buildCreateDatapointRequest` (`src/lib/isometric/transformers/datapoint.ts`).

**Aggregates and claims**
- `aggregateProductionRuns` and `enrichWithTransportLegs` (`src/lib/isometric/utils/aggregation.ts`) build the aggregate. `SOURCE_BUCKETS` classifies every source as production, delivery or stored.
- `omitProductionComponents` drops production components from follow-up Removals (ADR 0020).
- The production claim is two columns on `credit_batches`, reserved in `src/data-access/production-claim-reservations.ts` and stamped in `markSubmissionSubmitted` (`src/data-access/certification.ts`).
- A Removal includes production inputs when the batch is unclaimed **or claimed by that same Removal** (`productionClaimContribution`, `src/fn/certification/production-claim-policy.ts`). Retries and supersedes therefore keep their own production inputs.
- Mutation-free failures release the reservation; failures that may have reached the registry keep it (`rejectSubmissionAndReleaseProductionClaims`). Removal deletion clears claims only after registry cleanup (`finalizeRemovalDeletion`, `src/data-access/certifier-removal-deletion.ts`).

**Hashes and evidence**
- `payloadHash(semanticPayload)` drives `decideSubmissionClaim` (`src/lib/isometric/utils/submission-claim.ts`). A changed hash on a submitted Removal creates a new version that supersedes the old one. Entry values must therefore enter `semanticPayload.inputs`, and their evidence must enter `candidateSources`.
- Sources already attach per datapoint. `buildRemovalSourceBindingPlan` resolves `intendedTarget {groupKey, componentId, componentBlueprintKey, inputKey, creditBatchIds}`, and `sourceIdsForDatapointTarget` fills `source_ids` (`src/lib/certification/removal-source-bindings.ts`). Documents are classified by entity type and document type in `classifyRemovalSourceCandidate`.
- Documents are polymorphic: each row points at one `(entityType, entityId)` and an entity can have many (`src/db/schema/documentation.ts`). One file attached to two entities becomes two rows. A new entity type needs `DOCUMENT_ENTITY_TYPES` and `DOCUMENT_ENTITY_LABELS` (`src/schemas/documents.ts`) plus `assertCanManageDocumentEntity` (`src/data-access/documents.ts`).

**Locks and status**
- `BLOCKING_SUBMISSION_STATUSES = draft, submitted, accepted` (`src/lib/certification/status.ts`). `assertCanMutateCertifiedLineage` (`src/data-access/certification-lineage-guards.ts`) locks the batch lineage.
- Rejected and superseded unlock, but only when no other blocking submission covers the same lineage (`getLockedCertifiedLineage`). FAILED_VERIFICATION does not unlock on the server, though the UI predicate `isRemovalStatusLocked` treats it as editable.
- Isometric's REST `Removal` has no status. Status exists only on GHG statements (`DRAFT | AWAITING_VERIFICATION | VERIFIED | CREDITS_ISSUED | FAILED_VERIFICATION`). noma pulls it on demand through `refreshGhgStatementStatus` (`src/fn/certification/ghg-statements.ts`) and `refreshRegistryGhgStatement` (`src/fn/certification/ghg-statement-reconciliation.ts`). There is no webhook and no schedule yet.

**Readiness**
- Removal readiness reasons are strings (`deriveRemovalReadiness`, `buildRemovalRequirementsChecklist`, `src/lib/certification/readiness.ts`). Only preparation blockers are typed (`REMOVAL_PREPARATION_BLOCKERS`, `src/fn/certification/removal-submission-prepare.ts`).
- Batch health has exhaustive fix-target switches (`resolutionDestination` in `src/lib/certification/batch-health.ts`, `batch-health-links.ts`).

**UI**
- The Removal flow has two steps, select and submit (`src/components/certification/new-removal-dialog/index.tsx`). The per-input value table exists only inside the technical-details drawer (`compiled-submission-review.tsx`).
- The credit batch side sheet's sections are in `creditBatchSheetSections` (`src/components/credit-batches/credit-batch-view.tsx`). Self-fetching panels mount in `viewModeChildren` (`credit-batch-list.tsx`).
- The Energy page is `src/app/(app)/energy/page.tsx` with `src/components/energy/*` and `src/lib/energy/*`. Its batch filter is client state, not in the URL.
- The nearest reference for a small versioned, org-scoped child table with documents is production incidents (`src/db/schema/production.ts` `incidentReports`, `src/data-access/production-incidents.ts`).
- The activity log exists: `recordActivity(ctx, tx, event)` in `src/data-access/activity-events.ts` (migration 0142).
- Files near the 1000-line limit that this plan extends: `src/fn/certification/certify-context-core.ts` (974) and `src/data-access/certification.ts` (952). Split them before adding to them.

## 4. Design

### 4.1 Data model

**General rules**
- All tables carry `organizationId` and are reached only through org-scoped data-access, called from `fn/` orchestration.
- Every reference is a composite FK with `organizationId`: value to entry, entry to credit batch, claim to Removal or submission.
- Writes take `expectedVersion` (`src/data-access/row-version.ts`).
- Migration numbers are allocated against the merge base when each PR is cut. Staging is at 0142.

**`removal_template_observations`**: one row per distinct normalized definition.

| Column | Notes |
|---|---|
| `provider`, `externalProjectId`, `externalTemplateId` | |
| `semanticFingerprint` | Drives change review and the payload hash |
| `fullFingerprint` | Also covers names and descriptions; display only |
| `definition` (jsonb) | Groups, then components `{id, displayName, description, blueprintKey}`, then inputs `{key, type, quantityKind, fixedDatapointId?}` |
| `enrichment` (jsonb) | Per input: unit, fixed value and deprecation flag, or `unknown` when the read failed |
| `firstObservedAt`, `lastObservedAt` | |
| `lineSources` (jsonb) | §4.2 |

- Unique on `(organizationId, provider, externalTemplateId, semanticFingerprint, fullFingerprint)`.
- Normalization sorts groups and components by id and inputs by `input_key`, and writes numbers as canonical decimal strings, because `canonicalJson` (`src/lib/canonical-json.ts`) keeps array order. Reordering alone never changes a fingerprint.
- Units are canonicalized per quantity kind with the unit handling `buildCreateDatapointRequest` already validates. An unknown unit blocks the line.
- The semantic fingerprint covers group placement, blueprint, input keys and types, quantity kinds, fixed datapoint identity, and enriched unit and fixed value.
- Enrichment must be complete before a change review is accepted or a Removal is submitted. A failed read shows "Template not fully read" and blocks until a retry succeeds.
- A deprecated fixed datapoint is flagged in the change review and shown as a readiness advisory. It does not block, because it is Isometric's factor to replace (#1020).
- Enrichment comes from the blueprint list (`listComponentBlueprints`) and a GET of each fixed datapoint. The generated template input type carries no unit, fixed value, deprecation flag or scope.
- A row is written on every live fetch that already happens (settings, readiness, submission). An unchanged definition only bumps `lastObservedAt`.

**`credit_batches.removal_template_id`** (text, external id)
- Set on create from the facility default (`createCreditBatch`, `src/data-access/credit-batches.ts`), with no network call.
- Changing it is an explicit, audited "Switch template" action with the change review (§4.2).
- Local databases are reset; no production data exists.

**`emission_entries`**

| Column | Notes |
|---|---|
| `creditBatchId` | |
| `removalTemplateId`, `componentId`, `inputShape`, `lineRule` | The binding. `lineRule` is `additive` or `single`. |
| `observationId` | The template observation the entry was written against |
| `kind` | `value` or `zero`. `zero` is written by the Removal-flow confirmation or by an operator marking "Nothing to record" with an optional note. |
| `confirmedForRemovalId` | Set only on Removal-owned `zero` rows: the draft Removal whose confirmation wrote it. Null for operator-marked zeros, whose note is optional. Separate from the sent claim. |
| `occurredOn` | Date in the facility time zone. Not before the batch start date, not in the future. The entry window (§4.5) starts at the same date, so every accepted date has a Removal that can carry it. |
| `note`, `createdBy`, timestamps | |
| `version` | Concurrency only: bumped by every write, claims included |
| `contentRevision` | Bumped only by changes that alter what would be sent: values, date, binding or evidence |
| `deletedAt` | Tombstone. A sent entry is never hard-deleted. |
| `sentByRemovalId`, `sendReservedBySubmissionId` | Entry claim |

- Partial unique index on `(creditBatchId, removalTemplateId, componentId)` where `lineRule = 'single'`, `kind = 'value'` and `deletedAt` is null.
- **Removal-confirmed zeros** belong to the draft Removal that confirmed them, through `confirmedForRemovalId`, never through the pool of eligible entries:
  - unique per `(confirmedForRemovalId, creditBatchId, componentId)` where `deletedAt` is null; a multi-batch Removal writes one zero per member batch and line;
  - reservation, stamping and retries carry them like that Removal's other entries;
  - releasing an attempt keeps them on the draft; deleting the draft, or superseding it, tombstones them; they never return to the pool, so no other Removal can send them;
  - adding a value entry to a line tombstones that line's zeros on every unsubmitted draft that owns one.
- Isometric receives 0 for the line with no file; the note stays in noma.
- **Operator-marked zeros** have no Removal owner, have an optional trimmed note and use the same date and entry-lock rules as values. They need no file. One active operator zero is allowed per organization, batch and component. Adding a value tombstones it in the same transaction and records the deletion in activity. Operators can edit its note/date or delete it to restore "Not recorded". PR 4 claiming is tracked in [open questions](../open-questions.md#operator-marked-zeros-in-pr-4).
- On a follow-up Removal of the same batch, a `single` line whose value an earlier Removal already sent counts as sent, not empty. It is omitted like a production component (ADR 0020) and needs no zero confirmation.

**`emission_entry_values`**
- Columns: `entryId`, `inputKey`, `magnitude` (numeric), `unit`. Unique on `(entryId, inputKey)`.
- Writing a value bumps the parent's `contentRevision` in the same transaction.
- Mass × distance keeps the typed mass and distance as detail next to the `mass_distance` value. This is the one helper multiplication, shown to the operator.

**Evidence**
- A new document entity type, `emission_entry`.
- Attaching or retiring a document bumps the entry's `contentRevision` (in `src/data-access/documents.ts`).
- Entry evidence follows the entry lock, not the batch lineage guard: while an entry is reserved or sent, attaching and retiring documents are both refused, outside an open correction window (§4.5). `assertCanManageDocumentEntity` enforces this for `emission_entry` under the entry row lock. Unsent entries on a batch whose earlier Removal is submitted stay editable.
- The deferred-attachment flow (`useDeferredAttachments`) puts one file on several entries as one row per entry.

**Entry policy per input shape** (code, next to the catalog)
- `additive`: entries sum, and add to the line's automatic source if it has one. Applies to fuel volume, electricity, mass, distance and mass × distance.
- `single`: at most one active entry per batch, and never an automatic source. Applies to gas concentration with mass flow, and meter readings.
- An unsupported shape shows "Needs setup".
- The entry's `lineRule` column records the policy it was written under.

### 4.2 Template observations, line sources and change review (PR 1)

**Observing**
- `observeTemplate(ctx, template, enrichment)` lives in data-access.
- It is called from `fn/` after the fetches in `loadFacilityCertifierFacts` and `facility-mapping.ts`.
- `compareTemplateObservations(prev, next)` returns per line `unchanged | cosmetic | changed | removed | added`.

**Line contract by component ID** (replaces the display-name lookups, #638 and #893)
- `lineSources` gives each component ID a reviewed contract with three parts:
  - `scope`: `operating`, `forbidden` (establishment or end-of-life) or `unassigned`;
  - an optional automatic catalog source, for example run genset litres;
  - an `entryPolicy`: `none`, `additive` or `single`.
- `single` requires no automatic source.
- Examples: startup diesel is operating, with run diesel as its automatic source and `additive` entries. Lab electricity is operating, with no automatic source and `additive` entries. A pyrolyzer line is operating, with no automatic source and a `single` entry.
- **Bootstrap:** a checked-in mapping, keyed by component ID, for the three known templates: the sandbox "Dark Earth Carbon Template (15 Oct)" (the reference), Cula, and "Removal Template 2026-07-03". The diesel split and the two lab and sample lines are explicit there.
- **Carry forward:** a new observation of the same template keeps the assignments for surviving component IDs.
- **New component IDs**, for example after the #1020 re-authoring: the change review asks an Owner or Admin to set each contract. The choices are limited to the catalog candidates for its blueprint and the entry policies its shape allows. Until then the line is `unassigned` and blocks. This is one assignment step inside the review, not a general binding editor (#894 stays closed).
- Two lines may never share an automatic source. That is the existing `ambiguous` reason, now settled by component ID.

**Entries after a change**
- `cosmetic`: the entry keeps counting.
- `changed`, still compatible: the entry stops counting until someone confirms it. Compatible means the same input keys, the same quantity kinds, units that convert, and the same entry policy. Confirming re-stamps `observationId` and is audited.
- `removed`, or any incompatible change: the entry must be re-entered on a valid line or deleted. It can never be re-stamped.

**Batch pinning wired through compilation**
- `loadFacilityCertifierFacts` and `buildRemovalSubmissionBuild` compile against the member batches' pinned template, not the facility default.
- A Removal whose batches pin different templates is refused. Grouping only matters for 200-year Removals.
- If the pinned template is no longer listed in Isometric, the batch shows "Template no longer exists in Isometric" with the Switch template action. noma never substitutes the default and never submits a stored copy.
- A batch created while its facility has no default template stays unpinned. Creation still works, but readiness and submission block ("Choose a Removal template") until Switch template sets a pin.

**Also in this PR**
- Split `certify-context-core.ts` before extending it.
- Folds #639, #642 (drift tests over fingerprinted fixtures) and #626.
- Fixtures in `tests/fixtures/isometric/`: the sandbox 15 Oct template (read over sandbox REST on 2026-10-15), a new Cula fixture captured through the MCP read, and the existing 2026-07-03 production fixture.

### 4.3 Line states and one preflight gate (PR 2)

**Two pure functions**
- `deriveBatchEmissionLines(batchFacts)` is for the batch sheet and the Emissions page. Per line it returns a state, the batch-wide automatic figure, the entries and the total:
  - `filled`
  - `empty` ("Not recorded")
  - `missingEvidence` (certification blocker)
  - `needsReview`
  - `needsSetup`
  - `confirmedZero`
- `deriveRemovalEmissionContributions(removalFacts)` is for Removal readiness and submission. It takes the Removal's window, the claim and reservation state, and the member batches. Per line it returns what this Removal would send and why (§4.5).

**Typed blockers**
- `RemovalBlocker {code, message, fixTarget, lineRef?}` replaces strings for emissions.
- Existing string reasons are wrapped with `code: "legacy"` and migrated as they are touched.
- The set keeps every existing fix target, including `deliveryEvidence` (proof of delivery, #1035; `submission-readiness.ts`, `certify-lineage-blockers.ts`), the Sample moisture descriptor gap (#1048, through entity readiness gaps) and `durabilityConfigurationBlockers` (#1024, computed once in `certify-context-core.ts`).
- A new batch-health check key and fix target `emissions` go into both exhaustive switches (`resolutionDestination`, `batch-health-links.ts`).

**Coverage**
- `unassigned`, `forbidden` and unsupported lines block in the same way in coverage (`findUnbindableTemplateInputs`), readiness and submission.

**Folds and coordination**
- Folds #641, #640 (dropped facts become `needsReview`) and #645 (`evaluateRemovalBlockers` as the single preflight gate).
- #1016's readiness-vs-submission predicates are merged (#1024), and its owner has no open readiness or submit work. PR 2 builds on them.

### 4.4 Entries and the Emissions page (PR 3)

**Rename**
- Energy becomes Emissions in the sidebar and the page title. `/energy` redirects to `/emissions`.
- Module names (`src/lib/energy`, `energyKeys`, `fn/energy`) stay.
- Update `tests/e2e/energy.spec.ts`, `mobile-responsive.spec.ts`, the visual capture route, `GLOSSARY.md` and the settings copy.
- `GLOSSARY.md` gains **Emissions entry** (_Avoid_: activity) in this PR. PR 4 adds **Recorded zero** (distinct from the sandbox zero stub) and amends **Credit batch** and **Removal** for per-entry claims.

**Per-batch view**
- The batch filter and period preset move into the URL (#841).
- A selected batch shows every line of its template, with its state from §4.3, the automatic figure, the entries and the total.
- "Nothing to record" is available on eligible lines at any time, with an optional note and optional date defaulting to today at the facility. One tap marks the line; the optional note can be added later or never. An operator zero can be edited or deleted until reserved or sent.
- Facility activity totals include counting value entries only on lines with a facility energy automatic source, never manual-only lab or travel lines.
- "Add entry" opens the form for that line's shape. Estimates (ADR 0031) keep their "est." treatment.

**Forms**
- Single lines take no operator date and store the batch start; other create dates are optional, defaulting to facility today clamped to the batch window (Kenji, 2026-10-16).
- Each form shows the line name and description, the unit, the existing figures and an evidence drop zone.
- Forms follow `docs/forms.md` and `docs/ux-writing.md`.
- An additive form says "Adds to 120 L from runs" before save.

**Batch sheet**
- A self-fetching Emissions panel in `viewModeChildren`, between production runs and notes.
- It shows the lines still "Not recorded" or missing a file, and links to the Emissions page filtered to the batch.

**Sample legs** (behind the activation gate, §5)
- Hide the sample form Transport step (`SampleTransportSection`) and the sample read summary.
- Refuse new `entityType: "sample"` legs in `src/data-access/transport-legs.ts` and the API and MCP schemas.
- The aggregation change waits for PR 4 (§4.5), so sample shipping is never unsent between PRs.

**Activity and #973**
- Entry create, update and delete record activity under a new entity type `emission_entry`. Add it to `ACTIVITY_ENTITY_TYPES` (`src/db/schema/common.ts`) and to the DB CHECK, with a migration.
- Writes that go through the operation runner are recorded by the runner from `describe()` (#1040), so they must not call `recordActivity` as well. Other writers call it in the same transaction.
- Entry activity follows the `src/lib/activity-field-policy.ts` classification (#1103): note and the values list are name-only. Events set `creditBatchId`.
- A credit batch spans at most a month, so a batch-level fuel or electricity entry is the monthly bulk entry. #973 closes with this PR.

### 4.5 Submission, snapshots and claims (PR 4)

**What a Removal sends per line**
- Production-bucket automatic sources follow the batch claim: included when the batch is unclaimed or claimed by this Removal (`productionClaimContribution`).
- Delivery- and stored-bucket automatic sources stay application-scoped, as today (delivery transport, `Safety margin`).
- Entries are added on top of the automatic figure.
- `omitProductionComponents` keeps a production component on a follow-up Removal when it has entries to send, and sends only those.

**Which entries a Removal sends**
- Only a Removal that can still take contributions is a contender: a draft that has not been submitted, or a Removal whose correction window is open (Corrections, below). A submitted Removal's manifest is frozen otherwise.
- A Removal in an open correction window takes edits to the entries it sent, and new entries dated in its window. While the window is open it ranks before drafts for those entries, because the correction is why it reopened.
- The entry window of a Removal is date-granular: from the earliest batch start date among its member batches to its latest application date. Application dates are calendar dates as entered (stored at UTC midnight, `resolveRemovalReportingWindow` in `src/fn/certification/removal-reporting-window.ts`) and are compared as dates, never shifted by a time zone. `occurredOn` is the facility-local date. The reporting window sent to Isometric is unchanged.
- An entry is eligible for a Removal when all of these hold:
  - it belongs to a member batch;
  - it is not deleted;
  - it is unclaimed or claimed by this Removal;
  - its `occurredOn` falls in the Removal's entry window.
- Several Removals of one batch can have overlapping windows. One deterministic rule picks the owner of each eligible entry:
  - an existing live reservation or claim wins;
  - otherwise the eligible Removal with the earliest window end, then the earliest draft creation, then the lowest id.
  - This rule is only for entry contenders. It does not reuse the production contender ordering (`listProductionClaimDraftContenders`, by reporting quarter).
- An entry outside every window waits and blocks the batch with "No Removal can carry this entry yet". If the batch is fully applied, #1059 sends it on the facility's next Removal (§7).
- A 200-year Removal grouping two batches that both have an entry on the same `single` line is refused in v1. Paired inputs are never summed one input at a time. Whether Isometric accepts list-shaped inputs (`InputDataShape: LIST`) for these lines is a follow-up.

**Reservation and claims**
- Atomic with the production claim. One transaction locks the batch rows, then the entries in id order.
- It revalidates entry `contentRevision` and membership against the reviewed compilation, then reserves both claim sets.
- A reserved entry refuses edits, value changes and evidence deletion until it is stamped or released.
- Every writer that changes membership takes the same batch lock first: creating an entry, or changing its date, batch, binding or tombstone. While an attempt holds a reservation for that batch, such a write succeeds, but the entry joins the next contribution and never the running attempt.
- Reservation takeover and exact-attempt stamping checks are inherited unchanged from `production-claim-reservations.ts`.
- Stamping happens in `markSubmissionSubmitted`.
- Release follows `rejectSubmissionAndReleaseProductionClaims`: release on mutation-free failure, keep on an ambiguous one.
- Removal deletion releases entry claims only in `finalizeRemovalDeletion`, after registry cleanup.
- Retries resume with the frozen entry set from the snapshot.

**Guard**
- A line can carry entries only when its contract is `operating` with an entry policy other than `none`. An entry existing on it is not enough.
- Additive entries go alongside an automatic source when the contract has both, including entry-only follow-ups.
- `forbidden` and `unassigned` lines stay blocked.
- The sandbox zero stub is removed.

**Snapshot and hash**
- `semanticPayload` gains the semantic fingerprint and a contribution manifest per input: entry id, `contentRevision`, values and evidence document ids. Any change that alters what is sent therefore moves `payloadHash`.
- `reviewPayloadHash` keeps these fields; it only strips registry Source ids and generated ledgers.
- The materialized snapshot stores the observation id.
- A DB trigger refuses updates to `payload_snapshot` once the status leaves draft.

**Evidence binding**
- `buildRemovalSourceBindingPlan` gains explicit `{componentId, inputKey}` targets, validated against the entries being sent.
- Evidence for a paired-input entry is attached to each of its datapoints.
- Existing automatic evidence is kept.
- Snapshot readers (`removal-snapshot-readers.ts`) learn the new role.

**Removal flow**
- The submit step gets a "Lines sent" section, promoted from the technical drawer. It shows every line with its value, its source and its files.
- Empty lines are grouped behind one "These n lines had nothing this batch" confirmation, which writes `kind: zero` entries.
- Submit stays blocked until confirmed.

**Sample legs**
- `sampleTransportMassDistanceTonneKm` leaves aggregation, the catalog, `certify-field-registry.ts`, transport coverage, readiness and dashboard gaps, behind the activation gate.
- Drop the sample row from `docs/isometric/sandbox-template-authoring.md`, record the change in `docs/isometric/changes.md`, and update the assertion in `tests/isometric-sandbox-health.integration.test.ts`.
- `isometric/sample-transport-template-drift` is resolved when the gate is switched on, not when PR 4 merges.

**Corrections**
- "Correction needed" is derived, not stored, and only inside an open correction window: the snapshot's contribution manifest differs from the current entries.
- Once a Removal is submitted, the entries it sent stay locked, as today. noma never corrects a submitted Removal on its own initiative.
- Edits reopen only after Isometric changes the state, and only when all of these hold:
  - a statement covering the lineage, freshly refreshed, is FAILED_VERIFICATION, or is back in DRAFT after it was sent to the verifier. `ghgStatementSubmissionId` is not enough: creating a statement already marks its ledger row submitted with remote status DRAFT (`finalizeGhgStatement`). "Sent to the verifier" follows #1101: a marker PR 4 records in `submitGhgStatementToVerifierCore`, or Certify's own record of a submission (REST `GhgStatement.submitted_at`, GraphQL `GhgStatement.submissions`), because a statement can be submitted from the Certify web UI and noma only learns of it on Refresh or Sync. A noma-only marker would leave such a statement locked after it returns to DRAFT;
  - no other statement covering it is AWAITING_VERIFICATION, VERIFIED or CREDITS_ISSUED, and an unknown status fails closed;
  - no submission for the lineage is in flight;
  - the edit runs under the lineage locks of `getLockedCertifiedLineage`, serialized against statement submission.
- Resubmitting supersedes.
- `MAPPING_REVISION` bumps once in this PR. Split `src/data-access/certification.ts` before extending it.

### 4.6 Wider amendment flow (PR 5)

Kenji's round 2 note asks to reopen general edits when Isometric pushes a submission back, as before submission.

- **Change:** under the same conditions as §4.5 Corrections, unlock the lineage guard for the rest of the lineage, not only entries. Resubmitting relocks it.
- **Ownership:** the app-wide lock predicate (#1101; a prerequisite, §5) owns the Open, In use and Sent levels and the lock predicates (`BLOCKING_SUBMISSION_STATUSES`, `REMOVAL_LOCK_BY_KIND`). PR 4 and PR 5 call that rule's predicate rather than adding their own.
- **Shared lineage:** a record that also backs a verified Removal stays locked.
- **Sync:** status comes from the refresh paths and from the scheduled registry sync of #1047 once it exists.
- **Prerequisite:** none from Isometric, since Kenji decided the trigger on 2026-10-15. Folds item 1 of #687.

## 5. Delivery

| PR | Scope | Folds or closes | Implementer |
|---|---|---|---|
| 1 | Template observations and fingerprints, line sources by component ID with bootstrap and review assignment, batch pinning through compilation, fixtures, split of `certify-context-core.ts` | #639, #642, #626, #638, #893 | gpt-6.1-sol, cross-reviewed by gpt-6-astra |
| 2 | Line-state functions, typed blockers, one preflight gate, coverage alignment | #640, #641, #645 | gpt-6-astra |
| 3 | Entry tables, data-access and fn, Emissions rename and per-batch view, forms, batch panel, sample-leg UI hidden | #841, #973 | Server: gpt-6.1-sol. UI: Opus agent with the frontend-design skill. |
| 4 | Contributions and claims, reservation, guard, snapshot and trigger, evidence targets, Lines sent step, sample-leg aggregation removed, corrections after push-back | #291 | gpt-6-astra, reviewed with pr-review-suite |
| 5 | Lineage unlock on push-back | #687 item 1 | gpt-6-astra, after PR 4 and the app-wide lock predicate |

**Merge order:** 1, then 2, then 3, then 4. PR 3's server half can be developed next to PR 2 but merges after it. The app-wide lock predicate (§4.6) is a prerequisite of PR 4's Corrections part; if it has not landed when the rest of PR 4 is ready, the Corrections part moves to PR 5, which waits for it too. The first real submission waits for Corrections.

**Activation gate:** one server-side flag, `EMISSIONS_ENTRIES_ENABLED`, read through `envSchema` and off by default. It covers entry UI, API and MCP availability, and the sample-leg retirement, including PR 4's removal of sample legs from aggregation and the catalog. PR 3 merges with it off, and it is switched on only once PR 4 is deployed. With it off, sample legs keep working as today.

**Working rules**
- Claude verifies each PR, commits, and runs E2E in the PR's worktree (`scripts/worktree.sh`).
- Every Codex prompt bans database commands.
- Merges need Kenji's explicit OK.

**Known gap until the gate is on:** the edited sandbox template has two sample shipping lines. Before PR 1 they share one source and noma flags them as `ambiguous`; from PR 1 they have no automatic source and stay unfillable until entries exist. Sandbox Removals, including the nightly `certification-full-removal-submit.spec.ts` that #1054 un-skipped, stop at "components noma cannot submit" until PR 4 lands and `EMISSIONS_ENTRIES_ENABLED` is on in the sandbox and nightly environments.

**Before the first real submission**
- #1020 re-authoring is done, and the bootstrap mapping covers the new component IDs.
- The Cula fixture is captured.
- Production is read through a read-only key and matches the fixture.
- `EMISSIONS_ENTRIES_ENABLED` is on in the sandbox and nightly environments.
- A full rehearsal against the sandbox "Dark Earth Carbon Template (15 Oct)": entries with files, confirmed zeros, a follow-up Removal, and a correction after a statement fails verification.

**Tests**
- Unit tests:
  - normalization, both fingerprints and the comparison (reordering is a no-op);
  - line rules and contributions, including an entry dated on the application day in a facility west of UTC, an entry dated on the batch start date, the zero lifecycle (release, draft deletion, a value added after a zero), mixed production ownership, entry-only follow-ups, overlapping windows, backdated entries, dates after the last application, a 1000-year batch reaching a second Removal through later applications, and the refused two-batch `single` grouping.
- Real-DB tests:
  - the entry and production reservation race;
  - rollback on mutation-free and ambiguous failures;
  - the edit refusal on reserved entries;
  - tombstones in the manifest;
  - the snapshot trigger;
  - org-consistent composite FKs.
- E2E: add an entry with a file, see it on the batch sheet, confirm empty lines and submit against the sandbox copy.
- Pin the new `MAPPING_REVISION` in `tests/semantic-binding-catalog.test.ts`.

## 6. Out of scope

- Shared or allocated entries across batches.
- Sample labs and the return of sample legs.
- Stored yearly direct-emissions tests and derived lab figures.
- Splitting a meter period across overlapping batches.
- A general binding editor (#894, closed).
- Fuel entries independent of batches.
- Project-level components: establishment and end-of-life stay in Isometric.
- List-shaped inputs for multi-batch `single` lines.

## 7. A late entry when its batch has no Removal left

Decided by Kenji on 2026-10-15, and deferred to #1059, after PR 4:
- The entry goes on the facility's next Removal whose window covers its date, even from another batch.
- The entry keeps its own batch.
- Until #1059 ships, the entry shows "Not sent" and blocks its batch.

## 8. Risks and checks

- **Hash churn.** Entry edits supersede sent Removals. The derived "correction needed" state and the edit window keep this explicit.
- **Window edge.** An entry dated after its batch's last application has no Removal to go on until #1059 ships. It shows as blocking on the batch, and is never silently dropped.
- **Additive double count.** It cannot be detected. The form shows the run total, and the batch panel lists run and entry sources side by side.
- **Template fetch cost.** Observations are written on fetches that already happen. No new polling.
- **Verify protocol wording verbatim before gating.** The quotes in ADR 0032 came through the MCP; re-read them against https://registry.isometric.com/protocol/biochar/1.1 before PR 4 merges.

## 9. Review log

gpt-6-astra reviewed this plan twice on 2026-10-15, and the PR review suite reviewed it twice on #1057. Every accepted finding is folded into the sections above; the finding-by-finding record is on PR #1057.
