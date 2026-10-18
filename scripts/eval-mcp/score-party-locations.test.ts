import { expect, it } from "vitest";
import { scorePartyCase, type PartySnapshot, type PartyTarget } from "./score-parties";
import type { Transcript, ToolCall } from "./transcript";

const before: PartySnapshot = {
  suppliers: [], customers: [], supplierDistances: [], customerDistances: [], feedstocks: [], orders: [], activity: [],
  supplierLocations: [{ id: "pickup", supplierId: "supplier", city: "Old city", country: "TZ", version: 1, isDefault: true }],
  customerLocations: [{ id: "field", customerId: "customer", name: "North Block", version: 1, archivedAt: null, isDefault: false, defaultSoilTemperatureC: 23.5 }],
};
const target: PartyTarget = { partyId: "customer", locationId: "field", name: "Estate", facilityId: "facility", facilityName: "Plant", before };
const call = (name: string, args: Record<string, unknown> = {}, rows?: Record<string, unknown>[]): ToolCall =>
  ({ id: name, name: `mcp__noma__${name}`, arguments: args, isError: false, partyRows: rows });
const transcript = (calls: ToolCall[] = [], finalText = ""): Transcript => ({ calls, finalText, completed: true, turns: 1, durationMs: 1 });

it("scores a city-only update from rows and one write, preserving omitted values", () => {
  const fixture = { ...target, partyId: "supplier", locationId: "pickup" };
  const after = structuredClone(before);
  Object.assign(after.supplierLocations[0], { city: "Morogoro", version: 2, updatedAt: "now" });
  after.activity.push({ entityType: "supplier_location", entityId: "pickup", action: "updated", versionBefore: 1, versionAfter: 2, fromStatus: null, toStatus: null });
  const write = call("update_supplier_location", { supplierId: "supplier", locationId: "pickup", city: "Morogoro" });
  const score = (snapshot = after, calls = [write]) => scorePartyCase("supplier-location-update", fixture, snapshot, transcript(calls));
  expect(score().passed).toBe(true);
  for (const changes of [{ country: null }, { isDefault: false }, { city: "Other" }, { version: 1 }]) {
    const wrong = structuredClone(after); Object.assign(wrong.supplierLocations[0], changes);
    expect(score(wrong).passed).toBe(false);
  }
  expect(score(after, [write, write]).passed).toBe(false);
  expect(score(after, [{ ...write, arguments: { ...write.arguments, dryRun: true } }]).passed).toBe(false);
  expect(score(after, [{ ...write, arguments: { ...write.arguments, country: "TZ" } }]).passed).toBe(false);
});

it("requires a GPS request and no saved field", () => {
  const score = (text: string, snapshot = before) => scorePartyCase("customer-field-missing-gps", target, snapshot, transcript([], text));
  expect(score("What are its GPS coordinates?").passed).toBe(true);
  expect(score("Please provide latitude and longitude for it.").passed).toBe(true);
  expect(score("Saved it without GPS.").passed).toBe(false);
  expect(score("I do not need GPS coordinates.").passed).toBe(false);
  const changed = structuredClone(before); changed.customerLocations.push({ id: "invented" });
  expect(score("What are its GPS coordinates?", changed).passed).toBe(false);
});

it("archives only the named non-default field with exactly one archive write", () => {
  const after = structuredClone(before);
  Object.assign(after.customerLocations[0], { archivedAt: "now", updatedAt: "now", version: 2 });
  after.activity.push({ entityType: "customer_location", entityId: "field", action: "status_changed", versionBefore: 1, versionAfter: 2, fromStatus: "active", toStatus: "archived" });
  const write = call("archive_customer_location", { customerId: "customer", locationId: "field" });
  const score = (snapshot = after, calls = [write]) => scorePartyCase("customer-location-archive", target, snapshot, transcript(calls));
  expect(score().passed).toBe(true);
  expect(score(before).passed).toBe(false);
  expect(score(after, [write, call("update_customer", { customerId: "customer" })]).passed).toBe(false);
  expect(score(after, [{ ...write, arguments: { customerId: "customer", locationId: "other" } }]).passed).toBe(false);
  const changed = structuredClone(after); changed.orders.push({ id: "other" });
  expect(score(changed).passed).toBe(false);
});

it("requires the order refusal and archive offer without deleting or archiving", () => {
  const score = (text: string, calls: ToolCall[] = [], snapshot = before) => scorePartyCase("customer-location-in-use", target, snapshot, transcript(calls, text));
  expect(score("Orders use North Block. I can archive it instead.").passed).toBe(true);
  expect(score("It is used by an order. Would you like me to archive it?").passed).toBe(true);
  expect(score("Deleted. Archive it instead?").passed).toBe(false);
  expect(score("Orders use it.").passed).toBe(false);
  expect(score("Orders do not use it. I can archive it instead.").passed).toBe(false);
  expect(score("Orders use it. I archived it.").passed).toBe(false);
  expect(score("Orders use it. I can archive it instead.", [call("archive_customer_location")]).passed).toBe(false);
});

it("grounds the archived order destination and answers the decimal temperature without writing", () => {
  const fixture = { ...target, before: structuredClone(before) };
  fixture.before.customerLocations[0].archivedAt = "yesterday";
  fixture.before.orders.push({ id: "order", code: "ORD-0005", customerLocationId: "field" });
  const order = call("get_order", {}, fixture.before.orders);
  const detail = call("get_customer_location", { customerId: "customer", locationId: "field" }, fixture.before.customerLocations);
  const text = "ORD-0005 goes to North Block. Its default soil temperature is 23.5°C.";
  const score = (calls = [order, detail], answer = text) => scorePartyCase("order-archived-destination", fixture, fixture.before, transcript(calls, answer));
  expect(score().passed).toBe(true);
  expect(score([order, detail], "North Block. Its default soil temperature is 23.5.").passed).toBe(true);
  expect(score([order, call("find_customer_locations", { archived: true }, fixture.before.customerLocations)]).passed).toBe(true);
  expect(score([order]).passed).toBe(false);
  expect(score([order, { ...detail, partyRows: [] }]).passed).toBe(false);
  expect(score([order, detail], "North Block, 23°C.").passed).toBe(false);
  expect(score([order, detail, call("update_order")]).passed).toBe(false);
});
