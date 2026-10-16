import { isDeepStrictEqual as same } from "node:util";
import { PARTY_CASES, PARTY_CUSTOMER_NAME, PARTY_FIELD, PARTY_PICKUP, PARTY_SUPPLIER_NAME, type PartyCaseId } from "./config";
import type { CaseScore } from "./score";
import type { Transcript } from "./transcript";

export interface PartyRow extends Record<string, unknown> {
  id: string; code: string; name: string; version: number; archivedAt: string | null;
}
export interface PartyActivity {
  entityType: string; entityId: string; action: string;
  versionBefore: number | null; versionAfter: number | null;
  fromStatus: string | null; toStatus: string | null;
}
export interface PartySnapshot {
  suppliers: PartyRow[]; customers: PartyRow[];
  supplierLocations: Record<string, unknown>[]; customerLocations: Record<string, unknown>[];
  supplierDistances: Record<string, unknown>[]; customerDistances: Record<string, unknown>[];
  feedstocks: Record<string, unknown>[]; orders: Record<string, unknown>[];
  activity: PartyActivity[];
}
export interface PartyTarget {
  partyId: string; name: string; facilityId: string; facilityName: string; before: PartySnapshot;
}
const VERSION_INCREMENT = 1;
const INITIAL_VERSION = 1;
const PARTY_WRITE = /^mcp__noma__(?:create|update|delete|archive|restore)_(?:supplier|customer)(?:_|$)/;
const SENTENCE_BOUNDARY = /(?<=[!?\n])|(?<=\.)(?!\d)/;
const event = (entityType: string, entityId: string, action: string, versionBefore: number | null,
  versionAfter: number, fromStatus: string | null = null, toStatus: string | null = null): PartyActivity =>
  ({ entityType, entityId, action, versionBefore, versionAfter, fromStatus, toStatus });
