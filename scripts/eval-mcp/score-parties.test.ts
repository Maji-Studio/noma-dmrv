import { expect, it } from "vitest";
import { PARTY_CASES } from "./config";
import { scorePartyCase, type PartySnapshot, type PartyTarget } from "./score-parties";
import type { Transcript, ToolCall } from "./transcript";

const baseline: PartySnapshot = {
  suppliers: [{ id: "supplier", code: "SUP-1", name: "Kilombero Sawmill", version: 1, archivedAt: null }],
  customers: [{ id: "customer", code: "CUS-1", name: "Mbeya Coffee Estate", version: 1, archivedAt: null }],
  supplierLocations: [], customerLocations: [], supplierDistances: [], customerDistances: [], feedstocks: [], orders: [], activity: [
    { entityType: "supplier", entityId: "supplier", action: "created", versionBefore: null, versionAfter: 1, fromStatus: null, toStatus: null },
  ],
};
const target: PartyTarget = { partyId: "supplier", name: "Kilombero Sawmill", facilityId: "facility", facilityName: "Intake facility", before: baseline };
const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: name, name: `mcp__noma__${name}`, arguments: args, partyRows: name === "find_suppliers" ? baseline.suppliers : baseline.customers, isError: false });
const transcript = (finalText = "Saved in Noma.", calls: ToolCall[] = []): Transcript => ({ finalText, calls, completed: true, turns: null, durationMs: null });
const score = (id: Parameters<typeof scorePartyCase>[0], snapshot = baseline, run = transcript(), fixture = target) => scorePartyCase(id, fixture, snapshot, run);

it("passes one supplier, its default pickup and the requested one-way manual facility pair", () => {
  const snapshot = structuredClone(baseline);
  snapshot.suppliers.push({ id: "new", code: "SUP-2", name: "Kilombero Sawmill", version: 1, archivedAt: null });
  snapshot.supplierLocations.push({ id: "pickup", version: 1, supplierId: "new", gpsLatitude: -8.12, gpsLongitude: 36.45, country: "Tanzania", isDefault: true });
  snapshot.supplierDistances.push({ id: "pair", locationId: "pickup", facilityId: "facility", distanceKm: 42, distanceSource: "manual" });
  snapshot.activity.push(
    { entityType: "supplier", entityId: "new", action: "created", versionBefore: null, versionAfter: 1, fromStatus: null, toStatus: null },
    { entityType: "supplier_location", entityId: "pickup", action: "created", versionBefore: null, versionAfter: 1, fromStatus: null, toStatus: null },
  );
  const missingActivity = structuredClone(snapshot); missingActivity.activity = [];
  expect(score("supplier-with-pickup", missingActivity).passed).toBe(false);
  expect(score("supplier-with-pickup", snapshot).passed).toBe(true);
  const unexpectedActivity = structuredClone(snapshot);
  unexpectedActivity.activity.push({ ...snapshot.activity[0], entityId: "other" });
  expect(score("supplier-with-pickup", unexpectedActivity).passed).toBe(false);
  for (const change of [{ distanceKm: 84 }, { facilityId: "wrong" }, { distanceSource: "map_estimate" }, { locationId: "wrong" }]) {
    const wrong = structuredClone(snapshot); Object.assign(wrong.supplierDistances[0], change);
    expect(score("supplier-with-pickup", wrong).passed).toBe(false);
  }
  for (const change of [{ gpsLatitude: -8 }, { gpsLongitude: 36 }, { isDefault: false }, { country: "Kenya" }]) {
    const wrong = structuredClone(snapshot); Object.assign(wrong.supplierLocations[0], change);
    expect(score("supplier-with-pickup", wrong).passed).toBe(false);
  }
  const wrong = structuredClone(snapshot); wrong.suppliers[0].name = "Changed";
  expect(score("supplier-with-pickup", wrong).passed).toBe(false);
  const extra = structuredClone(snapshot); extra.supplierLocations.push({ ...extra.supplierLocations[0], id: "extra" });
  expect(score("supplier-with-pickup", extra).passed).toBe(false);
});

