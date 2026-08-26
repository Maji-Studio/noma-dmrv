import { getBiocharApplicationRegistryInputs } from "@/data-access/certifier-biochar-applications";
import type { OrgContext } from "@/lib/auth/server";
import { formatUtcDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import {
  buildBiocharApplicationReference,
  buildCreateBiocharApplicationRequest,
  type CreateBiocharApplicationRequest,
} from "@/lib/isometric/biochar-applications";
import {
  buildCreateStorageLocationRequest,
  buildStorageLocationReference,
  type CreateStorageLocationRequest,
} from "@/lib/isometric/storage-locations";

const PREFLIGHT_EXTERNAL_PRODUCTION_BATCH_ID = "preflight-production-batch";
const PREFLIGHT_EXTERNAL_STORAGE_LOCATION_ID = "preflight-storage-location";
const SLICE_WET_MASS_TOLERANCE_KG = 0.01;

interface BiocharApplicationIntentBase {
  applicationId: string;
  applicationCode: string;
  creditBatchId: string;
  deliveryId: string;
  customerLocationId: string;
  certifierProjectId: string;
  externalProjectId: string;
  applicationDate: string;
  allocatedWetMassKg: number;
  fieldSizeHa: number;
  supplierReference: string;
  storageLocationSupplierReference: string;
  storageLocationPayload: CreateStorageLocationRequest;
  sourceIds: string[];
}

export type BiocharApplicationIntent = BiocharApplicationIntentBase;

export async function compileBiocharApplicationIntents(args: {
  orgCtx: OrgContext;
  memberBatches: Array<{
    creditBatchId: string;
    durabilityOption?: "200_year" | "1000_year";
    applicationIds: string[];
    applicationSlices?: Array<{
      applicationId: string;
      allocatedWetMassKg: number;
      allocatedDryMassKg: number;
    }>;
  }>;
  environment: "sandbox" | "production";
}): Promise<BiocharApplicationIntent[]> {
  const batchIdsByApplicationId = new Map<string, Set<string>>();
  for (const batch of args.memberBatches) {
    for (const applicationId of new Set(batch.applicationIds)) {
      const batchIds = batchIdsByApplicationId.get(applicationId) ?? new Set();
      batchIds.add(batch.creditBatchId);
      batchIdsByApplicationId.set(applicationId, batchIds);
    }
  }
  const applicationIds = [...batchIdsByApplicationId.keys()].sort();
  const inputs = await getBiocharApplicationRegistryInputs(
    args.orgCtx,
    applicationIds,
  );
  const inputByApplicationId = new Map(
    inputs.map((input) => [input.applicationId, input]),
  );
  const missing = applicationIds.filter(
    (applicationId) => !inputByApplicationId.has(applicationId),
  );
  if (missing.length > 0) {
    throw new SafeError(
      "An Application in this Removal could not be loaded. Reload the Removal and submit again.",
    );
  }
  return applicationIds.flatMap((applicationId) => {
    const input = inputByApplicationId.get(applicationId)!;
    const creditBatchIds = [...(batchIdsByApplicationId.get(applicationId) ?? [])].sort();
    const slices = args.memberBatches
      .flatMap((batch) =>
        (batch.applicationSlices ?? [])
          .filter((slice) => slice.applicationId === applicationId)
          .map((slice) => ({ ...slice, creditBatchId: batch.creditBatchId })),
      )
      .sort((a, b) => a.creditBatchId.localeCompare(b.creditBatchId));
    const sliceBatchIds = new Set(slices.map((slice) => slice.creditBatchId));
    const hasCompleteSlices =
      slices.length === creditBatchIds.length &&
      sliceBatchIds.size === creditBatchIds.length &&
      creditBatchIds.every((creditBatchId) => sliceBatchIds.has(creditBatchId));
    if (!hasCompleteSlices) {
      throw new SafeError(
        `Application ${input.applicationCode} does not have one immutable allocation for every member credit batch. Reload the Removal and submit again.`,
      );
    }
    const allocatedWetMassKg = slices.reduce(
      (total, slice) => total + slice.allocatedWetMassKg,
      0,
    );
    const appliedWetMassKg = tonnesToKg(input.appliedTonnes);
    // A 1000-year Removal contains one Production Batch, so a commingled
    // physical Application is intentionally represented by only that batch's
    // immutable slice. The 200-year flow still requires the Removal to own the
    // Application's complete mass across all member batches.
    const allowsBatchSliceSubmission =
      creditBatchIds.length === 1 &&
      args.memberBatches
        .filter((batch) => creditBatchIds.includes(batch.creditBatchId))
        .every((batch) => batch.durabilityOption === "1000_year");
    const allocationMismatch = allowsBatchSliceSubmission
      ? allocatedWetMassKg - appliedWetMassKg > SLICE_WET_MASS_TOLERANCE_KG
      : Math.abs(allocatedWetMassKg - appliedWetMassKg) >
        SLICE_WET_MASS_TOLERANCE_KG;
    if (allocationMismatch) {
      throw new SafeError(
        `Application ${input.applicationCode}'s immutable allocations total ${allocatedWetMassKg} kg, but its persisted applied mass is ${appliedWetMassKg} kg. Reconcile the Removal and submit again.`,
      );
    }
    if (
      input.fieldSizeHa == null ||
      !Number.isFinite(input.fieldSizeHa) ||
      input.fieldSizeHa <= 0
    ) {
      throw new SafeError(
        `Application ${input.applicationCode} needs a field size greater than 0 ha before submitting.`,
      );
    }
    if (!input.customerLocationId) {
      throw new SafeError(
        `Application ${input.applicationCode} has no customer location. Select a delivery destination before submitting.`,
      );
    }
    if (!input.certifierProjectId || !input.externalProjectId) {
      throw new SafeError(
        `Application ${input.applicationCode} is not linked to an Isometric project. Add the facility mapping under Certification settings before submitting.`,
      );
    }

    const fieldSizeHa = input.fieldSizeHa;
    const customerLocationId = input.customerLocationId;
    const certifierProjectId = input.certifierProjectId;
    const externalProjectId = input.externalProjectId;
    if (
      fieldSizeHa == null ||
      !customerLocationId ||
      !certifierProjectId ||
      !externalProjectId
    ) {
      throw new Error("Biochar Application preflight narrowing failed");
    }

    const storageLocationSupplierReference = buildStorageLocationReference({
      customerLocationId,
      externalProjectId,
    });
    const storageLocationPayload = buildCreateStorageLocationRequest({
      externalProjectId,
      name: input.customerLocationName ?? "",
      latitude: input.latitude,
      longitude: input.longitude,
      supplierReferenceId: storageLocationSupplierReference,
    });
    const applicationDate = formatUtcDate(input.applicationDate);
    return slices.map((slice) => {
      const supplierReference = buildBiocharApplicationReference({
        applicationId,
        creditBatchId: slice.creditBatchId,
        environment: args.environment,
      });
      const base = {
        applicationId,
        applicationCode: input.applicationCode,
        creditBatchId: slice.creditBatchId,
        deliveryId: input.deliveryId,
        customerLocationId,
        certifierProjectId,
        externalProjectId,
        applicationDate,
        allocatedWetMassKg: slice.allocatedWetMassKg,
        fieldSizeHa,
        supplierReference,
        storageLocationSupplierReference,
        storageLocationPayload,
        sourceIds: [],
      };

      // Validate slice facts against the provider contract during preflight.
      // Submission resolves the real dependency IDs, so placeholders satisfy
      // required identity here and the built request is intentionally discarded.
      buildCreateBiocharApplicationRequest({
        applicationCode: input.applicationCode,
        applicationDate,
        applicationWetMassKg: slice.allocatedWetMassKg,
        fieldSizeHa,
        externalProjectId,
        externalProductionBatchId: PREFLIGHT_EXTERNAL_PRODUCTION_BATCH_ID,
        externalStorageLocationId: PREFLIGHT_EXTERNAL_STORAGE_LOCATION_ID,
        supplierReferenceId: supplierReference,
        sourceIds: [],
      });

      return base satisfies BiocharApplicationIntent;
    });
  });
}

export function buildBiocharApplicationRequestFromIntent(args: {
  intent: BiocharApplicationIntent;
  externalProductionBatchId: string;
  externalStorageLocationId: string;
}): CreateBiocharApplicationRequest {
  return buildCreateBiocharApplicationRequest({
    applicationCode: args.intent.applicationCode,
    applicationDate: args.intent.applicationDate,
    applicationWetMassKg: args.intent.allocatedWetMassKg,
    fieldSizeHa: args.intent.fieldSizeHa,
    externalProjectId: args.intent.externalProjectId,
    externalProductionBatchId: args.externalProductionBatchId,
    externalStorageLocationId: args.externalStorageLocationId,
    supplierReferenceId: args.intent.supplierReference,
    sourceIds: args.intent.sourceIds,
  });
}
