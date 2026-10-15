import { db } from "@/db";
import { createApplicationInTransaction, updateApplicationInTransaction, deleteApplicationInTransaction } from "@/data-access/application-writes";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordApplicationInput, UpdateApplicationInput } from "@/schemas/application-input";

/** Existing writer fixtures provide GPS explicitly unless testing an absent pair. */
export function createTestApplication(ctx: OrgContext, input: Omit<RecordApplicationInput, "evidenceMethod"> & { code: string; evidenceMethod?: RecordApplicationInput["evidenceMethod"] }) {
  return db.transaction(tx => createApplicationInTransaction(ctx, tx, { gpsLatitude: 0, gpsLongitude: 0, ...input, evidenceMethod: input.evidenceMethod ?? "location" }));
}
export function updateTestApplication(ctx: OrgContext, applicationId: string, input: Omit<UpdateApplicationInput, "applicationId">) {
  return db.transaction(tx => updateApplicationInTransaction(ctx, tx, { ...input, applicationId }));
}
export function deleteTestApplication(ctx: OrgContext, applicationId: string, expectedVersion: number) {
  return db.transaction(tx => deleteApplicationInTransaction(ctx, tx, { applicationId, expectedVersion }));
}