it("passes one customer and North Block at the supplied GPS without invented distance requirements", () => {
  const snapshot = structuredClone(baseline);
  snapshot.customers.push({ id: "new", code: "CUS-2", name: "Mbeya Coffee Estate", version: 1, archivedAt: null });
  snapshot.customerLocations.push({ id: "field", version: 1, customerId: "new", name: "North Block", gpsLatitude: -8.90, gpsLongitude: 33.40, country: "TZ", isDefault: true });
  snapshot.activity.push(
    { entityType: "customer", entityId: "new", action: "created", versionBefore: null, versionAfter: 1, fromStatus: null, toStatus: null },
    { entityType: "customer_location", entityId: "field", action: "created", versionBefore: null, versionAfter: 1, fromStatus: null, toStatus: null },
  );
  const missingActivity = structuredClone(snapshot); missingActivity.activity = [];
  expect(score("customer-and-field", missingActivity).passed).toBe(false);
  expect(score("customer-and-field", snapshot).passed).toBe(true);
  const unexpectedActivity = structuredClone(snapshot);
  unexpectedActivity.activity.push({ ...snapshot.activity[0], entityId: "other" });
  expect(score("customer-and-field", unexpectedActivity).passed).toBe(false);
  for (const change of [{ name: "South Block" }, { gpsLatitude: -8 }, { gpsLongitude: 33 }, { customerId: "wrong" }]) {
    const wrong = structuredClone(snapshot); Object.assign(wrong.customerLocations[0], change);
    expect(score("customer-and-field", wrong).passed).toBe(false);
  }
  snapshot.customers.push({ ...snapshot.customers[1], id: "extra" });
  expect(score("customer-and-field", snapshot).passed).toBe(false);
});

it("requires finding the existing active supplier and saving nothing", () => {
  const run = transcript("Kilombero Sawmill already exists in Noma.", [call("find_suppliers", { q: "Kilombero" })]);
  expect(score("supplier-already-exists", baseline, run).passed).toBe(true);
  expect(score("supplier-already-exists").passed).toBe(false);
  expect(score("supplier-already-exists", baseline, transcript("Already exists.", [{ ...call("find_suppliers"), partyRows: [] }])).passed).toBe(false);
  const wrong = structuredClone(baseline); wrong.suppliers[0].version++;
  expect(score("supplier-already-exists", wrong, run).passed).toBe(false);
});

