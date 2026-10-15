import { DOCUMENT_ENTITY_TYPES } from "@/schemas/documents";
import { expect, it } from "vitest";
import { createOperationActivity, linkDocumentActivity, singleProductionRunId } from "./activity-links";

const ID = "entity-id";
const FACILITY_ID = "facility-id";
const RUN_ID = "run-id";
const BATCH_ID = "batch-id";

it("merges shared and per-entity links without linking siblings", () => {
  const activity = createOperationActivity();
  activity.link({ facilityId: FACILITY_ID });
  activity.link({ creditBatchId: BATCH_ID }, ID);
  activity.link({ productionRunId: RUN_ID }, ID);
  expect(activity.links("lab_sample", ID)).toEqual({ facilityId: FACILITY_ID, creditBatchId: BATCH_ID, productionRunId: RUN_ID });
  expect(activity.links("lab_sample", "other")).toEqual({ facilityId: FACILITY_ID });
});

it("anchors run and batch tombstones and isolates replay suppression per attempt", () => {
  const activity = createOperationActivity();
  expect(activity.links("production_run", ID).productionRunId).toBe(ID);
  expect(activity.links("credit_batch", ID).creditBatchId).toBe(ID);
  activity.skip();
  expect(activity.skipped).toBe(true);
  expect(createOperationActivity().skipped).toBe(false);
});

it("links a single source run and leaves mixed sources unlinked", () => {
  expect(singleProductionRunId([RUN_ID, RUN_ID, null])).toBe(RUN_ID);
  expect(singleProductionRunId([RUN_ID, "other"])).toBeUndefined();
  expect(singleProductionRunId([])).toBeUndefined();
});

it.each([["production_run", "productionRunId"], ["credit_batch", "creditBatchId"]] as const)("links documents owned by %s", (entityType, key) => {
  const activity = createOperationActivity();
  linkDocumentActivity(activity, { documentType: "pdf", entityType, entityId: ID });
  expect(activity.links("document", "document-id")[key]).toBe(ID);
});

it("fans one entity out to each distinct scope over its shared links", () => {
  const activity = createOperationActivity();
  activity.link({ facilityId: FACILITY_ID });
  activity.scope(ID, [{ creditBatchId: BATCH_ID, productionRunId: RUN_ID }, { creditBatchId: BATCH_ID, productionRunId: RUN_ID }, { productionRunId: "other-run" }]);
  expect(activity.scopedLinks("application", ID)).toEqual([
    { facilityId: FACILITY_ID, creditBatchId: BATCH_ID, productionRunId: RUN_ID },
    { facilityId: FACILITY_ID, creditBatchId: undefined, productionRunId: "other-run" },
  ]);
  expect(activity.scopedLinks("application", "other")).toEqual([{ facilityId: FACILITY_ID, creditBatchId: undefined, productionRunId: undefined }]);
});

it.each(DOCUMENT_ENTITY_TYPES)("preserves the reason code for %s document owners", entityType => {
  const activity = createOperationActivity();
  linkDocumentActivity(activity, { documentType: "pdf", entityType, entityId: ID });
  expect(activity.links("document", "document-id").reasonCode).toBe(`document:pdf:${entityType}:${ID}`);
});
