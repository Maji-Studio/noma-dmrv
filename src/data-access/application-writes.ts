import type { CaptureActivity } from "@/lib/activity-changes";
/**
 * One sequence for create/update/delete: discover application, deliveries,
 * facilities, provenance/current-share runs and linked/slice-owning batches;
 * sorted artifact union; sorted facilities SHARE; runs SHARE; batches SHARE;
 * deliveries UPDATE; application UPDATE and version; revalidate lineage and
 * discovered sets; application slices UPDATE; writes and document retirement.
 * Never lock a newly discovered row late. See application-write-scope.ts for
 * the cross-writer proof, including artifacts-first credit-batch membership.
 */
import { and, eq, ne, sum } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applications, applicationOutputAllocations, creditBatchApplications, soilTemperatureMeasurements, type Application } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { applicationRefusal, assertApplicationCapacity, assertApplicationDate, resolveApplicationDryMassTons } from "@/lib/application-write-rules";
import { isPositiveApplicationFieldSize } from "@/lib/application-field-size";
import { kgToTonnes, tonnesToKg } from "@/lib/calculations/unit-conversions";
import { withFeedstockErrors } from "@/lib/feedstock-domain-errors";
import { validationFailed } from "@/lib/operations/errors";
import { applicationEvidenceStateSchema } from "@/schemas/applications";
import type { RecordApplicationInput, UpdateApplicationInput, DeleteApplicationInput } from "@/schemas/application-input";
import { parseGisBoundary } from "@/schemas/gis-boundary";
import { z } from "zod";
import { lockApplicationWriteScope, applicationNotFound } from "./application-write-scope";
import { withUniqueCodeGuard } from "./code-generator";
import { saveApplicationOutputAllocations, getDeliveryAllocationProvenance } from "./delivery-allocation-provenance";
import { reconcileUnassignedCreditBatchApplicationSlices } from "./credit-batch-application-slices";
import { retireDocumentsForEntities } from "./documents";
import { massGrams } from "./delivery-allocation-math";
import { nextVersion } from "./row-version";
import { getApplicationOperationOutput, getApplicationRemainingWetMassKg } from "./application-operation-output";
import { requireOrgScope } from "./utils";
import { resolveWriteActivityScopes, type ActivityScope } from "./write-activity";
import type { ActivityEventInput } from "./activity-events";

