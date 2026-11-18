import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { removalTemplateObservations as observations } from "@/db/schema";
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { entryLine } from "@/lib/certification/emission-entry-rules";
import { allowedFilePolicies, effectiveFilePolicy } from "@/lib/isometric/template-observations/file-policies";
import { setComponentFilePolicySchema, type SetComponentFilePolicyInput } from "@/schemas/component-file-policy";
import { acquireTemplateObservationLock, getLatestTemplateObservation } from "./removal-template-observations";
import { assertRowVersion, nextVersion, staleRowVersion } from "./row-version";
import { recordActivity } from "./activity-events";
import { requireOrgScope } from "./utils";

/** Proof changes preserve the contract used to decide entry compatibility. */
export async function setComponentFilePolicy(ctx: OrgContext, input: SetComponentFilePolicyInput) {
  requireOrgScope(ctx);
  requireOrgRole(ctx, "admin");
  const data = setComponentFilePolicySchema.parse(input);
  return db.transaction(async tx => {
    const [target] = await tx.select().from(observations).where(and(
      eq(observations.organizationId, ctx.organizationId), eq(observations.id, data.observationId),
    ));
    if (!target) throw new DomainError("not_found", "Removal template observation was not found.");
    await acquireTemplateObservationLock(ctx, tx, target.provider, target.externalTemplateId);
    const row = await getLatestTemplateObservation(ctx, target.provider, target.externalTemplateId, tx);
    if (!row || row.id !== target.id) throw staleRowVersion("removal_template_observation", target.id);
    assertRowVersion({ entity: "removal_template_observation", id: row.id,
      expectedVersion: data.expectedVersion, actualVersion: row.version });
    const line = entryLine(row, data.componentId);
    if (!line || !allowedFilePolicies(line.contract).includes(data.filePolicy))
      throw new DomainError("validation_failed", "This proof setting is not available for this component. Choose another setting.");
    const [saved] = await tx.update(observations).set({
      lineSources: { ...row.lineSources, [data.componentId]: { ...row.lineSources[data.componentId], filePolicy: data.filePolicy } },
      version: nextVersion(observations.version), updatedAt: new Date(), reviewedAt: new Date(), reviewedByUserId: ctx.userId,
    }).where(and(eq(observations.organizationId, ctx.organizationId), eq(observations.id, row.id))).returning();
    await recordActivity(ctx, tx, {
      entityType: "removal_template_observation", entityId: row.id, action: "updated", source: "form",
      reasonCode: `component-proof:${data.componentId}`, changedFields: ["filePolicy"],
      changes: { filePolicy: { from: effectiveFilePolicy(line.contract), to: data.filePolicy } },
      versionBefore: row.version, versionAfter: saved.version,
    });
    return saved;
  });
}
