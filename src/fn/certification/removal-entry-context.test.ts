import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { loadEmissionEntryReservations } from "@/data-access/emission-entry-contenders";
import { frozenEntriesForAttempt, loadRemovalEntryContext } from "./removal-entry-context";
import type { BatchEmissionContext } from "./batch-emission-context";
import type { RemovalScope } from "./removal-scope";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";

vi.mock("@/data-access/emission-entry-contenders", () => ({ loadEmissionEntryReservations: vi.fn(async () => []) }));

beforeEach(() => { vi.clearAllMocks(); });
const scope = { removalId: "r1", memberBatches: [
  { id: "b1", startDate: "2026-01-01", removalTemplateId: "t1", productionEmissionsClaimedByRemovalId: "earlier" },
  { id: "b2", startDate: "2026-01-01", removalTemplateId: "t1", productionEmissionsClaimedByRemovalId: null },
], lineages: [{ application: { applicationDate: new Date("2026-02-01T00:00:00Z") } }] } as RemovalScope;
const facility = { facilityTimezone: "UTC", templatesById: { t1: { observation: { id: "observation", semanticFingerprint: "fingerprint",
  lineSources: { electricity: { scope: "operating", origin: "reviewed", entryPolicy: "additive", automaticSource: "run-electricity" } },
  definition: { groups: [{ components: [{ id: "electricity", inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] }] }] },
  enrichment: { electricity: { electricity_use: { unit: "kWh" } } },
} } } } as unknown as FacilityCertifierFacts;
function facts(): BatchEmissionContext {
  return Object.fromEntries(["b1", "b2"].map((id) => [id, {
    previousObservations: new Map(), automaticFigures: { "run-electricity": { magnitude: "10", unit: "kWh" }, "delivery-transport": { magnitude: "20", unit: "km * tonne" } },
    contenders: [{ contenderKind: "draft", removalId: "r1", createdAt: "2026-01-01", creditBatchIds: ["b1", "b2"], window: { start: "2026-01-01", end: "2026-02-01" } }],
    entries: [{ id: `entry-${id}`, creditBatchId: id, componentId: "electricity", kind: "value", lineRule: "additive", occurredOn: "2026-02-01",
      contentRevision: 1, deletedAt: null, sentByRemovalId: null, sendReservedBySubmissionId: null, confirmedForRemovalId: null,
      counts: true, hasEvidence: true, evidenceDocumentIds: [`doc-${id}`], values: [{ inputKey: "electricity_use", magnitude: "2", unit: "kWh" }] }],
  }])) as unknown as BatchEmissionContext;
}
it("keeps both batches' entries while excluding only the earlier production claim's automatic figure", async () => {
  const loaded = facts();
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, loaded, facility);
  expect(result?.contributions.inputs[0].value).toEqual({ magnitude: "4", unit: "kWh" });
  expect(result?.contributions.entrySet).toHaveLength(2);
  expect(result?.batchFacts.b1.automaticFigures["run-electricity"]).toBeUndefined();
  expect(loaded.b1.automaticFigures["run-electricity"]?.magnitude).toBe("10");
  expect(loaded.b2.automaticFigures["run-electricity"]?.magnitude).toBe("10");
  expect(loaded.b1.automaticFigures["delivery-transport"]?.magnitude).toBe("20");
  expect(result).toMatchObject({ observationId: "observation", semanticFingerprint: "fingerprint" });
});
it("uses reservation ownership even if another draft would win the window order", async () => {
  const loaded = facts();
  loaded.b1.entries[0].sendReservedBySubmissionId = "submission";
  vi.mocked(loadEmissionEntryReservations).mockResolvedValueOnce([{ submissionId: "submission", removalId: "other", status: "draft", lockedAt: new Date(), metadata: null }]);
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, loaded, facility);
  expect(result?.contributions.selectedEntryIds).toEqual(["entry-b2"]);
  expect(loadEmissionEntryReservations).toHaveBeenCalledWith(expect.objectContaining({ organizationId: expect.any(String) }), ["submission"]);
});
it("retries with exactly the frozen set, leaving newly created entries for a later contribution", async () => {
  const loaded = facts();
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, loaded, facility, [{ entryId: "entry-b1", contentRevision: 1 }]);
  expect(result?.contributions.entrySet).toEqual([{ entryId: "entry-b1", contentRevision: 1 }]);
  expect(result?.batchFacts.b2.entries).toEqual([]);
});
it.each(["entry-b1", "missing"])("keeps reads available with a blocker for inconsistent frozen entry %s", async (entryId) => {
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, facts(), facility, [{ entryId, contentRevision: 2 }]);
  expect(result?.contributions.blockers).toContainEqual(expect.objectContaining({ code: "lineNeedsReview", message: "Emissions entries changed. Review the Removal again." }));
});
it("keeps an owned stale entry visible instead of treating it as absent", async () => {
  const loaded = facts();
  loaded.b1.entries[0].counts = false;
  loaded.b1.entries[0].reason = "Confirm this entry for the changed template line.";
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, loaded, facility);
  expect(result?.contributions.ownedEntryIds).toContain("entry-b1");
  expect(result?.contributions.selectedEntryIds).not.toContain("entry-b1");
  expect(result?.contributions.blockers).toContainEqual(expect.objectContaining({ code: "lineNeedsReview", lineRef: expect.objectContaining({ componentId: "electricity" }) }));
});
it("treats a missing reservation row as inactive", async () => {
  const loaded = facts();
  loaded.b1.entries[0].sendReservedBySubmissionId = "missing";
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, loaded, facility);
  expect(result?.contributions.selectedEntryIds).toContain("entry-b1");
  expect(result?.contributions.blockers).toEqual([]);
});
it.each(["sent", "held"] as const)("keeps earlier %s singles as omission facts when retrying a frozen set", async (state) => {
  const loaded = facts();
  loaded.b1.entries[0].lineRule = "single";
  if (state === "sent") loaded.b1.entries[0].sentByRemovalId = "earlier";
  else loaded.b1.entries[0].heldForRemovalId = "earlier";
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, loaded, facility, []);
  expect(result?.contributions.sentSingleComponentIds).toEqual(["electricity"]);
  expect(result?.contributions.entrySet).toEqual([]);
  expect(result?.contributions.ownedEntryIds).toEqual([]);
  expect(result?.batchFacts.b1.entries).toHaveLength(1);
});

