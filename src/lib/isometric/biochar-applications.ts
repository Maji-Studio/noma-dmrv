import { createHash } from "node:crypto";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { SafeError } from "@/lib/errors";
import type {
  IsometricClient,
  IsometricEnvironment,
  PaginateOptions,
} from "./client";
export type { IsometricEnvironment } from "./client";
import { findRegistryRecord } from "./find-record";
import type { components } from "./generated/certify";
import {
  ISOMETRIC_KILOGRAM_UNIT,
  kilogramUnitsMatch,
} from "./quantity-units";

export type IsometricBiocharApplication =
  components["schemas"]["BiocharApplication"] & {
    // Certify accepts `source_ids` on create but its documented response and
    // GET readback omit them (verified against the public OpenAPI on
    // 2026-09-08). When a response does carry them, the reviewed set is
    // compared exactly; when it omits them, the accepted create request is
    // the attachment contract. See issue #737 for an authoritative readback.
    // Typed as the untrusted wire value: `sourceSetMismatchMessage` narrows.
    source_ids?: unknown;
  };
export type CreateBiocharApplicationRequest =
  components["schemas"]["CreateBiocharApplicationRequest"];

export const BIOCHAR_APPLICATION_RATE_UNIT = "t/ha";
export const BIOCHAR_APPLICATION_TRUCK_MASS_UNIT = ISOMETRIC_KILOGRAM_UNIT;
export const BIOCHAR_APPLICATION_DEPARTURE_MASS_KG = 0;
export const BIOCHAR_APPLICATION_REFERENCE_VERSION = 1;
export const BIOCHAR_APPLICATION_REFERENCE_MAX_LENGTH = 100;
export const FIRST_REMOVAL_SUBMISSION_VERSION = 1;

const REFERENCE_HASH_LENGTH = 12;
// Reconciliation reads at most 1,000 records before refusing.
const DEFAULT_LOOKUP_MAX_PAGES = 20;
const QUANTITY_COMPARISON_EPSILON = 1e-9;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Verified from a live Certify Biochar Application response on 2026-08-27:
// Isometric canonicalizes the submitted rate and mass units on readback.
const APPLICATION_RATE_UNIT_ALIASES = new Set([
  BIOCHAR_APPLICATION_RATE_UNIT,
  "metric_ton / hectare",
]);

export interface BuildBiocharApplicationReferenceArgs {
  applicationId: string;
  creditBatchId: string;
  environment: IsometricEnvironment;
  removalSubmissionVersion?: number;
  provider?: "isometric";
}

export function buildBiocharApplicationReference(
  args: BuildBiocharApplicationReferenceArgs,
): string {
  const provider = args.provider ?? "isometric";
  const environment = args.environment;
  const applicationId = args.applicationId.trim();
  const creditBatchId = args.creditBatchId.trim();
  if (!applicationId || !creditBatchId) {
    throw new SafeError(
      "The Biochar Application has no stable local application or credit-batch identity.",
    );
  }
  const applicationHash = shortHash(applicationId);
  const batchHash = shortHash(creditBatchId);
  const removalSubmissionVersion =
    args.removalSubmissionVersion ?? FIRST_REMOVAL_SUBMISSION_VERSION;
  if (
    !Number.isInteger(removalSubmissionVersion) ||
    removalSubmissionVersion < 1
  ) {
    throw new Error(
      "Biochar Application Removal submission version must be positive",
    );
  }
  // Preserve the already-deployed v1 reference so an interrupted first
  // submission can still reconcile its remote artifact. Superseding Removal
  // submissions receive a distinct reference and therefore a distinct remote
  // Biochar Application for that Removal submission version.
  const submissionVersionSuffix =
    removalSubmissionVersion === FIRST_REMOVAL_SUBMISSION_VERSION
      ? ""
      : `-s${removalSubmissionVersion}`;
  const reference = `nm-${provider}-${environment}-bca-${applicationHash}-${batchHash}${submissionVersionSuffix}-v${BIOCHAR_APPLICATION_REFERENCE_VERSION}`;
  if (reference.length > BIOCHAR_APPLICATION_REFERENCE_MAX_LENGTH) {
    throw new Error(
      `Biochar Application supplier reference exceeds ${BIOCHAR_APPLICATION_REFERENCE_MAX_LENGTH} characters`,
    );
  }
  return reference;
}

