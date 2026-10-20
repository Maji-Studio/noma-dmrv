import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";
import { loadEmissionEntryReservations } from "@/data-access/emission-entry-contenders";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { loadRemovalEntryContext } from "./removal-entry-context";
import type { BatchEmissionContext } from "./batch-emission-context";
import type { RemovalScope } from "./removal-scope";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";

vi.mock("@/data-access/emission-entry-contenders", () => ({ loadEmissionEntryReservations: vi.fn(async () => []) }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: vi.fn(() => true) }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(emissionsEntriesEnabled).mockReturnValue(true); });
const scope = { removalId: "r1", memberBatches: [
  { id: "b1", startDate: "2026-01-01", removalTemplateId: "t1", productionEmissionsClaimedByRemovalId: "earlier" },
  { id: "b2", startDate: "2026-01-01", removalTemplateId: "t1", productionEmissionsClaimedByRemovalId: null },
], lineages: [{ application: { applicationDate: new Date("2026-02-01T00:00:00Z") } }] } as RemovalScope;
const facility = { templatesById: { t1: { observation: { id: "observation", semanticFingerprint: "fingerprint",
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
it("does no entry work with the gate off", async () => {
  vi.mocked(emissionsEntriesEnabled).mockReturnValue(false);
  expect(await loadRemovalEntryContext(makeTestOrgContext(), scope, facts(), facility)).toBeUndefined();
  expect(loadEmissionEntryReservations).not.toHaveBeenCalled();
});
it("keeps both batches' entries while excluding only the earlier production claim's automatic figure", async () => {
  const loaded = facts();
  const result = await loadRemovalEntryContext(makeTestOrgContext(), scope, loaded, facility);
  expect(result?.contributions.inputs[0].value).toEqual({ magnitude: "4", unit: "kWh" });
  expect(result?.contributions.entrySet).toHaveLength(2);
  expect(loaded.b1.automaticFigures["run-electricity"]).toBeUndefined();
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
