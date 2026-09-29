import { createHash } from "node:crypto";
import { SafeError } from "@/lib/errors";
import type { IsometricClient, PaginateOptions } from "./client";
import { findRegistryRecord } from "./find-record";
import type { components } from "./generated/certify";

export type IsometricStorageLocation = components["schemas"]["StorageLocation"];
export type CreateStorageLocationRequest =
  components["schemas"]["CreateStorageLocationRequest"];

const REFERENCE_HASH_LENGTH = 16;
// Reconciliation reads at most 1,000 records before refusing.
const DEFAULT_LOOKUP_MAX_PAGES = 20;
const UNDEFINED = { __typename: "Undefined" } as const;

export const BIOCHAR_FIELD_STORAGE_METHOD = "biochar_field" as const;

export interface BuildStorageLocationRequestArgs {
  externalProjectId: string;
  name: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  supplierReferenceId: string;
  description?: string | null;
}

/** Stable across every mutable customer-location field. */
export function buildStorageLocationReference(args: {
  customerLocationId: string;
  externalProjectId: string;
}): string {
  const customerLocationId = args.customerLocationId.trim();
  const externalProjectId = args.externalProjectId.trim();
  if (!customerLocationId) {
    throw new SafeError("The application site has no stable customer-location ID.");
  }
  if (!externalProjectId) {
    throw new SafeError("The application site has no stable Isometric project ID.");
  }
  const digest = createHash("sha256")
    .update(`${externalProjectId}:${customerLocationId}`)
    .digest("hex")
    .slice(0, REFERENCE_HASH_LENGTH);
  return `nm-slc-${digest}`;
}

/** Pure builder and fail-closed validator for POST /storage_locations. */
export function buildCreateStorageLocationRequest(
  args: BuildStorageLocationRequestArgs,
): CreateStorageLocationRequest {
  const externalProjectId = args.externalProjectId.trim();
  const name = args.name.trim();
  const supplierReferenceId = args.supplierReferenceId.trim();
  if (!externalProjectId) {
    throw new SafeError(
      "The application site's facility is not linked to an Isometric project.",
    );
  }
  if (!name) {
    throw new SafeError("The customer location needs a name before it can be registered.");
  }
  if (!supplierReferenceId) {
    throw new SafeError("The application site has no stable registry reference.");
  }
  assertCoordinate("latitude", args.latitude, -90, 90);
  assertCoordinate("longitude", args.longitude, -180, 180);

  const description = args.description?.trim();
  return {
    description: description || UNDEFINED,
    latitude: args.latitude,
    longitude: args.longitude,
    name,
    project_id: externalProjectId,
    storage_method: BIOCHAR_FIELD_STORAGE_METHOD,
    supplier_reference_id: supplierReferenceId,
  };
}

function assertCoordinate(
  label: "latitude" | "longitude",
  value: number | null | undefined,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (value === null || value === undefined) {
    throw new SafeError(
      `The customer location needs a ${label} before it can be registered.`,
    );
  }
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new SafeError(
      `The customer location ${label} must be between ${minimum} and ${maximum}.`,
    );
  }
}

function storageLocationsPath(externalProjectId: string): string {
  return `/projects/${encodeURIComponent(externalProjectId)}/storage_locations`;
}

export function createStorageLocation(
  client: IsometricClient,
  externalProjectId: string,
  body: CreateStorageLocationRequest,
): Promise<IsometricStorageLocation> {
  return client.post<IsometricStorageLocation>(
    storageLocationsPath(externalProjectId),
    body,
  );
}

export function getStorageLocation(
  client: IsometricClient,
  externalProjectId: string,
  storageLocationId: string,
): Promise<IsometricStorageLocation> {
  return client.get<IsometricStorageLocation>(
    `${storageLocationsPath(externalProjectId)}/${encodeURIComponent(storageLocationId)}`,
  );
}

/**
 * Bounded full-list reconciliation because the endpoint exposes no supplier
 * reference filter. Duplicate matches and an exhausted bound both fail loudly.
 */
export function findStorageLocationBySupplierReference(
  client: IsometricClient,
  externalProjectId: string,
  supplierReferenceId: string,
  options: Pick<PaginateOptions, "pageSize" | "maxPages"> = {},
): Promise<IsometricStorageLocation | null> {
  return findRegistryRecord<IsometricStorageLocation>(
    client,
    storageLocationsPath(externalProjectId),
    {
      match: "unique",
      duplicateMessage:
        "Multiple Isometric Storage Locations use this application site's stable reference. Resolve the duplicate records before retrying.",
      where: (location) => location.supplier_reference_id === supplierReferenceId,
      paginate: { maxPages: DEFAULT_LOOKUP_MAX_PAGES, ...options },
    },
  );
}
