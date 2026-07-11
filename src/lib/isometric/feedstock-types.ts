import type { IsometricClient } from "./client";
import type { components } from "./generated/certify";

export type IsometricFeedstockType = components["schemas"]["FeedstockType"];

// Account-global registry feedstock types (not project-scoped). Browse-only:
// noma keeps its own local feedstock_types table; this list is surfaced
// read-only in the feedstock-type form so operators can cross-reference the
// registry's catalogue (no local record is created from it).
export function listFeedstockTypes(client: IsometricClient): Promise<IsometricFeedstockType[]> {
  return client.paginateAll<IsometricFeedstockType>("/feedstock_types");
}
