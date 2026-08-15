import { getBiocharApplicationRegistryInputs } from "@/data-access/certifier-biochar-applications";
import type { OrgContext } from "@/lib/auth/server";
import { formatUtcDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
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

export interface BiocharApplicationIntent {
  applicationId: string;
  applicationCode: string;
  creditBatchId: string;
  deliveryId: string;
  customerLocationId: string;
  certifierProjectId: string;
  externalProjectId: string;
  applicationDate: string;
  appliedTonnes: number;
  fieldSizeHa: number;
  truckMassOnArrivalKg: number;
  truckMassOnDepartureKg: number;
  supplierReference: string;
  storageLocationSupplierReference: string;
  storageLocationPayload: CreateStorageLocationRequest;
  sourceIds: string[];
}

export async function compileBiocharApplicationIntents(args: {
  orgCtx: OrgContext;
  memberBatches: Array<{
    creditBatchId: string;
    applicationIds: string[];
  }>;
  environment: "sandbox" | "production";
}): Promise<BiocharApplicationIntent[]> {
  if (args.environment === "production") return [];
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
  const applicationsByDeliveryId = new Map<
    string,
    { deliveryCode: string; applicationCodes: string[] }
  >();
  for (const input of inputs) {
    const entry = applicationsByDeliveryId.get(input.deliveryId) ?? {
      deliveryCode: input.deliveryCode,
      applicationCodes: [],
    };
    entry.applicationCodes.push(input.applicationCode);
    applicationsByDeliveryId.set(input.deliveryId, entry);
  }
  const splitDelivery = [...applicationsByDeliveryId.values()].find(
    ({ applicationCodes }) => applicationCodes.length > 1,
  );
  if (splitDelivery) {
    throw new SafeError(
      `Delivery ${splitDelivery.deliveryCode} is split across Applications ${splitDelivery.applicationCodes.sort().join(", ")}. Submit one Application per delivery until truck-mass allocation is defined.`,
    );
  }

  return applicationIds.map((applicationId) => {
    const input = inputByApplicationId.get(applicationId)!;
    const creditBatchIds = [...(batchIdsByApplicationId.get(applicationId) ?? [])].sort();
    if (creditBatchIds.length !== 1) {
      throw new SafeError(
        `Application ${input.applicationCode} spans ${creditBatchIds.length} credit batches. Assign it to exactly one credit batch before submitting. Truck measurements cannot be allocated across Production Batches.`,
      );
    }
    if (input.fieldSizeHa == null) {
      throw new SafeError(
        `Application ${input.applicationCode} needs a field size greater than 0 ha before submitting.`,
      );
    }
    const truckMassOnArrivalKg = input.truckMassOnArrivalKg;
    const truckMassOnDepartureKg = input.truckMassOnDepartureKg;
    if (truckMassOnArrivalKg == null || truckMassOnDepartureKg == null) {
      throw new SafeError(
        `Application ${input.applicationCode} needs observed truck masses before and after unloading on delivery ${input.deliveryCode} before submitting.`,
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
    const creditBatchId = creditBatchIds[0];
    const supplierReference = buildBiocharApplicationReference({
      applicationId,
      creditBatchId,
      environment: args.environment,
    });
    const applicationDate = formatUtcDate(input.applicationDate);

    // Run the complete request validator with stable placeholders. This proves
    // every operator-owned magnitude and identity is ready before any registry
    // mutation; real dependency IDs replace the placeholders after ensure.
    buildCreateBiocharApplicationRequest({
      applicationCode: input.applicationCode,
      applicationDate,
      appliedTonnes: input.appliedTonnes,
      fieldSizeHa,
      truckMassOnArrivalKg,
      truckMassOnDepartureKg,
      externalProjectId,
      externalProductionBatchId: "preflight-production-batch",
      externalStorageLocationId: "preflight-storage-location",
      supplierReferenceId: supplierReference,
      sourceIds: [],
    });

    return {
      applicationId,
      applicationCode: input.applicationCode,
      creditBatchId,
      deliveryId: input.deliveryId,
      customerLocationId,
      certifierProjectId,
      externalProjectId,
      applicationDate,
      appliedTonnes: input.appliedTonnes,
      fieldSizeHa,
      truckMassOnArrivalKg,
      truckMassOnDepartureKg,
      supplierReference,
      storageLocationSupplierReference,
      storageLocationPayload,
      sourceIds: [],
    } satisfies BiocharApplicationIntent;
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
    appliedTonnes: args.intent.appliedTonnes,
    fieldSizeHa: args.intent.fieldSizeHa,
    truckMassOnArrivalKg: args.intent.truckMassOnArrivalKg,
    truckMassOnDepartureKg: args.intent.truckMassOnDepartureKg,
    externalProjectId: args.intent.externalProjectId,
    externalProductionBatchId: args.externalProductionBatchId,
    externalStorageLocationId: args.externalStorageLocationId,
    supplierReferenceId: args.intent.supplierReference,
    sourceIds: args.intent.sourceIds,
  });
}
