import { PARTY_LOCATION_CITY, PARTY_ORDER_CODE, type PartyCaseId } from "./config";
import { sameSnapshot, type PartySnapshot, type PartyTarget } from "./score-parties";
import type { Transcript } from "./transcript";

const WRITE = /^mcp__noma__(?:add|create|record|log|make|start|update|delete|archive|restore|request|confirm)_/;
const READS = new Set(["mcp__noma__get_customer_location", "mcp__noma__find_customer_locations"]);
const VERSION_INCREMENT = 1;

export function scoreLocationCriteria(caseId: PartyCaseId, target: PartyTarget, snapshot: PartySnapshot, transcript: Transcript): Record<string, boolean> | undefined {
  if (!["supplier-location-update", "customer-field-missing-gps", "customer-location-archive", "customer-location-in-use", "order-archived-destination"].includes(caseId)) return;
  const writes = transcript.calls.filter(call => WRITE.test(call.name));
  const saved = writes.filter(call => call.arguments.dryRun !== true && call.isError === false);
  const text = transcript.finalText;
  const unchanged = sameSnapshot(snapshot, target.before);
  if (caseId === "customer-field-missing-gps") return {
    nothingSaved: unchanged && saved.length === 0,
    asksForGps: /\b(?:GPS|coordinates|latitude)\b/i.test(text) && /\b(?:provide|share|send|need|what|please|could|can you)\b/i.test(text)
      && !/\b(?:not|never|don[’']t)\s+need\b/i.test(text)
      && (/\b(?:GPS|coordinates)\b/i.test(text) || /\blongitude\b/i.test(text)),
  };
  if (caseId === "customer-location-in-use") return {
    nothingSaved: unchanged && saved.length === 0,
    explainsOrders: /\borders?\b/i.test(text) && /\b(?:use[ds]?|references?|linked|associated|assigned)\b/i.test(text),
    ordersNotNegated: !/\b(?:not|never|don[’']t|doesn[’']t|no longer)\s+(?:used?|references?|linked|associated|assigned)\b/i.test(text),
    offersArchive: /\barchiv(?:e|ing)\b/i.test(text) && /\b(?:instead|can|could|would|recommend|offer)\b/i.test(text),
  };
  const supplier = caseId === "supplier-location-update";
  const key = supplier ? "supplierLocations" : "customerLocations";
  const original = target.before[key].find(row => row.id === target.locationId);
  if (caseId === "order-archived-destination") {
    const order = target.before.orders.find(row => row.code === PARTY_ORDER_CODE);
    const found = (names: string[], id: unknown) => transcript.calls.some(call => names.includes(call.name)
      && call.isError === false && call.partyRows?.some(row => row.id === id));
    const temperature = String(original?.defaultSoilTemperatureC);
    return {
      nothingWritten: unchanged && writes.length === 0,
      foundOrder: !!order && found(["mcp__noma__get_order", "mcp__noma__find_orders"], order.id),
      foundArchivedDestination: !!original?.archivedAt && order?.customerLocationId === original.id
        && transcript.calls.some(call => READS.has(call.name) && call.isError === false
          && (call.name === "mcp__noma__get_customer_location" || call.arguments.archived === true || call.arguments.archived === "true")
          && call.partyRows?.some(row => row.id === original.id)),
      answers: !!original && text.toLowerCase().includes(String(original.name).toLowerCase())
        && new RegExp(`(?<![\\d.])${temperature.replaceAll(".", "\\.")}(?!\\d|\\.\\d)`).test(text),
    };
  }
  const current = snapshot[key].find(row => row.id === target.locationId);
  const expected = structuredClone(target.before);
  const action = supplier ? "updated" : "status_changed";
  if (original && current) {
    expected[key] = expected[key].map(row => row.id !== original.id ? row : { ...row,
      ...(supplier ? { city: PARTY_LOCATION_CITY } : { archivedAt: current.archivedAt }),
      version: Number(original.version) + VERSION_INCREMENT, updatedAt: current.updatedAt,
    });
    expected.activity.push({ entityType: supplier ? "supplier_location" : "customer_location", entityId: String(original.id),
      action, versionBefore: Number(original.version), versionAfter: Number(original.version) + VERSION_INCREMENT,
      fromStatus: supplier ? null : "active", toStatus: supplier ? null : "archived" });
  }
  const write = saved[0];
  const allowed = new Set(["supplierId", "locationId", "expectedVersion", "requestKey", "dryRun", "city"]);
  return {
    onlyRequestedChanges: !!original && !!current && sameSnapshot(snapshot, expected),
    changed: supplier ? current?.city === PARTY_LOCATION_CITY : !!current?.archivedAt && original?.archivedAt === null,
    oneTargetWrite: writes.length === 1 && saved.length === 1 && write.name === `mcp__noma__${supplier ? "update_supplier_location" : "archive_customer_location"}`
      && write.arguments.locationId === target.locationId && write.arguments[supplier ? "supplierId" : "customerId"] === target.partyId,
    onlyRequestedInput: !supplier || (!!write && Object.keys(write.arguments).every(key => allowed.has(key)) && write.arguments.city === PARTY_LOCATION_CITY),
  };
}