const activityKey = (row: PartyActivity) => JSON.stringify([
  row.entityType, row.entityId, row.action, row.versionBefore, row.versionAfter, row.fromStatus, row.toStatus,
]);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
function conflictingSupplier(call: Transcript["calls"][number], partyId: string): boolean {
  const result = call.partyResult;
  // MCP's conflict code represents HTTP 409; issues retain the published metadata.
  return call.name === "mcp__noma__create_supplier" && call.isError === true && result?.code === "conflict"
    && Array.isArray(result.issues) && result.issues.some(issue => object(object(issue).meta).supplierId === partyId);
}
function sameSnapshot(left: PartySnapshot, right: PartySnapshot): boolean {
  const sorted = (value: PartySnapshot) => Object.fromEntries(Object.entries(value).map(([key, rows]) =>
    [key, key === "activity" ? [...value.activity].sort((a, b) => activityKey(a).localeCompare(activityKey(b)))
      : [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))]));
  return same(sorted(left), sorted(right));
}
const normalized = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const inTanzania = (country: unknown) => ["tz", "tanzania", "united republic of tanzania"].includes(normalized(country));
function explainsSupplierArchive(text: string, target: PartyTarget): boolean {
  const code = target.before.suppliers.find(row => row.id === target.partyId)?.code;
  return text.split(SENTENCE_BOUNDARY).some(sentence => {
    const namesSupplier = /\bsupplier\b/i.test(sentence) || [target.name, code].some(value =>
      value && normalized(sentence).includes(normalized(value)));
    if (!namesSupplier || sentence.endsWith("?") || /\b(?:does not|doesn['’]t|do not|don['’]t)\s+exist\b/i.test(sentence) || /\b(?:if|whether|might|may|perhaps|confirm (?:its|the) status)\b/i.test(sentence)) return false;
    // A contrast can negate an active lookup while affirming the archived match.
    return sentence.split(/\bbut\b/i).some(clause => /\barchived\b/i.test(clause)
      && !/\b(?:not|never|isn['’]t|aren['’]t|wasn['’]t|no longer|no)\s+(?:(?:currently|presently|actually|already|been|be|being|appear|appears|seem|seems|to|marked|as|recorded|an?|matching)\s+)*archived\b/i.test(clause)
      && !/\b(?:does not|doesn['’]t|do not|don['’]t)\s+exist\b/i.test(clause));
  });
}
const foundTarget = (call: Transcript["calls"][number], partyId: string) => call.isError === false
  && call.partyRows?.some(row => row.id === partyId) === true;

function restoredSnapshot(kind: "supplier" | "customer", target: PartyTarget, snapshot: PartySnapshot): PartySnapshot {
  const key = kind === "supplier" ? "suppliers" : "customers";
  const original = target.before[key].find(row => row.id === target.partyId);
  const current = snapshot[key].find(row => row.id === target.partyId);
  const expected = structuredClone(target.before);
  expected[key] = expected[key].map(row => row.id === target.partyId ? { ...row,
    version: row.version + VERSION_INCREMENT, archivedAt: null, updatedAt: current?.updatedAt,
  } : row);
  if (original) expected.activity.push(event(kind, target.partyId, "status_changed",
    original.version, original.version + VERSION_INCREMENT, "archived", "active"));
  return expected;
}
const restoresTarget = (call: Transcript["calls"][number], kind: "supplier" | "customer", partyId: string) =>
  call.name === `mcp__noma__restore_${kind}` && call.arguments[`${kind}Id`] === partyId
    && call.arguments.dryRun !== true && call.isError === false;

export function scorePartyCase(caseId: PartyCaseId, target: PartyTarget, snapshot: PartySnapshot, transcript: Transcript): CaseScore {
  const definition = PARTY_CASES.find(({ id }) => id === caseId)!;
  const before = target.before;
  const criteria: Record<string, boolean> = { completed: transcript.completed, budget: transcript.calls.length <= definition.budget };
  if (caseId === "supplier-with-pickup" || caseId === "customer-and-field") {
    const supplier = caseId === "supplier-with-pickup";
    const key = supplier ? "suppliers" : "customers";
    const locationKey = supplier ? "supplierLocations" : "customerLocations";
    const distanceKey = supplier ? "supplierDistances" : "customerDistances";
    const parentKey = supplier ? "supplierId" : "customerId";
    const added = snapshot[key].filter(row => !before[key].some(({ id }) => row.id === id));
    const row = added[0];
    const locations = snapshot[locationKey].filter(location => location[parentKey] === row?.id);
    const location = locations[0];
    const position = supplier ? PARTY_PICKUP : PARTY_FIELD;
    const expected = structuredClone(before);
    if (row) expected[key].push(row);
    expected[locationKey].push(...locations);
    const pairs = snapshot[distanceKey].filter(pair => pair.locationId === location?.id);
    expected[distanceKey].push(...pairs);
    const kind = supplier ? "supplier" : "customer";
    if (row) expected.activity.push(event(kind, row.id, "created", null, row.version));
    for (const site of locations) {
      expected.activity.push(event(`${kind}_location`, String(site.id), "created", null, INITIAL_VERSION));
      if (Number(site.version) > INITIAL_VERSION) expected.activity.push(
        event(`${kind}_location`, String(site.id), "updated", INITIAL_VERSION, Number(site.version)));
    }
    Object.assign(criteria, {
      oneParty: added.length === 1 && normalized(row?.name) === normalized(supplier ? PARTY_SUPPLIER_NAME : PARTY_CUSTOMER_NAME) && row?.archivedAt === null,
      oneLocation: locations.length === 1 && location?.gpsLatitude === position.gpsLatitude && location?.gpsLongitude === position.gpsLongitude && inTanzania(location?.country),
      locationFacts: supplier ? location?.isDefault === true : normalized(location?.name) === normalized(PARTY_FIELD.name),
      onlyRequestedChanges: sameSnapshot(snapshot, expected),
    });
    if (supplier) criteria.manualOneWayPair = pairs.length === 1 && pairs[0].facilityId === target.facilityId
      && pairs[0].distanceKm === PARTY_PICKUP.distanceKm && pairs[0].distanceSource === "manual";
  } else if (caseId === "supplier-restore" || caseId === "customer-restore") {
    const supplier = caseId === "supplier-restore";
    const key = supplier ? "suppliers" : "customers";
    const original = before[key].find(row => row.id === target.partyId);
    const current = snapshot[key].find(row => row.id === target.partyId);
    const kind = supplier ? "supplier" : "customer";
    const expected = restoredSnapshot(kind, target, snapshot);
    const restoredAt = transcript.calls.findIndex(call => restoresTarget(call, kind, target.partyId));
    Object.assign(criteria, {
      restored: !!original?.archivedAt && current?.archivedAt === null,
      onlyTargetChanged: sameSnapshot(snapshot, expected),
      archivedLookup: restoredAt >= 0 && transcript.calls.slice(0, restoredAt).some(call => call.name === `mcp__noma__find_${key}`
        && (call.arguments.archived === true || call.arguments.archived === "true") && foundTarget(call, target.partyId)),
    });
  } else {
    if (caseId === "supplier-already-exists-archived") {
      const original = before.suppliers.find(row => row.id === target.partyId);
      const writes = transcript.calls.filter(call => PARTY_WRITE.test(call.name) && call.arguments.dryRun !== true && call.isError === false);
      const restored = !!original?.archivedAt && writes.length === 1 && restoresTarget(writes[0], "supplier", target.partyId)
        && sameSnapshot(snapshot, restoredSnapshot("supplier", target, snapshot));
      criteria.onlyAllowedChanges = sameSnapshot(snapshot, before) || restored;
    } else criteria.nothingSaved = sameSnapshot(snapshot, before);
    if (caseId === "supplier-archived-intake") criteria.explainsArchive = explainsSupplierArchive(transcript.finalText, target);
    else {
      criteria.foundExisting = transcript.calls.some(call => (call.name === "mcp__noma__find_suppliers" && foundTarget(call, target.partyId))
        || (caseId === "supplier-already-exists-archived" && conflictingSupplier(call, target.partyId)));
      if (caseId === "supplier-already-exists-archived") criteria.explainsExistingArchive = explainsSupplierArchive(transcript.finalText, target);
    }
  }
  return { caseId, expectation: definition.text(target), budget: definition.budget, passed: Object.values(criteria).every(Boolean), criteria,
    toolCalls: transcript.calls.length, turns: transcript.turns, durationMs: transcript.durationMs };
}
