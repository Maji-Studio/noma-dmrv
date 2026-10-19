import { getApplicationSiteDefaults, resolveSiteSoilTemperatureDefault } from "@/data-access/application-site-defaults";
import type { ApplicationOperationOutput } from "@/data-access/application-operation-output";
import { SOIL_TEMPERATURE_SOURCE_GLOBAL } from "@/lib/application-guidance";
import { CODE_CONFLICT_MESSAGES, withAutoCodes } from "@/data-access/code-generator";
import { createApplicationInTransaction, updateApplicationInTransaction, deleteApplicationInTransaction } from "@/data-access/application-writes";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { resolveWriteActivityScopes } from "@/data-access/write-activity";
import { applications, type Application } from "@/db/schema";
import { recordApplicationInput, updateApplicationInput, deleteApplicationInput } from "@/schemas/application-input";
import type { OperationDescription } from "@/lib/operation-effect";
import type { Operation } from "./runner";

const AUTO_CODE_COUNT = 1;

export const describeRecordedApplication = (input: object, output: Pick<Application, "id" | "version">): OperationDescription => ({ outcome: "created", entityType: "application", entityIds: [output.id],
    versionBefore: null, versionAfter: output.version });
export const describeUpdatedApplication = (input: { expectedVersion: number }, output: Pick<Application, "id" | "version">): OperationDescription => ({ outcome: "updated", entityType: "application", entityIds: [output.id],
    versionBefore: input.expectedVersion, versionAfter: output.version });

export const recordApplication: Operation<typeof recordApplicationInput, ApplicationOperationOutput> = {
  id: "record_application", input: recordApplicationInput, supportsDryRun: true,
  describe: (input, output) => describeRecordedApplication(input, output.application),
  execute: async ({ ctx, tx, activity }, input) => {
    const site = await getApplicationSiteDefaults(ctx, tx, input.deliveryId);
    const resolved = { ...input };
    const warnings: string[] = [];
    if (input.evidenceMethod === "location" && input.gpsLatitude === undefined && input.gpsLongitude === undefined && site?.gpsLatitude != null && site.gpsLongitude != null) {
      resolved.gpsLatitude = site.gpsLatitude;
      resolved.gpsLongitude = site.gpsLongitude;
      warnings.push(`GPS copied from customer location ${site.customerLocationName}.`);
    }
    const temperature = resolveSiteSoilTemperatureDefault(site);
    if (input.soilTemperatureC === undefined && input.soilTemperatureSource === undefined && temperature != null) {
      resolved.soilTemperatureC = temperature.temperatureC;
      resolved.soilTemperatureSource = SOIL_TEMPERATURE_SOURCE_GLOBAL;
      warnings.push(temperature.origin === "customer_location"
        ? `Soil temperature copied from customer location ${site?.customerLocationName}.`
        : "Soil temperature copied from the facility default.");
    }
    const saved = await withAutoCodes(ctx, tx, "AP", applications, applications.code, AUTO_CODE_COUNT,
      ([code], savepoint) => createApplicationInTransaction(ctx, savepoint, { ...resolved, code }, activity.capture), CODE_CONFLICT_MESSAGES.application);
    activity.scope(saved.application.id, await resolveWriteActivityScopes(ctx, tx, "application", saved.application.id));
    return { ...saved, warnings: [...warnings, ...saved.warnings] };
  },
};

export const updateApplication: Operation<typeof updateApplicationInput, ApplicationOperationOutput> = {
  id: "update_application", input: updateApplicationInput, supportsDryRun: true,
  describe: (input, output) => describeUpdatedApplication(input, output.application),
  execute: async ({ ctx, tx, activity }, input) => {
    const { output, activityScopes } = await updateApplicationInTransaction(ctx, tx, input, activity.capture);
    activity.scope(output.application.id, activityScopes);
    return output;
  },
};

export const deleteApplication: Operation<typeof deleteApplicationInput, void> = {
  id: "delete_application", input: deleteApplicationInput, supportsDryRun: true,
  describe: (input) => ({ outcome: "deleted", entityType: "application", entityIds: [input.applicationId],
    versionBefore: input.expectedVersion, versionAfter: null }),
  execute: async ({ ctx, tx, source, activity, afterCommit }, input) => {
    activity.scope(input.applicationId, await deleteApplicationInTransaction(ctx, tx, input, source));
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx); });
  },
};
