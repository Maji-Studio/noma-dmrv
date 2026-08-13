import { createHash } from "node:crypto";
import { SafeError } from "@/lib/errors";
import type { IsometricClient } from "./client";
import type { components } from "./generated/certify";

export type IsometricStorageLocation = components["schemas"]["StorageLocation"];
export type CreateStorageLocationRequest =
  components["schemas"]["CreateStorageLocationRequest"];
export type PatchStorageLocationRequest =
  components["schemas"]["PatchStorageLocationRequest"];

type StorageLocationPage =
  components["schemas"]["PaginatedListResource_StorageLocation_"];

const REFERENCE_HASH_LENGTH = 16;
const MAX_LOOKUP_PAGE_SIZE = 50;
const DEFAULT_LOOKUP_PAGE_SIZE = MAX_LOOKUP_PAGE_SIZE;
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

/** Explicit wrapper only; the ensure path never invokes PATCH automatically. */
export function patchStorageLocation(
  client: IsometricClient,
  externalProjectId: string,
  storageLocationId: string,
  body: PatchStorageLocationRequest,
): Promise<IsometricStorageLocation> {
  return client.patch<IsometricStorageLocation>(
    `${storageLocationsPath(externalProjectId)}/${encodeURIComponent(storageLocationId)}`,
    body,
  );
}

export interface StorageLocationLookupOptions {
  pageSize?: number;
  maxPages?: number;
}

/**
 * Bounded full-list reconciliation because the endpoint exposes no supplier
 * reference filter. Duplicate matches and an exhausted bound both fail loudly.
 */
export async function findStorageLocationBySupplierReference(
  client: IsometricClient,
  externalProjectId: string,
  supplierReferenceId: string,
  options: StorageLocationLookupOptions = {},
): Promise<IsometricStorageLocation | null> {
  const pageSize = options.pageSize ?? DEFAULT_LOOKUP_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_LOOKUP_MAX_PAGES;
  if (
    !Number.isInteger(pageSize) ||
    pageSize <= 0 ||
    pageSize > MAX_LOOKUP_PAGE_SIZE
  ) {
    throw new Error(
      `Storage Location lookup pageSize must be an integer between 1 and ${MAX_LOOKUP_PAGE_SIZE}`,
    );
  }
  if (!Number.isInteger(maxPages) || maxPages <= 0) {
    throw new Error("Storage Location lookup maxPages must be a positive integer");
  }

  let after: string | undefined;
  let match: IsometricStorageLocation | null = null;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await client.get<StorageLocationPage>(
      storageLocationsPath(externalProjectId),
      { query: { first: pageSize, after } },
    );
    for (const location of page.nodes ?? []) {
      if (location.supplier_reference_id !== supplierReferenceId) continue;
      if (match) {
        throw new SafeError(
          "Multiple Isometric Storage Locations use this application site's stable reference. Resolve the duplicate records before retrying.",
        );
      }
      match = location;
    }

    if (!page.page_info.has_next_page) return match;
    after = page.page_info.end_cursor ?? undefined;
    if (!after) {
      throw new Error(
        "Isometric Storage Location pagination reported another page without a cursor",
      );
    }
  }

  throw new SafeError(
    "The Isometric Storage Location lookup exceeded its safety limit. Narrow the project catalogue before retrying.",
  );
}
