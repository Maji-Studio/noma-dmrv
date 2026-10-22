import { z } from "zod";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { loadRemovalCorrectionFacts } from "@/data-access/removal-entry-correction";
import { loadBatchEmissionEntryFacts } from "@/data-access/emission-entry-facts";
import { loadEmissionEntryReservations } from "@/data-access/emission-entry-contenders";
import { getTemplateObservationById } from "@/data-access/removal-template-observations";
import { getFacilityById } from "@/data-access/facilities";
import { getCertifierProjectByFacility } from "@/data-access/certification";
import { entryInputManifestSchema, type EntryContender } from "@/lib/certification/removal-emission-contributions";
import { deriveEntryCorrection, buildRemovalCorrection, type EntryCorrectionState } from "@/lib/certification/removal-entry-correction";
import { deriveRemovalSemanticCorrection, REMOVAL_CONTENT_COMPONENT_ID } from "@/lib/certification/removal-semantic-correction";
import { deriveRemovalEntryInputs } from "@/lib/certification/removal-entry-inputs";
import { resolveScopeForRemoval } from "./removal-scope";
import { buildRemovalContext } from "./certify-context-core";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import { storedRemovalTemplateFacts } from "./stored-removal-template";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";
import { prepareRemovalSubmission } from "./removal-submission-prepare";

const snapshotSchema = z.object({ semantic: z.record(z.string(), z.unknown()), templateObservationId: z.string().optional() });
const entriesSchema = z.array(entryInputManifestSchema);

/** DB-only read. The caller must hold the statement artifact lock when using
 * this result to authorize verifier submission. No registry or storage I/O.
 */
export async function loadRemovalEntryCorrection(orgCtx: OrgContext, removalId: string, suppliedContenders?: EntryContender[]): Promise<EntryCorrectionState> {
  const loaded = await loadRemovalCorrectionFacts(orgCtx, removalId, suppliedContenders);
  if (!loaded) return deriveEntryCorrection(false, [], []);
  const { submitted, batches, contenders, correction, observation, identity } = loaded;
  const ids = batches.map(batch => batch.id);
  if (!observation) {
    const snapshot = snapshotSchema.safeParse(submitted.payloadSnapshot);
    const state = deriveRemovalSemanticCorrection({ windowOpen: true,
      previous: snapshot.success ? snapshot.data.semantic : {}, current: null,
      previousEntries: [], currentEntries: [], componentIds: [], batchIds: ids });
    return { ...state, removalId, removalCode: identity.code,
      correction: buildRemovalCorrection({ removalId, removalCode: identity.code, state,
        statement: { ...correction.returnedStatement!, reportingPeriodStartOn: identity.reportingPeriodStartOn,
          reportingPeriodEndOn: identity.reportingPeriodEndOn },
        batches: batches.map(({ id, code }) => ({ id, code })),
        components: [{ id: REMOVAL_CONTENT_COMPONENT_ID, displayName: "Removal content" }] }),
    };
  }
  const facts = await Promise.all(ids.map(id => loadBatchEmissionEntryFacts(orgCtx, id, observation)));
  const entries = facts.flatMap(fact => fact.entries);
  const reservations = await loadEmissionEntryReservations(orgCtx, entries.flatMap(entry => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []));
  const currentEntries = deriveRemovalEntryInputs({ removalId, memberBatchIds: ids, window: correction.window,
    contenders, entries, observation, reservations, nowMs: Date.now() });
  const snapshot = snapshotSchema.safeParse(submitted.payloadSnapshot);
  const previous = snapshot.success ? snapshot.data.semantic : {};
  const previousEntries = entriesSchema.safeParse(previous.entryContributions);
  let current: Record<string, unknown> | null = null;
  try {
    const scope = await resolveScopeForRemoval(orgCtx, removalId);
    const [facility, mapping] = await Promise.all([
      getFacilityById(orgCtx, scope.facilityId),
      getCertifierProjectByFacility(orgCtx, scope.facilityId, "isometric"),
    ]);
    const templateFacts = storedRemovalTemplateFacts(observation);
    const facilityFacts: FacilityCertifierFacts = {
      facilityTimezone: facility.timezone, mapping, hasOrgCredentials: true, project: null,
      currentTemplate: templateFacts.template, missingCurrentTemplateId: null,
      templatesById: { [observation.externalTemplateId]: templateFacts },
      blueprintsForTemplate: templateFacts.blueprintsForTemplate, unresolvedBlueprintKeys: [],
      unbindableTemplateInputs: [], requiredTransportCategories: templateFacts.requiredTransportCategories,
    };
    // Suppress correction projections and storage summaries only. Keep all
    // compilation validation; invalid current records cannot equal sent content.
    const context = await buildRemovalContext(orgCtx, scope, facilityFacts, undefined, false, true);
    const { prepared } = prepareRemovalSubmission(context);
    if (prepared) current = (await buildRemovalSubmissionBuild({ orgCtx, removalId, ctx: context, prepared })).semanticPayload;
  } catch (error) {
    if (!(error instanceof SafeError)) throw error;
    // An invalidated submission needs correction too. Never swallow infrastructure
    // failures or mistake a failed compile for unchanged sent content.
  }
  const components = [observation, ...facts.flatMap(fact => [...fact.previousObservations.values()])]
    .flatMap(item => item?.definition.groups.flatMap(group => group.components) ?? []);
  if (snapshot.success && snapshot.data.templateObservationId) {
    const sentObservation = await getTemplateObservationById(orgCtx, snapshot.data.templateObservationId);
    components.push(...(sentObservation?.definition.groups.flatMap(group => group.components) ?? []));
  }
  const state = deriveRemovalSemanticCorrection({ windowOpen: true, previous, current,
    previousEntries: previousEntries.success ? previousEntries.data : [], currentEntries: currentEntries.manifest,
    componentIds: observation.definition.groups.flatMap(group => group.components.map(component => component.id)), batchIds: ids });
  return { ...state, removalId, removalCode: identity.code,
    correction: buildRemovalCorrection({ removalId, removalCode: identity.code, state,
      statement: { ...correction.returnedStatement!, reportingPeriodStartOn: identity.reportingPeriodStartOn,
        reportingPeriodEndOn: identity.reportingPeriodEndOn },
      batches: batches.map(({ id, code }) => ({ id, code })), components }),
  };
}
