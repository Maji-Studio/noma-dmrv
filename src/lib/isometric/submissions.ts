import type { IsometricClient } from "./client";
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
export type ComponentAttribution =
  components["schemas"]["ComponentAttribution"];

export function createDatapoint(client: IsometricClient, body: CreateDatapointRequest): Promise<Datapoint> {
  return client.post<Datapoint>("/datapoints", body);
}

export function patchDatapoint(
  client: IsometricClient,
  id: string,
  body: PatchDatapointRequest,
): Promise<Datapoint> {
  return client.patch<Datapoint>(`/datapoints/${id}`, body);
}

export function createGhgEntry(client: IsometricClient, body: CreateGhgEntryRequest): Promise<GhgEntry> {
  return client.post<GhgEntry>("/ghg_entries", body);
}

// Reads back a submitted GHG entry (removal) so the UI can show the registry's
// verified accounting — net removed, the pre-uncertainty figure, the standard
// deviation behind the uncertainty discount, and the buffer-pool split. The
// detailed Sequestrations/Activities component split lives behind
// `/ghg_entries/{id}/component_attributions`; this entry-level read carries the
// netted figures we surface in the removal breakdown card.
export function getGhgEntry(client: IsometricClient, id: string): Promise<GhgEntry> {
  return client.get<GhgEntry>(`/ghg_entries/${id}`);
}

export function getDatapoint(
  client: IsometricClient,
  id: string,
): Promise<Datapoint> {
  return client.get<Datapoint>(
    `/datapoints/${encodeURIComponent(id)}`,
  );
}

export function getComponent(
  client: IsometricClient,
  id: string,
): Promise<Component> {
  return client.get<Component>(
    `/components/${encodeURIComponent(id)}`,
  );
}

export function listGhgEntryComponentAttributions(
  client: IsometricClient,
  ghgEntryId: string,
): Promise<ComponentAttribution[]> {
  return client.paginateAll<ComponentAttribution>(
    `/ghg_entries/${encodeURIComponent(ghgEntryId)}/component_attributions`,
  );
}

// Defined for completeness; templated GHG entries embed inputs directly via
// CreateGhgEntryRequest.ghg_entry_template_components, so Phase 3 does not call
// this. Reserved for Phase 4 standalone-component flows.
export function createComponent(client: IsometricClient, body: CreateComponentRequest): Promise<Component> {
  return client.post<Component>("/components", body);
}

// Reconciliation lookup: when a draft submission row is left locked after a
// 5xx and the remote entity may already exist, look it up by the
// supplier_reference_id we wrote at insert time. Stops after the first hit
// instead of paginating to exhaustion.
async function findBySupplierRef<T>(
  client: IsometricClient,
  path: string,
  ref: string,
): Promise<T | null> {
  for await (const node of client.paginate<T>(path, {
    query: { supplier_reference_id: ref },
    pageSize: SUPPLIER_REF_LOOKUP_PAGE_SIZE,
  })) {
    return node;
  }
  return null;
}

export function findGhgEntryBySupplierRef(
  client: IsometricClient,
  ref: string,
): Promise<GhgEntry | null> {
  return findBySupplierRef<GhgEntry>(client, "/ghg_entries", ref);
}

export function findDatapointBySupplierRef(
  client: IsometricClient,
  ref: string,
): Promise<Datapoint | null> {
  return findBySupplierRef<Datapoint>(client, "/datapoints", ref);
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
  client: IsometricClient,
  args: ListDatapointsArgs = {},
): Promise<Datapoint[]> {
  return client.paginateAll<Datapoint>("/datapoints", {
    query: {
      project_id: args.projectId,
      used_in_scope: args.usedInScope,
      supplier_reference_id: args.supplierReferenceId,
    },
  });
}
