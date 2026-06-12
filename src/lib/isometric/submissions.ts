import { isometric, paginateAll } from "./client";
import type { components } from "./generated/certify";
import type { IsometricComponentScope } from "./projects";

// Reconciliation lookups stop after the first hit, so request the smallest
// page the API allows.
const SUPPLIER_REF_LOOKUP_PAGE_SIZE = 1;

export type CreateDatapointRequest =
  components["schemas"]["CreateDatapointRequest"];
export type PatchDatapointRequest =
  components["schemas"]["PatchDatapointRequest"];
export type Datapoint = components["schemas"]["Datapoint"];
export type CreateGhgEntryRequest =
  components["schemas"]["CreateGhgEntryRequest"];
export type GhgEntry = components["schemas"]["GhgEntry"];
export type CreateComponentRequest =
  components["schemas"]["CreateComponentRequest"];
export type Component = components["schemas"]["Component"];

export function createDatapoint(body: CreateDatapointRequest): Promise<Datapoint> {
  return isometric.post<Datapoint>("/datapoints", body);
}

export function patchDatapoint(
  id: string,
  body: PatchDatapointRequest,
): Promise<Datapoint> {
  return isometric.patch<Datapoint>(`/datapoints/${id}`, body);
}

export function createGhgEntry(body: CreateGhgEntryRequest): Promise<GhgEntry> {
  return isometric.post<GhgEntry>("/ghg_entries", body);
}

// Defined for completeness; templated GHG entries embed inputs directly via
// CreateGhgEntryRequest.ghg_entry_template_components, so Phase 3 does not call
// this. Reserved for Phase 4 standalone-component flows.
export function createComponent(body: CreateComponentRequest): Promise<Component> {
  return isometric.post<Component>("/components", body);
}

// Reconciliation lookup: when a draft submission row is left locked after a
// 5xx and the remote entity may already exist, look it up by the
// supplier_reference_id we wrote at insert time. Stops after the first hit
// instead of paginating to exhaustion.
async function findBySupplierRef<T>(
  path: string,
  ref: string,
): Promise<T | null> {
  for await (const node of isometric.paginate<T>(path, {
    query: { supplier_reference_id: ref },
    pageSize: SUPPLIER_REF_LOOKUP_PAGE_SIZE,
  })) {
    return node;
  }
  return null;
}

export function findGhgEntryBySupplierRef(
  ref: string,
): Promise<GhgEntry | null> {
  return findBySupplierRef<GhgEntry>("/ghg_entries", ref);
}

export function findDatapointBySupplierRef(
  ref: string,
): Promise<Datapoint | null> {
  return findBySupplierRef<Datapoint>("/datapoints", ref);
}

// Lists every Datapoint referenced by Components in the given scope (default
// PROJECT). Used by the drift panel + coverage check to resolve magnitudes
// for PROJECT-scope Components — ComponentScalarInput only carries
// `datapoint_id`, so the drift matcher needs this lookup. The
// `used_in_scope` filter is supported by `GET /datapoints` directly, so one
// paged list returns the full inventory.
export interface ListDatapointsArgs {
  projectId?: string;
  usedInScope?: IsometricComponentScope;
  supplierReferenceId?: string;
}

export function listDatapoints(
  args: ListDatapointsArgs = {},
): Promise<Datapoint[]> {
  return paginateAll<Datapoint>("/datapoints", {
    query: {
      project_id: args.projectId,
      used_in_scope: args.usedInScope,
      supplier_reference_id: args.supplierReferenceId,
    },
  });
}
