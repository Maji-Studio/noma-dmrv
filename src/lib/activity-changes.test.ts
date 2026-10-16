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
  expect(diffActivityChanges("production_run", { feedstockDraws: [{ storageLocationId: "a" }] }, { feedstockDraws: [{ storageLocationId: "b" }] })).toEqual({ changedFields: ["feedstockDraws"], changes: {} });
});

it("compares exponent-shaped boundary properties verbatim without expanding them", () => {
  const before = { gisBoundary: { properties: { reference_id: "1e1000000000" } } };
  expect(diffActivityChanges("application", before, before)).toEqual({ changedFields: [], changes: {} });
  expect(diffActivityChanges("application", before, { gisBoundary: { properties: { reference_id: "1e1000000001" } } }))
    .toEqual({ changedFields: ["gisBoundary"], changes: {} });
});

it("preserves leading zeroes in boundary string properties", () => {
  expect(diffActivityChanges("application", { gisBoundary: { properties: { reference_id: "001" } } },
    { gisBoundary: { properties: { reference_id: "1" } } }))
    .toEqual({ changedFields: ["gisBoundary"], changes: {} });
});

it("reports a change to a feature's properties.id in a boundary column", () => {
  const boundary = (id: string) => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: { id } }] });
  expect(diffActivityChanges("application", { gisBoundary: boundary("old") }, { gisBoundary: boundary("new") }))
    .toEqual({ changedFields: ["gisBoundary"], changes: {} });
});

it("reports reordered lists inside a boundary column", () => {
  expect(diffActivityChanges("application", { gisBoundary: { properties: { labels: ["first", "second"] } } },
    { gisBoundary: { properties: { labels: ["second", "first"] } } }))
    .toEqual({ changedFields: ["gisBoundary"], changes: {} });
});

it("compares column JSON with sorted object keys and verbatim number types", () => {
  const before = { metadata: { id: "document", count: 1 } };
  expect(diffActivityChanges("document", before, { metadata: { count: 1, id: "document" } }))
    .toEqual({ changedFields: [], changes: {} });
  expect(diffActivityChanges("document", before, { metadata: { id: "document", count: "1" } }))
    .toEqual({ changedFields: ["metadata"], changes: {} });
});

it.each(["1e1000000000", "1e-1000000000"])("bounds decimal expansion for %s", value => {
  expect(diffActivityChanges("feedstock", null, { massWetKg: value }).changes)
    .toEqual({ massWetKg: { from: null, to: value } });
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
    originGpsLongitude: { from: null, to: null },
  });
  expect(diffActivityChanges("bin_movement", null, { outputKind: "loss", correctsMovementId: "prior", id: "movement" })).toEqual({
    changedFields: ["outputKind"], changes: { outputKind: { from: null, to: "loss" } },
  });
});

it.each([
  ["application", "gpsLatitude", "gpsLongitude"],
  ["transport_leg", "originGpsLatitude", "originGpsLongitude"],
  ["transport_leg", "destinationGpsLatitude", "destinationGpsLongitude"],
])("captures the full %s point for %s and %s changes", (entityType, latitude, longitude) => {
  const before = { [latitude]: "1.00", [longitude]: "2.00" };
  expect(diffActivityChanges(entityType, before, { [latitude]: "3", [longitude]: "2" })).toEqual({
    changedFields: [latitude], changes: {
      [latitude]: { from: "1", to: "3" }, [longitude]: { from: "2", to: "2" },
    },
  });
  expect(diffActivityChanges(entityType, before, { [latitude]: "1", [longitude]: "3" })).toEqual({
    changedFields: [longitude], changes: {
      [latitude]: { from: "1", to: "1" }, [longitude]: { from: "2", to: "3" },
    },
  });
  expect(diffActivityChanges(entityType, before, { [latitude]: "1", [longitude]: "2" })).toEqual({ changedFields: [], changes: {} });
  expect(diffActivityChanges(entityType, before, { [latitude]: null, [longitude]: null })).toEqual({
    changedFields: [latitude, longitude].sort(), changes: {
      [latitude]: { from: "1", to: null }, [longitude]: { from: "2", to: null },
    },
  });
});

it("normalizes nested list bookkeeping and element order with persisted decimal strings", () => {
  const before = { allocations: [
    { id: "old", organizationId: "org", createdAt: new Date(), updatedAt: new Date(), version: 1,
      sourceId: "a", nested: { mass: "1.500", precise: "9007199254740993.10" } },
    { sourceId: "b", mass: "2e1" },
  ] };
  const after = { allocations: [
    { sourceId: "b", mass: "2e1" },
    { id: "new", version: 2, sourceId: "a", nested: { precise: "9007199254740993.10", mass: "1.500" } },
  ] };
  expect(diffActivityChanges("application", before, after)).toEqual({ changedFields: [], changes: {} });
  expect(diffActivityChanges("application", before, { allocations: [...after.allocations, { sourceId: "c", mass: 1 }] }))
    .toEqual({ changedFields: ["allocations"], changes: {} });
});

it("normalizes nested JS numbers to exact decimal strings", () => {
  expect(diffActivityChanges("production_run", { feedstockDraws: [{ mass: 1e21 }] },
    { feedstockDraws: [{ mass: "1000000000000000000000" }] })).toEqual({ changedFields: [], changes: {} });
});

it("compares emissions values by content without capturing magnitudes or notes", () => {
  const before = { note: "private before", contentRevision: 1, values: [
    { id: "old-id", entryId: "entry", inputKey: "fuel", magnitude: "123.456", unit: "L" },
    { id: "other-id", entryId: "entry", inputKey: "power", magnitude: "2", unit: "kWh" },
  ] };
  const reordered = { ...before, contentRevision: 2, values: [
    { ...before.values[1], id: "replacement-1" }, { ...before.values[0], id: "replacement-2" },
  ] };
  expect(diffActivityChanges("emission_entry", before, reordered)).toEqual({ changedFields: [], changes: {} });
  const changed = { ...reordered, note: "private after",
    values: reordered.values.map(value => ({ ...value, magnitude: "9007199254740993.123" })) };
  expect(diffActivityChanges("emission_entry", before, changed)).toEqual({
    changedFields: ["note", "values"], changes: {},
  });
});

it("captures emissions dates and claim links while ignoring revisions", () => {
  expect(diffActivityChanges("emission_entry",
    { occurredOn: "2026-01-01", sentByRemovalId: null, version: 1, contentRevision: 1 },
    { occurredOn: "2026-01-02", sentByRemovalId: "removal-id", version: 2, contentRevision: 2 }))
    .toEqual({ changedFields: ["occurredOn", "sentByRemovalId"], changes: {
      occurredOn: { from: "2026-01-01", to: "2026-01-02" },
      sentByRemovalId: { from: null, to: "removal-id" },
    } });
});
