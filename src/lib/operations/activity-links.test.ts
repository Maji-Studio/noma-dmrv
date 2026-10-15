import { expect, it } from "vitest";
import { operationActivityLinks } from "./activity-links";

const ID = "entity-id";
const FACILITY_ID = "facility-id";
const RUN_ID = "run-id";
const BATCH_ID = "batch-id";

it.each(["product", "sample", "order", "delivery", "movement"])("reads links from the %s result envelope or native row", (key) => {
  const row = { id: ID, facilityId: FACILITY_ID, creditBatchId: BATCH_ID, productionRunId: RUN_ID, notes: "Private content" };
  const links = { facilityId: FACILITY_ID, creditBatchId: BATCH_ID, productionRunId: RUN_ID };
  expect(operationActivityLinks({ [key]: row }, "lab_sample", ID)).toEqual(links);
  expect(operationActivityLinks(row, "lab_sample", ID)).toEqual(links);
});

it("matches each split-intake entity instead of using its first sibling", () => {
  const feedstocks = [{ id: "other", facilityId: "other-facility" }, { id: ID, facilityId: FACILITY_ID }];
  expect(operationActivityLinks({ feedstocks }, "feedstock", ID).facilityId).toBe(FACILITY_ID);
  expect(operationActivityLinks({ feedstocks }, "feedstock", "missing").facilityId).toBeUndefined();
});

it("anchors production-run tombstones without an output row", () => {
  expect(operationActivityLinks(undefined, "production_run", ID)).toEqual({ productionRunId: ID });
  expect(operationActivityLinks(undefined, "order", ID)).toEqual({});
});

it("links products to a single source run in native and public results, leaving mixed sources unlinked", () => {
  expect(operationActivityLinks({ product: { id: ID, linkedProductionRunId: RUN_ID } }, "biochar_product", ID).productionRunId).toBe(RUN_ID);
  const product = { id: ID, sourceAllocations: [{ productionRunId: RUN_ID }] };
  expect(operationActivityLinks({ product }, "biochar_product", ID).productionRunId).toBe(RUN_ID);
  product.sourceAllocations.push({ productionRunId: "other-run" });
  expect(operationActivityLinks({ product }, "biochar_product", ID).productionRunId).toBeUndefined();
});

it("uses a movement's public run IDs or native preview allocations only when unambiguous", () => {
  expect(operationActivityLinks({ movement: { id: ID, productionRunIds: [RUN_ID] } }, "bin_movement", ID).productionRunId).toBe(RUN_ID);
  const output = { movementId: ID, preview: { allocations: [{ runs: [{ productionRunId: RUN_ID }] }, { runs: [{ productionRunId: RUN_ID }] }] } };
  expect(operationActivityLinks(output, "bin_movement", ID).productionRunId).toBe(RUN_ID);
  output.preview.allocations[0].runs.push({ productionRunId: "other-run" });
  expect(operationActivityLinks(output, "bin_movement", ID).productionRunId).toBeUndefined();
});

it("matches a native movement ID and takes its returned facility only for that entity", () => {
  const output = { movementId: ID, facilityId: FACILITY_ID };
  expect(operationActivityLinks(output, "bin_movement", ID).facilityId).toBe(FACILITY_ID);
  expect(operationActivityLinks(output, "bin_movement", "other").facilityId).toBeUndefined();
  expect(operationActivityLinks(output, "order", ID).facilityId).toBeUndefined();
});
