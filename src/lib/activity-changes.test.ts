import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { diffActivityChanges, activityFieldPolicies } from "./activity-changes";

describe("activity change capture", () => {
  it("compares decimals exactly and omits unchanged re-sent fields", () => {
    expect(diffActivityChanges("feedstock", { massWetKg: "1.50", notes: "private", version: 1 },
      { massWetKg: "1.5", notes: "private", version: 2 })).toEqual({ changedFields: [], changes: {} });
    expect(diffActivityChanges("feedstock", { massWetKg: "1.5", supplierId: "a", notes: "old private" },
      { massWetKg: "2.50", supplierId: "b", notes: "new private" })).toEqual({
      changedFields: ["massWetKg", "notes", "supplierId"], changes: {
        massWetKg: { from: "1.5", to: "2.5" }, supplierId: { from: "a", to: "b" },
      },
    });
  });
  it("classifies every column explicitly", () => {
    for (const policy of Object.values(activityFieldPolicies)) {
      for (const field of Object.keys(getTableColumns(policy.table))) expect(policy.fields).toHaveProperty(field);
    }
  });
});

it("creates scalar values and omits nulls and bookkeeping; deletes have no fields", () => {
  expect(diffActivityChanges("feedstock", null, { id: "id", code: "FI-1", notes: null, massWetKg: "2.00", version: 1 })).toEqual({
    changedFields: ["code", "massWetKg"], changes: { code: { from: null, to: "FI-1" }, massWetKg: { from: null, to: "2" } },
  });
  expect(diffActivityChanges("feedstock", { code: "FI-1" }, null)).toEqual({ changedFields: [], changes: {} });
});
it("compares dates by instant and calendar day", () => {
  expect(diffActivityChanges("lab_sample", { samplingTime: new Date("2026-01-01T00:00:00Z"), analysisDate: "2026-01-01" },
    { samplingTime: "2026-01-01T01:00:00+01:00", analysisDate: new Date("2026-01-01T12:00:00Z") })).toEqual({ changedFields: [], changes: {} });
  expect(diffActivityChanges("lab_sample", null, { samplingTime: new Date("2026-01-01T00:00:00Z"), analysisDate: "2026-01-01" }).changes).toEqual({
    analysisDate: { from: null, to: "2026-01-01" }, samplingTime: { from: null, to: "2026-01-01T00:00:00.000Z" },
  });
});
it("never stores notes, filenames, document metadata or unknown values", () => {
  const result = diffActivityChanges("document", {}, { notes: "secret note", fileName: "secret.pdf", description: "private description", fileSizeBytes: 99, mimeType: "private/type", checksumSha256: "secret hash", visibility: "private", futureField: "unknown secret" });
  expect(result.changedFields).toEqual(["checksumSha256", "description", "fileName", "fileSizeBytes", "futureField", "mimeType", "notes", "visibility"]);
  expect(result.changes).toEqual({ visibility: { from: null, to: "private" } });
  expect(JSON.stringify(result)).not.toContain("secret");
});
it("compares nested objects deeply and records changed lists by name only", () => {
  expect(diffActivityChanges("production_run", { feedstockDraws: [{ id: "a", mass: 1 }] }, { feedstockDraws: [{ mass: 1, id: "a" }] }).changedFields).toEqual([]);
  expect(diffActivityChanges("production_run", { feedstockDraws: [{ id: "a" }] }, { feedstockDraws: [{ id: "b" }] })).toEqual({ changedFields: ["feedstockDraws"], changes: {} });
});

it("captures each entity independently without leaking values into links", async () => {
  const { createOperationActivity } = await import("./operations/activity-links");
  const activity = createOperationActivity();
  activity.capture("a", { massWetKg: "1" }, { massWetKg: "2" });
  activity.capture("b", null, { massWetKg: "3" });
  expect(activity.diff("feedstock", "a").changes).toEqual({ massWetKg: { from: "1", to: "2" } });
  expect(activity.diff("feedstock", "b").changes).toEqual({ massWetKg: { from: null, to: "3" } });
});

it("covers every canonical activity entity and keeps choices, places and people IDs", async () => {
  const { ACTIVITY_ENTITY_TYPES } = await import("@/db/schema/common");
  expect(Object.keys(activityFieldPolicies).sort()).toEqual([...ACTIVITY_ENTITY_TYPES].sort());
  expect(diffActivityChanges("production_run", null, { operatorId: "operator-id", status: "running" }).changes).toEqual({
    operatorId: { from: null, to: "operator-id" }, status: { from: null, to: "running" },
  });
  expect(diffActivityChanges("transport_leg", null, { originName: "Dar es Salaam", originGpsLatitude: -6.8 }).changes).toEqual({
    originName: { from: null, to: "Dar es Salaam" }, originGpsLatitude: { from: null, to: "-6.8" },
  });
  expect(diffActivityChanges("bin_movement", null, { outputKind: "loss", correctsMovementId: "prior", id: "movement" })).toEqual({
    changedFields: ["outputKind"], changes: { outputKind: { from: null, to: "loss" } },
  });
});