export interface BuildCreateBiocharApplicationRequestArgs {
  applicationCode: string;
  applicationDate: string;
  applicationWetMassKg: number;
  fieldSizeHa: number;
  externalProjectId: string;
  externalProductionBatchId: string;
  externalStorageLocationId: string;
  supplierReferenceId: string;
  sourceIds?: readonly string[];
}

export function buildCreateBiocharApplicationRequest(
  args: BuildCreateBiocharApplicationRequestArgs,
): CreateBiocharApplicationRequest {
  const code = args.applicationCode.trim() || "Application";
  assertPositiveFinite(
    args.applicationWetMassKg,
    `Application ${code} needs a positive applied biochar mass before submitting.`,
  );
  assertPositiveFinite(
    args.fieldSizeHa,
    `Application ${code} needs a field size greater than 0 ha before submitting.`,
  );
  if (!ISO_DATE_PATTERN.test(args.applicationDate)) {
    throw new SafeError(
      `Application ${code} needs a valid application date before submitting.`,
    );
  }
  const externalProjectId = requiredIdentity(
    args.externalProjectId,
    `Application ${code} has no Isometric project ID. Add the facility mapping under Certification settings.`,
  );
  const externalProductionBatchId = requiredIdentity(
    args.externalProductionBatchId,
    `Application ${code} has no registered Isometric Production Batch.`,
  );
  const externalStorageLocationId = requiredIdentity(
    args.externalStorageLocationId,
    `Application ${code} has no registered Isometric Storage Location.`,
  );
  const supplierReferenceId = requiredIdentity(
    args.supplierReferenceId,
    `Application ${code} has no stable registry reference.`,
  );
  if (supplierReferenceId.length > BIOCHAR_APPLICATION_REFERENCE_MAX_LENGTH) {
    throw new SafeError(
      `Application ${code} has a registry reference longer than ${BIOCHAR_APPLICATION_REFERENCE_MAX_LENGTH} characters.`,
    );
  }

  const averageApplicationRate =
    kgToTonnes(args.applicationWetMassKg) / args.fieldSizeHa;
  assertPositiveFinite(
    averageApplicationRate,
    `Application ${code} has an invalid average application rate. Correct its applied mass and field size.`,
  );

  return {
    application_date: args.applicationDate,
    average_application_rate: {
      magnitude: averageApplicationRate,
      unit: BIOCHAR_APPLICATION_RATE_UNIT,
    },
    production_batch_id: externalProductionBatchId,
    project_id: externalProjectId,
    source_ids: [...new Set(args.sourceIds ?? [])].sort(),
    storage_site_id: externalStorageLocationId,
    supplier_reference_id: supplierReferenceId,
    truck_mass_on_arrival: {
      // Isometric support confirmed the mass/zero convention for individually
      // logged applications when site scales are unavailable. This is the
      // immutable application-slice wet mass, not a local truck observation.
      magnitude: args.applicationWetMassKg,
      unit: BIOCHAR_APPLICATION_TRUCK_MASS_UNIT,
    },
    truck_mass_on_departure: {
      magnitude: BIOCHAR_APPLICATION_DEPARTURE_MASS_KG,
      unit: BIOCHAR_APPLICATION_TRUCK_MASS_UNIT,
    },
  };
}

export function createBiocharApplication(
  client: IsometricClient,
  body: CreateBiocharApplicationRequest,
): Promise<IsometricBiocharApplication> {
  return client.post<IsometricBiocharApplication>(
    "/biochar_applications",
    body,
  );
}

export function getBiocharApplication(
  client: IsometricClient,
  biocharApplicationId: string,
): Promise<IsometricBiocharApplication> {
  return client.get<IsometricBiocharApplication>(
    `/biochar_applications/${encodeURIComponent(biocharApplicationId)}`,
  );
}

// DELETE /biochar_applications/{id}: irreversible. Callers must tolerate a
// 404 on retry because a prior attempt may have already removed the record.
export function deleteBiocharApplication(
  client: IsometricClient,
  biocharApplicationId: string,
): Promise<void> {
  return client.delete<void>(
    `/biochar_applications/${encodeURIComponent(biocharApplicationId)}`,
  );
}

