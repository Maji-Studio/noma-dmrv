import { isometric } from "./client";
import type { components } from "./generated/certify";

export type CreateDatapointRequest =
  components["schemas"]["CreateDatapointRequest"];
export type Datapoint = components["schemas"]["Datapoint"];
export type CreateRemovalRequest =
  components["schemas"]["CreateRemovalRequest"];
export type Removal = components["schemas"]["Removal"];
export type CreateComponentRequest =
  components["schemas"]["CreateComponentRequest"];
export type Component = components["schemas"]["Component"];

export function createDatapoint(body: CreateDatapointRequest): Promise<Datapoint> {
  return isometric.post<Datapoint>("/datapoints", body);
}

export function createRemoval(body: CreateRemovalRequest): Promise<Removal> {
  return isometric.post<Removal>("/removals", body);
}

// Defined for completeness; templated removals embed inputs directly via
// CreateRemovalRequest.removal_template_components, so Phase 3 does not call
// this. Reserved for Phase 4 standalone-component flows.
export function createComponent(body: CreateComponentRequest): Promise<Component> {
  return isometric.post<Component>("/components", body);
}

// Reserved for Phase 4 reconciliation: when a draft submission row is left
// locked after a 5xx and the remote entity may already exist, look it up by
// the supplier_reference_id we wrote at insert time.
export async function findRemovalBySupplierRef(
  ref: string,
): Promise<Removal | null> {
  const list = await isometric.paginateAll<Removal>("/removals", {
    query: { supplier_reference_id: ref },
    pageSize: 1,
  });
  return list[0] ?? null;
}

export async function findDatapointBySupplierRef(
  ref: string,
): Promise<Datapoint | null> {
  const list = await isometric.paginateAll<Datapoint>("/datapoints", {
    query: { supplier_reference_id: ref },
    pageSize: 1,
  });
  return list[0] ?? null;
}