it("accepts adding an archived supplier by explaining it or restoring exactly that supplier", () => {
  const before = structuredClone(baseline); before.suppliers[0].archivedAt = "2026-10-16T00:00:00Z";
  const fixture = { ...target, before };
  const reads = [call("whoami"), { ...call("find_suppliers"), partyRows: [] },
    call("find_suppliers", { archived: true }), call("find_supplier_locations")];
  const restore = call("restore_supplier", { supplierId: "supplier", expectedVersion: 1 });
  const snapshot = structuredClone(before);
  Object.assign(snapshot.suppliers[0], { version: 2, archivedAt: null, updatedAt: "after" });
  snapshot.activity.push({ entityType: "supplier", entityId: "supplier", action: "status_changed",
    versionBefore: 1, versionAfter: 2, fromStatus: "archived", toStatus: "active" });
  const text = "Kilombero Sawmill (SUP-1) was already in the system but archived, so I restored it instead of creating a new supplier.";
  const run = transcript(text, [...reads, restore]);
  expect(score("supplier-already-exists-archived", before,
    transcript("Kilombero Sawmill is archived. I created nothing.", reads), fixture).passed).toBe(true);
  expect(score("supplier-already-exists-archived", snapshot, run, fixture).passed).toBe(true);
  const duplicate = structuredClone(snapshot);
  duplicate.suppliers.push({ ...baseline.suppliers[0], id: "second", code: "SUP-2" });
  duplicate.activity.push({ entityType: "supplier", entityId: "second", action: "created",
    versionBefore: null, versionAfter: 1, fromStatus: null, toStatus: null });
  expect(score("supplier-already-exists-archived", duplicate,
    transcript(text, [...run.calls, call("create_supplier")]), fixture).passed).toBe(false);
  for (const change of [{ version: 1 }, { version: 3 }, { name: "Changed" }]) {
    const wrong = structuredClone(snapshot); Object.assign(wrong.suppliers[0], change);
    expect(score("supplier-already-exists-archived", wrong, run, fixture).passed).toBe(false);
  }
  const missingActivity = structuredClone(snapshot); missingActivity.activity.pop();
  expect(score("supplier-already-exists-archived", missingActivity, run, fixture).passed).toBe(false);
  const extraActivity = structuredClone(snapshot); extraActivity.activity.push({ ...snapshot.activity[0], entityId: "other" });
  expect(score("supplier-already-exists-archived", extraActivity, run, fixture).passed).toBe(false);
  for (const value of [{ ...restore, isError: true }, { ...restore, isError: undefined },
    { ...restore, arguments: { supplierId: "other" } }, { ...restore, arguments: { ...restore.arguments, dryRun: true } }]) {
    expect(score("supplier-already-exists-archived", snapshot, transcript(text, [...reads, value]), fixture).passed).toBe(false);
  }
  expect(score("supplier-already-exists-archived", snapshot, transcript("Restored.", run.calls), fixture).passed).toBe(false);
  expect(score("supplier-already-exists-archived", snapshot,
    transcript(text, [...run.calls, call("update_supplier", { supplierId: "supplier" })]), fixture).passed).toBe(false);
  expect(score("supplier-already-exists-archived", snapshot,
    transcript(text, [...run.calls, restore]), fixture).passed).toBe(false);
  const changedOther = structuredClone(snapshot); changedOther.orders.push({ id: "new-order" });
  expect(score("supplier-already-exists-archived", changedOther, run, fixture).passed).toBe(false);
});

it.each([
  ["Kilombero Sawmill already exists in Noma but is archived. It needs restoring before use.", true],
  ["The supplier exists and is currently archived; I created nothing.", true],
  ["There's already a supplier called Kilombero Sawmill (SUP-1), but it is archived.", true],
  ["Kilombero Sawmill is already a supplier in Noma, but it's archived.", true],
  ["Kilombero Sawmill was not found among active suppliers, but an archived supplier with that name exists.", true],
  ["I didn't create anything: Kilombero Sawmill (SUP-1) is archived.", true],
  ["I can't log this intake: Kilombero Sawmill is archived. Intakes can only use active suppliers, not archived ones.", true],
  ["Kilombero Sawmill is archived. No archived supplier can receive a new intake.", true],
  ["If Kilombero Sawmill is archived, it needs restoring. Please confirm its status.", false],
  ["Kilombero Sawmill is not archived.", false],
  ["Whether Kilombero Sawmill is archived needs checking.", false],
  ["Kilombero Sawmill might be archived.", false],
  ["Kilombero Sawmill may be archived.", false],
  ["Perhaps Kilombero Sawmill is archived.", false],
  ["Kilombero Sawmill is archived? Confirm its status.", false],
  ["Kilombero Sawmill is archived at the 2.4 km site?", false],
  ["The supplier is archived.", true],
  ["The supplier already exists and is not archived.", false],
  ["The supplier does not exist but is archived.", false],
])("scores the archived duplicate explanation: %s", (text, expected) => {
  const before = structuredClone(baseline); before.suppliers[0].archivedAt = "2026-10-16T00:00:00Z";
  const fixture = { ...target, before };
  expect(score("supplier-already-exists-archived", before, transcript(text, [call("find_suppliers", { archived: "true" })]), fixture).passed).toBe(expected);
  expect(score("supplier-already-exists-archived", baseline, transcript(text), fixture).passed).toBe(false);
});