export function findBiocharApplicationBySupplierReference(
  client: IsometricClient,
  supplierReferenceId: string,
  options: Pick<PaginateOptions, "pageSize" | "maxPages"> = {},
): Promise<IsometricBiocharApplication | null> {
  return findRegistryRecord<IsometricBiocharApplication>(
    client,
    "/biochar_applications",
    {
      match: "unique",
      duplicateMessage:
        "Multiple Isometric Biochar Applications use this stable reference. Resolve the duplicate records before retrying.",
      where: (application) =>
        application.supplier_reference_id === supplierReferenceId,
      paginate: { maxPages: DEFAULT_LOOKUP_MAX_PAGES, ...options },
    },
  );
}

export function biocharApplicationMismatchMessage(
  remote: IsometricBiocharApplication,
  expected: CreateBiocharApplicationRequest,
): string | null {
  const sourceMismatch = sourceSetMismatchMessage(remote, expected);
  if (sourceMismatch) return sourceMismatch;
  const matches =
    remote.supplier_reference_id === expected.supplier_reference_id &&
    remote.production_batch_id === expected.production_batch_id &&
    remote.storage_location_id === expected.storage_site_id &&
    remote.application_date === expected.application_date &&
    quantitiesMatch(
      remote.average_application_rate,
      expected.average_application_rate,
      applicationRateUnitsMatch,
    ) &&
    quantitiesMatch(
      remote.truck_mass_on_arrival,
      expected.truck_mass_on_arrival,
      kilogramUnitsMatch,
    ) &&
    quantitiesMatch(
      remote.truck_mass_on_departure,
      expected.truck_mass_on_departure,
      kilogramUnitsMatch,
    );
  return matches
    ? null
    : `Isometric Biochar Application ${remote.id} does not match this application's Production Batch, Storage Location, date, rate, or application mass. Resolve the registry drift before retrying.`;
}

/**
 * Compares the reviewed Source set against the registry readback when the
 * readback exposes one. Certify's documented Biochar Application response
 * omits `source_ids`, so an omitted or null field is not drift: the accepted
 * create request already carried the reviewed set. Any other non-array value
 * is an unexpected response shape and is reported as drift, never trusted.
 */
function sourceSetMismatchMessage(
  remote: IsometricBiocharApplication,
  expected: CreateBiocharApplicationRequest,
): string | null {
  if (remote.source_ids == null) return null;
  if (!Array.isArray(remote.source_ids)) {
    return `Isometric Biochar Application ${remote.id} returned an unreadable Source set. Refresh and reconcile its supporting evidence before retrying.`;
  }
  const expectedSources = expected.source_ids ?? [];
  const remoteSources = new Set<unknown>(remote.source_ids);
  const expectedSourceSet = new Set(expectedSources);
  if (
    remoteSources.size !== expectedSourceSet.size ||
    expectedSources.some((id) => !remoteSources.has(id))
  ) {
    return `Isometric Biochar Application ${remote.id} does not match the reviewed Source set. Refresh and reconcile its supporting evidence before retrying.`;
  }
  return null;
}

function quantitiesMatch(
  actual: { magnitude: number; unit: string },
  expected: { magnitude: number; unit: string },
  unitsMatch: (actual: string, expected: string) => boolean,
): boolean {
  return (
    unitsMatch(actual.unit, expected.unit) &&
    Number.isFinite(actual.magnitude) &&
    Math.abs(actual.magnitude - expected.magnitude) <=
      QUANTITY_COMPARISON_EPSILON *
        Math.max(1, Math.abs(actual.magnitude), Math.abs(expected.magnitude))
  );
}

function applicationRateUnitsMatch(actual: string, expected: string): boolean {
  return (
    actual === expected ||
    (APPLICATION_RATE_UNIT_ALIASES.has(actual) &&
      APPLICATION_RATE_UNIT_ALIASES.has(expected))
  );
}

function shortHash(value: string): string {
  return createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, REFERENCE_HASH_LENGTH);
}

function assertPositiveFinite(value: number, message: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new SafeError(message);
}

function requiredIdentity(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new SafeError(message);
  return trimmed;
}
