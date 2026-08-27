import { createHash } from "node:crypto";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { SafeError } from "@/lib/errors";
import type { IsometricClient, IsometricEnvironment } from "./client";
export type { IsometricEnvironment } from "./client";
import type { components } from "./generated/certify";

export type IsometricBiocharApplication =
  components["schemas"]["BiocharApplication"];
export type CreateBiocharApplicationRequest =
  components["schemas"]["CreateBiocharApplicationRequest"];

type BiocharApplicationPage =
  components["schemas"]["PaginatedListResource_BiocharApplication_"];

export const BIOCHAR_APPLICATION_RATE_UNIT = "t/ha";
export const BIOCHAR_APPLICATION_TRUCK_MASS_UNIT = "kg";
export const BIOCHAR_APPLICATION_DEPARTURE_MASS_KG = 0;
export const BIOCHAR_APPLICATION_REFERENCE_VERSION = 1;
export const BIOCHAR_APPLICATION_REFERENCE_MAX_LENGTH = 100;

const REFERENCE_HASH_LENGTH = 12;
const MAX_LOOKUP_PAGE_SIZE = 50;
const DEFAULT_LOOKUP_PAGE_SIZE = MAX_LOOKUP_PAGE_SIZE;
const DEFAULT_LOOKUP_MAX_PAGES = 20;
const QUANTITY_COMPARISON_EPSILON = 1e-9;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Verified from a live Certify Biochar Application response on 2026-08-27:
// Isometric canonicalizes the submitted rate and mass units on readback.
const APPLICATION_RATE_UNIT_ALIASES = new Set([
  BIOCHAR_APPLICATION_RATE_UNIT,
  "metric_ton / hectare",
]);
const APPLICATION_MASS_UNIT_ALIASES = new Set([
  BIOCHAR_APPLICATION_TRUCK_MASS_UNIT,
  "kilogram",
]);

export interface BuildBiocharApplicationReferenceArgs {
  applicationId: string;
  creditBatchId: string;
  environment: IsometricEnvironment;
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
  const reference = `nm-${provider}-${environment}-bca-${applicationHash}-${batchHash}-v${BIOCHAR_APPLICATION_REFERENCE_VERSION}`;
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

export async function findBiocharApplicationBySupplierReference(
  client: IsometricClient,
  supplierReferenceId: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<IsometricBiocharApplication | null> {
  const pageSize = options.pageSize ?? DEFAULT_LOOKUP_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_LOOKUP_MAX_PAGES;
  if (
    !Number.isInteger(pageSize) ||
    pageSize <= 0 ||
    pageSize > MAX_LOOKUP_PAGE_SIZE
  ) {
    throw new Error(
      `Biochar Application lookup pageSize must be an integer between 1 and ${MAX_LOOKUP_PAGE_SIZE}`,
    );
  }
  if (!Number.isInteger(maxPages) || maxPages <= 0) {
    throw new Error(
      "Biochar Application lookup maxPages must be a positive integer",
    );
  }

  let after: string | undefined;
  let match: IsometricBiocharApplication | null = null;
  const usedCursors = new Set<string>();
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await client.get<BiocharApplicationPage>(
      "/biochar_applications",
      { query: { first: pageSize, after } },
    );
    for (const application of page.nodes ?? []) {
      if (application.supplier_reference_id !== supplierReferenceId) continue;
      if (match) {
        throw new SafeError(
          "Multiple Isometric Biochar Applications use this stable reference. Resolve the duplicate records before retrying.",
        );
      }
      match = application;
    }
    if (!page.page_info.has_next_page) return match;
    after = page.page_info.end_cursor ?? undefined;
    if (!after) {
      throw new Error(
        "Isometric Biochar Application pagination reported another page without a cursor",
      );
    }
    if (usedCursors.has(after)) {
      throw new Error(
        `Isometric Biochar Application pagination repeated cursor ${after}`,
      );
    }
    usedCursors.add(after);
  }
  throw new SafeError(
    `The Isometric Biochar Application lookup exceeded its safety limit after ${(pageSize * maxPages).toLocaleString("en-US")} records. Contact support before retrying.`,
  );
}

export function biocharApplicationMismatchMessage(
  remote: IsometricBiocharApplication,
  expected: CreateBiocharApplicationRequest,
): string | null {
  const matches =
    remote.supplier_reference_id === expected.supplier_reference_id &&
    remote.production_batch_id === expected.production_batch_id &&
    remote.storage_location_id === expected.storage_site_id &&
    remote.application_date === expected.application_date &&
    quantitiesMatch(
      remote.average_application_rate,
      expected.average_application_rate,
    ) &&
    quantitiesMatch(
      remote.truck_mass_on_arrival,
      expected.truck_mass_on_arrival,
    ) &&
    quantitiesMatch(
      remote.truck_mass_on_departure,
      expected.truck_mass_on_departure,
    );
  return matches
    ? null
    : `Isometric Biochar Application ${remote.id} does not match this application's Production Batch, Storage Location, date, rate, or application mass. Resolve the registry drift before retrying.`;
}

function quantitiesMatch(
  actual: { magnitude: number; unit: string },
  expected: { magnitude: number; unit: string },
): boolean {
  return (
    quantityUnitsMatch(actual.unit, expected.unit) &&
    Number.isFinite(actual.magnitude) &&
    Math.abs(actual.magnitude - expected.magnitude) <=
      QUANTITY_COMPARISON_EPSILON *
        Math.max(1, Math.abs(actual.magnitude), Math.abs(expected.magnitude))
  );
}

function quantityUnitsMatch(actual: string, expected: string): boolean {
  return (
    actual === expected ||
    (APPLICATION_RATE_UNIT_ALIASES.has(actual) &&
      APPLICATION_RATE_UNIT_ALIASES.has(expected)) ||
    (APPLICATION_MASS_UNIT_ALIASES.has(actual) &&
      APPLICATION_MASS_UNIT_ALIASES.has(expected))
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