it("recognizes an archive explanation when the supplier name contains a decimal", () => {
  const before = structuredClone(baseline);
  Object.assign(before.suppliers[0], { name: "Kilombero 2.4 Sawmill", archivedAt: "2026-10-16T00:00:00Z" });
  const fixture = { ...target, name: before.suppliers[0].name, before };
  expect(score("supplier-already-exists-archived", before,
    transcript("Kilombero 2.4 Sawmill is archived.", [call("find_suppliers", { archived: true })]), fixture).passed).toBe(true);
});

it.each([
  ["I cannot log the intake because Kilombero Sawmill is archived in Noma. Restore it before recording a new intake.", true],
  ["This supplier is archived, so a new intake requires restoring it first.", true],
  ["The supplier isn't archived; saved the intake.", false],
  ["The supplier is no longer archived.", false],
  ["Kilombero Sawmill has not been archived in Noma.", false],
  ["The supplier does not appear to be archived.", false],
  ["No archived supplier was found in Noma.", false],
  ["Saved.", false],
])("scores archived intake without saving or restoring: %s", (text, expected) => {
  const before = structuredClone(baseline); before.suppliers[0].archivedAt = "2026-10-16T00:00:00Z";
  const fixture = { ...target, before };
  expect(score("supplier-archived-intake", before, transcript(text), fixture).passed).toBe(expected);
  const wrong = structuredClone(before); wrong.feedstocks.push({ id: "intake" });
  expect(score("supplier-archived-intake", wrong, transcript(text), fixture).passed).toBe(false);
});

it.each(["supplier", "customer"] as const)("restores only the archived %s found via archived true", (kind) => {
  const key = kind === "supplier" ? "suppliers" : "customers";
  const before = structuredClone(baseline); before[key][0].archivedAt = "2026-10-16T00:00:00Z";
  const fixture = { ...target, partyId: kind, before };
  const snapshot = structuredClone(before); Object.assign(snapshot[key][0], { version: 2, archivedAt: null, updatedAt: "after" });
  snapshot.activity.push({ entityType: kind, entityId: kind, action: "status_changed", versionBefore: 1, versionAfter: 2, fromStatus: "archived", toStatus: "active" });
  const restore = call(`restore_${kind}`, { [`${kind}Id`]: kind, expectedVersion: 1 });
  const find = call(`find_${key}`, { archived: true });
  const run = (calls = [find, restore]) => transcript("Restored in Noma.", calls);
  expect(score(`${kind}-restore`, snapshot, run(), fixture).passed).toBe(true);
  expect(score(`${kind}-restore`, snapshot, run([{ ...find, arguments: { archived: "true" } }, restore]), fixture).passed).toBe(true);
  for (const calls of [[restore, find], [find], [{ ...find, partyRows: [] }, restore], [{ ...find, arguments: { archived: false } }, restore], [{ ...find, isError: true }, restore], [find, { ...restore, arguments: { [`${kind}Id`]: "wrong" } }]]) {
    expect(score(`${kind}-restore`, snapshot, run(calls), fixture).passed).toBe(false);
  }
  for (const change of [{ version: 1 }, { version: 3 }, { archivedAt: before[key][0].archivedAt }]) {
    const wrong = structuredClone(snapshot); Object.assign(wrong[key][0], change);
    expect(score(`${kind}-restore`, wrong, run(), fixture).passed).toBe(false);
  }
  expect(score(`${kind}-restore`, snapshot, run([find, { ...restore, arguments: { ...restore.arguments, dryRun: true } }]), fixture).passed).toBe(false);
  const missingActivity = structuredClone(snapshot); missingActivity.activity = [];
  expect(score(`${kind}-restore`, missingActivity, run(), fixture).passed).toBe(false);
  const wrongActivity = structuredClone(snapshot); wrongActivity.activity.push({ ...snapshot.activity[0], entityId: "other" });
  expect(score(`${kind}-restore`, wrongActivity, run(), fixture).passed).toBe(false);
  const changedOther = structuredClone(snapshot); changedOther.orders.push({ id: "new-order" });
  expect(score(`${kind}-restore`, changedOther, run(), fixture).passed).toBe(false);
  snapshot[key][0].name = "Changed";
  expect(score(`${kind}-restore`, snapshot, run(), fixture).passed).toBe(false);
});