it("loads edited entries after a crash before reservation and lock expiry", async () => {
  const loaded = facts();
  loaded.b1.entries[0].contentRevision = 2;
  const submission = { id: "crashed", status: "draft", lockedAt: new Date(0), metadata: null,
    payloadSnapshot: { frozenEntrySet: [{ entryId: "entry-b1", contentRevision: 1 }] } } as Parameters<typeof frozenEntriesForAttempt>[0];
  const frozen = frozenEntriesForAttempt(submission, loaded);
  expect(frozen).toBeUndefined();
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, loaded, facility, frozen);
  expect(result?.contributions.entrySet).toContainEqual({ entryId: "entry-b1", contentRevision: 2 });
});
it.each(["reserved", "possible", "confirmed"])("keeps the frozen view for %s attempts", (state) => {
  const loaded = facts();
  if (state === "reserved") loaded.b1.entries[0].sendReservedBySubmissionId = "attempt";
  const frozenEntrySet = [{ entryId: "entry-b1", contentRevision: 1 }];
  const submission = { id: "attempt", status: "draft", lockedAt: state === "live" ? new Date() : new Date(0),
    metadata: { externalMutation: state }, payloadSnapshot: { frozenEntrySet } } as Parameters<typeof frozenEntriesForAttempt>[0];
  expect(frozenEntriesForAttempt(submission, loaded)).toEqual(frozenEntrySet);
});

it("uses new entries after a crashed unreserved attempt acquires a fresh lock", async () => {
  const loaded = facts();
  const submission = { id: "attempt", status: "draft", lockedAt: new Date(), metadata: null,
    payloadSnapshot: { frozenEntrySet: [{ entryId: "entry-b1", contentRevision: 1 }] } } as Parameters<typeof frozenEntriesForAttempt>[0];
  const frozen = frozenEntriesForAttempt(submission, loaded);
  expect(frozen).toBeUndefined();
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, loaded, facility, frozen);
  expect(result?.contributions.entrySet).toHaveLength(2);
});

it.each([false, true])("preserves an empty snapshot only after reservation (%s)", async (reserved) => {
  const loaded = facts(); // Entries added after the empty snapshot was built.
  loaded.b1.productionReservationSubmissionId = reserved ? "attempt" : null;
  const submission = { id: "attempt", status: "draft", metadata: null,
    payloadSnapshot: { frozenEntrySet: [] } } as Parameters<typeof frozenEntriesForAttempt>[0];
  const frozen = frozenEntriesForAttempt(submission, loaded);
  expect(frozen).toEqual(reserved ? [] : undefined);
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, loaded, facility, frozen);
  expect(result?.contributions.entrySet).toHaveLength(reserved ? 0 : 2);
});
