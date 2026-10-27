import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import type { OrgContext } from "@/lib/auth/server";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { compileRemovalCorrectionContent } from "@/fn/certification/removal-correction-compile-core";
import { buildRemovalContext } from "@/fn/certification/removal-context-build";
import { resolveScopeForRemoval } from "@/fn/certification/removal-scope";
import { storedRemovalTemplateFacts } from "@/fn/certification/stored-removal-template";
import { generatedEvidenceFacts } from "@/fn/certification/generated-evidence-facts";
import { compareRemovalCurrentContent } from "@/fn/certification/removal-content-comparison-core";
import { getFacilityById } from "@/data-access/facilities";
import { getCertifierProjectByFacility } from "@/data-access/certification";

function returnedOrgContext(adminUserId: string): OrgContext {
  return { organizationId: DEC_ORG_ID, userId: adminUserId, orgRole: "admin" as const, isPlatformAdmin: true };
}

/** Compile the sent state with the real server cores (Playwright's loader only transforms static imports).
 * No Vitest mocks: the same registry preload serves the worker's lineage reads.
 */
export async function compileReturnedRemovalSnapshot(removalId: string, adminUserId: string, observation: RemovalTemplateObservation) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- patches this worker's fetch only when seeding
  require("../helpers/returned-removal-registry-stub.cjs");
  const ctx = returnedOrgContext(adminUserId);
  const semantic = await compileRemovalCorrectionContent(ctx, removalId, observation);
  if (!semantic) throw new Error("Returned Removal fixture did not compile its sent state.");
  // Rebuild the identical read-only context for the ledger facts. Playwright
  // has no vi.spyOn; the semantic payload above still comes from the real core.
  const scope = await resolveScopeForRemoval(ctx, removalId);
  const [facility, mapping] = await Promise.all([
    getFacilityById(ctx, scope.facilityId),
    getCertifierProjectByFacility(ctx, scope.facilityId, "isometric"),
  ]);
  const facts = storedRemovalTemplateFacts(observation);
  const context = await buildRemovalContext(ctx, scope, {
    facilityTimezone: facility.timezone, mapping, hasOrgCredentials: true, project: null,
    currentTemplate: facts.template, missingCurrentTemplateId: null,
    templatesById: { [observation.externalTemplateId]: facts },
    blueprintsForTemplate: facts.blueprintsForTemplate, unresolvedBlueprintKeys: [],
    unbindableTemplateInputs: [], requiredTransportCategories: facts.requiredTransportCategories,
  }, { correctionRead: true });
  return {
    semantic, generatedEvidenceFacts: generatedEvidenceFacts(context),
    templateObservationId: observation.id, frozenEntrySet: [],
  };
}

/** Fail at seeding with the real compiler refusal, rather than timing out on UI copy. */
export async function assertReturnedRemovalComparison(removalId: string, adminUserId: string, expectedComponents?: readonly string[]) {
  const comparison = await compareRemovalCurrentContent(returnedOrgContext(adminUserId), removalId);
  if (comparison.kind === "unavailable") {
    throw new Error(`Returned Removal ${removalId} cannot compile: ${comparison.unavailableMessages.join("; ") || comparison.reason}`);
  }
  if (!expectedComponents) return; // Explicit sentSemantic overrides may describe a different sent state.
  const expectedKind = expectedComponents.length ? "changed" : "unchanged";
  const actualComponents = [...comparison.state.changedComponentIds].sort();
  if (comparison.kind !== expectedKind || JSON.stringify(actualComponents) !== JSON.stringify([...expectedComponents].sort())) {
    throw new Error(`Returned Removal ${removalId}: expected ${expectedKind} (${expectedComponents.join(", ")}), got ${comparison.kind} (${actualComponents.join(", ")}).`);
  }
}