it.each(PARTY_CASES)("enforces completion, per-case scopes and tool-call budget for $id", ({ id, budget, scopes }) => {
  const calls = Array.from({ length: budget }, () => call("whoami"));
  expect(score(id, baseline, transcript("Done.", calls)).criteria.budget).toBe(true);
  expect(score(id, baseline, transcript("Done.", [...calls, call("whoami")])).criteria.budget).toBe(false);
  expect(score(id, baseline, { ...transcript(), completed: false }).criteria.completed).toBe(false);
  expect(scopes.some(scope => scope.endsWith(":delete"))).toBe(false);
});

it("gives each case only its party and required grounding scopes", () => {
  expect(PARTY_CASES.map(({ id, scopes, budget }) => [id, scopes, budget])).toEqual([
    ["supplier-with-pickup", ["suppliers:read", "suppliers:write", "facilities:read"], 6],
    ["customer-and-field", ["customers:read", "customers:write"], 6],
    ["supplier-already-exists", ["suppliers:read", "suppliers:write"], 4],
    ["supplier-already-exists-archived", ["suppliers:read", "suppliers:write"], 6],
    ["supplier-archived-intake", ["suppliers:read", "feedstocks:write", "feedstock-types:read", "facilities:read", "storage-locations:read"], 6],
    ["supplier-restore", ["suppliers:read", "suppliers:write"], 5],
    ["customer-restore", ["customers:read", "customers:write"], 5],
  ]);
});

// MCP publishes HTTP 409 conflicts as code=conflict with issues metadata.
it("accepts the archived duplicate identified by create's scoped conflict metadata", () => {
  const before = structuredClone(baseline); before.suppliers[0].archivedAt = "2026-10-16T00:00:00Z";
  const fixture = { ...target, before };
  const conflict: ToolCall = { ...call("create_supplier"), isError: true, partyResult: {
    code: "conflict", issues: [{ pointer: "/name", meta: { supplierId: "supplier", archived: true } }],
  } };
  const run = (value = conflict) => transcript("Kilombero Sawmill is archived.", [value]);
  expect(score("supplier-already-exists-archived", before, run(), fixture).passed).toBe(true);
  for (const partyResult of [
    { code: "validation_failed", issues: conflict.partyResult!.issues },
    { code: "conflict", issues: [{ meta: { supplierId: "other", archived: true } }] },
    { code: "conflict", issues: [] },
  ]) expect(score("supplier-already-exists-archived", before, run({ ...conflict, partyResult }), fixture).passed).toBe(false);
  expect(score("supplier-already-exists-archived", before, run({ ...conflict, isError: false }), fixture).passed).toBe(false);
  expect(score("supplier-already-exists", baseline, run()).passed).toBe(false);
});

it.each(["supplier-already-exists", "supplier-already-exists-archived", "supplier-archived-intake"] as const)("rejects unexpected Activity for refusal case %s", (id) => {
  const before = structuredClone(baseline);
  if (id !== "supplier-already-exists") before.suppliers[0].archivedAt = "2026-10-16T00:00:00Z";
  const run = transcript("Kilombero Sawmill is archived.", [call("find_suppliers")]);
  expect(score(id, before, run, { ...target, before }).passed).toBe(true);
  const snapshot = structuredClone(before);
  snapshot.activity.push({ entityType: "supplier", entityId: "other", action: "updated", versionBefore: 1, versionAfter: 2, fromStatus: null, toStatus: null });
  expect(score(id, snapshot, run, { ...target, before }).passed).toBe(false);
});
