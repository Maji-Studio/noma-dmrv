import type { EntityType } from "./types";

/**
 * Operator-facing name for each entity type, in the canonical form from
 * `CONTEXT.md`. Read as a noun mid-sentence ("Select storage bin…",
 * "Create storage bin"), so a select and the quick-add dialog it opens say one
 * name for one thing.
 *
 * Single source of truth: the select and the dialog previously kept separate
 * copies of this map and drifted apart.
 */
export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  facility: "facility",
  reactor: "reactor",
  supplier: "supplier",
  customer: "customer",
  driver: "driver",
  operator: "operator",
  storageLocation: "storage bin",
  vehicle: "vehicle",
  feedstockType: "feedstock type",
  feedstock: "feedstock",
  productionRun: "production run",
  application: "application",
  formulation: "formulation",
  biocharProduct: "biochar product",
  order: "order",
  creditBatch: "credit batch",
};