const IMMUTABLE_CREDIT_BATCH_STATUSES = new Set<string>(["verified", "issued"]);
type Scope = Awaited<ReturnType<typeof lockApplicationWriteScope>>;
function optionalText(value: string | null | undefined) { return value?.trim() || null; }
function validateFieldSize(fieldSizeHa: number, code: string) {
  if (!isPositiveApplicationFieldSize(fieldSizeHa)) throw applicationRefusal("validation_failed", "fieldSizeHa", `Application ${code} needs a field size greater than 0 ha. Enter a field size and save again.`);
}
function validateEvidence(data: Parameters<typeof applicationEvidenceStateSchema.parse>[0], fieldSizeHa: number, code: string) {
  validateFieldSize(fieldSizeHa, code);
  const result = applicationEvidenceStateSchema.safeParse(data);
  if (!result.success) throw validationFailed(new z.ZodError(result.error.issues.map(issue => ({ ...issue, path: issue.path[0] === "gpsLongitude" ? ["gpsLatitude"] : issue.path }))));
}
/** Recompute envelope measurements here. */
function reparseBoundaryEnvelope(value: RecordApplicationInput["gisBoundary"]) {
  if (value == null) return null;
  try { return parseGisBoundary(value); } catch (error) {
    if (error instanceof z.ZodError) throw validationFailed(new z.ZodError(error.issues.map(issue => ({ ...issue, path: ["gisBoundary", ...issue.path] }))));
    throw error;
  }
}
function writableDelivery(scope: Scope, deliveryId: string, date: Date, checkFutureDate = true) {
  const delivery = scope.deliveries.find(row => row.id === deliveryId);
  const facility = scope.facilities.find(row => row.id === delivery?.facilityId);
  if (!delivery || !facility || delivery.archivedAt || facility.archivedAt) throw applicationNotFound("delivery");
  if (delivery.status !== "delivered") throw applicationRefusal("validation_failed", "deliveryId", `Delivery ${delivery.code} is not marked as delivered. Mark it as delivered before recording an application.`);
  assertApplicationDate(date, delivery.deliveryDate, facility.timezone, delivery.code, checkFutureDate ? new Date() : null);
  return delivery;
}
function assertMutableSlices(scope: Scope, mutation: "update" | "delete") {
  if (scope.slices.some(slice => slice.removalId)) throw applicationRefusal("certification_locked", "applicationId", `Cannot ${mutation} this Application because its applied mass belongs to a Removal.`);
}
async function dryMass(ctx: OrgContext, tx: DbTransaction, delivery: Scope["deliveries"][number], wetKg: number, excludeId?: string) {
  requireOrgScope(ctx);
  const [{ wet, dry }] = await tx.select({ wet: sum(applications.biocharAppliedTons), dry: sum(applications.biocharAppliedDryTons) }).from(applications)
    .where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.deliveryId, delivery.id), excludeId ? ne(applications.id, excludeId) : undefined));
  const alreadyAppliedWetKg = tonnesToKg(Number(wet ?? 0));
  assertApplicationCapacity(delivery.deliveredWetMassKg, alreadyAppliedWetKg, wetKg);
  await withFeedstockErrors(() => getDeliveryAllocationProvenance(ctx, [delivery.id], tx), "conflict", ["deliveryId"]);
  return resolveApplicationDryMassTons({ requestedWetKg: wetKg, deliveryWetKg: delivery.deliveredWetMassKg, deliveryDryBiocharKg: delivery.massDryKg, alreadyAppliedWetKg, alreadyAppliedDryKg: tonnesToKg(Number(dry ?? 0)) });
}
async function saveShares(ctx: OrgContext, tx: DbTransaction, application: Application) {
  requireOrgScope(ctx);
  await withFeedstockErrors(() => saveApplicationOutputAllocations(ctx, tx, application), "conflict", ["deliveryId"]);
}
async function readApplicationAllocations(ctx: OrgContext, tx: DbTransaction, applicationId: string) {
  requireOrgScope(ctx);
  return tx.select().from(applicationOutputAllocations)
    .where(and(eq(applicationOutputAllocations.applicationId, applicationId), eq(applicationOutputAllocations.organizationId, ctx.organizationId)))
    .orderBy(applicationOutputAllocations.id);
}
export async function createApplicationInTransaction(ctx: OrgContext, tx: DbTransaction, input: RecordApplicationInput & { code: string }, capture?: CaptureActivity) {
  requireOrgScope(ctx);
  validateFieldSize(input.fieldSizeHa, input.code);
  const scope = await lockApplicationWriteScope(ctx, tx, { mutation: "create", deliveryId: input.deliveryId });
  const delivery = writableDelivery(scope, input.deliveryId, input.applicationDate);
  validateEvidence(input, input.fieldSizeHa, input.code);
  const biocharAppliedDryTons = await dryMass(ctx, tx, delivery, input.appliedWetMassKg);
  const remainingBefore = await getApplicationRemainingWetMassKg(ctx, tx, delivery.id);
  const [application] = await tx.insert(applications).values({
    organizationId: ctx.organizationId, code: input.code, status: "applied", deliveryId: input.deliveryId, applicationDate: input.applicationDate,
    biocharAppliedTons: kgToTonnes(input.appliedWetMassKg), biocharAppliedDryTons, fieldSizeHa: input.fieldSizeHa,
    fieldIdentifier: optionalText(input.fieldIdentifier), cropType: optionalText(input.cropType), applicationMethodType: input.applicationMethod ?? null,
    evidenceMethod: input.evidenceMethod, gpsLatitude: input.gpsLatitude ?? null, gpsLongitude: input.gpsLongitude ?? null,
    gisBoundary: reparseBoundaryEnvelope(input.gisBoundary), soilTemperatureSource: input.soilTemperatureSource ?? null, soilTemperatureC: input.soilTemperatureC ?? null,
  }).returning();
  await saveShares(ctx, tx, application);
  await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, { applicationIds: [application.id] });
  const allocations = await readApplicationAllocations(ctx, tx, application.id);
  capture?.(application.id, null, { ...application, allocations });
  return getApplicationOperationOutput(ctx, tx, application, remainingBefore);
}
export async function updateApplicationInTransaction(ctx: OrgContext, tx: DbTransaction, input: UpdateApplicationInput, capture?: CaptureActivity) {
  requireOrgScope(ctx);
  const { applicationId, expectedVersion, appliedWetMassKg, applicationMethod, ...fields } = input;
  const scope = await lockApplicationWriteScope(ctx, tx, { applicationId, expectedVersion, deliveryId: fields.deliveryId, mutation: "update" });
  const existing = scope.application!;
  const previousAllocations = await readApplicationAllocations(ctx, tx, existing.id);
  const previousActivityScopes = await resolveWriteActivityScopes(ctx, tx, "application", existing.id);
  if (scope.deliveries.some(row => row.archivedAt) || scope.facilities.some(row => row.archivedAt)) throw applicationNotFound("delivery");
  const patch = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  const merged = { ...existing, ...patch };
  const delivery = writableDelivery(scope, merged.deliveryId, merged.applicationDate, input.applicationDate !== undefined);
  if (merged.evidenceMethod === "visual" && existing.evidenceMethod !== "visual") throw applicationRefusal("validation_failed", "evidenceMethod", "This evidence method is not available yet.");
  validateEvidence(merged, merged.fieldSizeHa, existing.code);
  const massChanged = (input.deliveryId !== undefined && input.deliveryId !== existing.deliveryId) || (input.appliedWetMassKg !== undefined && massGrams(input.appliedWetMassKg) !== massGrams(tonnesToKg(existing.biocharAppliedTons)));
  if (massChanged) assertMutableSlices(scope, "update");
  const remainingBefore = await getApplicationRemainingWetMassKg(ctx, tx, delivery.id);
  const data = { ...fields, updatedAt: new Date(), version: nextVersion(applications.version),
    ...(input.fieldIdentifier !== undefined ? { fieldIdentifier: optionalText(input.fieldIdentifier) } : {}),
    ...(input.cropType !== undefined ? { cropType: optionalText(input.cropType) } : {}),
    ...(applicationMethod !== undefined ? { applicationMethodType: applicationMethod } : {}),
    ...(input.gisBoundary !== undefined ? { gisBoundary: reparseBoundaryEnvelope(input.gisBoundary) } : {}),
    ...(massChanged ? { biocharAppliedTons: appliedWetMassKg === undefined ? existing.biocharAppliedTons : kgToTonnes(appliedWetMassKg), biocharAppliedDryTons: await dryMass(ctx, tx, delivery, appliedWetMassKg ?? tonnesToKg(existing.biocharAppliedTons), existing.id) } : {}),
  };
  const [application] = await withUniqueCodeGuard(ctx, applications, applications.code, `Application code "${input.code}" already exists`, () => tx.update(applications).set(data).where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.id, existing.id))).returning());
  if (massChanged) await saveShares(ctx, tx, application);
  await reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, { applicationIds: [application.id] });
  const output = await getApplicationOperationOutput(ctx, tx, application, remainingBefore);
  // A repoint records under the batches it leaves and the ones it joins.
  const allocations = await readApplicationAllocations(ctx, tx, application.id);
  capture?.(application.id, { ...existing, allocations: previousAllocations }, { ...application, allocations });
  return { output, activityScopes: [...previousActivityScopes, ...await resolveWriteActivityScopes(ctx, tx, "application", application.id)] };
}
/** Returns the activity scopes resolved before the shares are deleted. */
export async function deleteApplicationInTransaction(ctx: OrgContext, tx: DbTransaction, input: DeleteApplicationInput, source: ActivityEventInput["source"]): Promise<ActivityScope[]> {
  requireOrgScope(ctx);
  const scope = await lockApplicationWriteScope(ctx, tx, { ...input, mutation: "delete" });
  assertMutableSlices(scope, "delete");
  const blocking = scope.batches.filter(batch => IMMUTABLE_CREDIT_BATCH_STATUSES.has(batch.status));
  if (blocking.length) throw applicationRefusal("certification_locked", "applicationId", `Cannot delete application linked to verified or issued credit batches: ${blocking.map(batch => batch.code).join(", ")}`);
  const id = input.applicationId;
  const activityScopes = await resolveWriteActivityScopes(ctx, tx, "application", id);
  await tx.delete(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.applicationId, id)));
  await tx.delete(soilTemperatureMeasurements).where(and(eq(soilTemperatureMeasurements.organizationId, ctx.organizationId), eq(soilTemperatureMeasurements.applicationId, id)));
  await tx.delete(applicationOutputAllocations).where(and(eq(applicationOutputAllocations.organizationId, ctx.organizationId), eq(applicationOutputAllocations.applicationId, id)));
  await retireDocumentsForEntities(ctx, tx, [{ entityType: "application", entityId: id, activityScopes }], source);
  await tx.delete(applications).where(and(eq(applications.organizationId, ctx.organizationId), eq(applications.id, id)));
  return activityScopes;
}
