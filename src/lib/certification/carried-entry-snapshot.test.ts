import { expect, it } from "vitest";
import { carriedEntrySnapshotSchema } from "./carried-entry-snapshot";
import { normalizeCarriedEntriesForHash } from "@/fn/certification/removal-entry-hash";

it("reads the writer's frozen carry facts with the same schema", () => {
  const [snapshot] = normalizeCarriedEntriesForHash([{
    entryId: "entry", creditBatchId: "batch", creditBatchCode: "CB-001", componentId: "component",
    occurredOn: "2026-03-01", value: { magnitude: "12", unit: "L" }, evidenceDocumentIds: ["z", "a"],
    earlierRemovalId: "earlier", earlierRemovalCode: "RM-001",
  }])!;
  expect(carriedEntrySnapshotSchema.parse(snapshot)).toEqual({
    entryId: "entry", creditBatchId: "batch", componentId: "component", occurredOn: "2026-03-01",
    value: { magnitude: "12", unit: "L" }, evidenceDocumentIds: ["a", "z"], earlierRemovalId: "earlier",
  });
});
it("does not accept an incomplete frozen value or missing evidence identity list", () => {
  const snapshot = { entryId: "entry", creditBatchId: "batch", componentId: "component", occurredOn: "2026-03-01" };
  expect(carriedEntrySnapshotSchema.safeParse({ ...snapshot, value: { magnitude: "12" }, evidenceDocumentIds: [] }).success).toBe(false);
  expect(carriedEntrySnapshotSchema.safeParse({ ...snapshot, value: { magnitude: "12", unit: "L" } }).success).toBe(false);
});
it("keeps the writer's existing value object intact rather than stripping extra operands", () => {
  const value = { magnitude: "12", unit: "L", inputKey: "diesel" };
  const [snapshot] = normalizeCarriedEntriesForHash([{
    entryId: "entry", creditBatchId: "batch", creditBatchCode: "CB-001", componentId: "component",
    occurredOn: "2026-03-01", value, evidenceDocumentIds: [],
  }])!;
  expect(snapshot.value).toBe(value);
});
