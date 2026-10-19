import { beforeEach, expect, it, vi } from "vitest";
import { createEmissionEntry } from "./emission-entries";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({
  tx: {}, lock: vi.fn(), latest: vi.fn(), byId: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: { transaction: (callback: (tx: object) => unknown) => callback(mocks.tx) },
}));
vi.mock("./emission-entry-lock", () => ({ lockEmissionEntryBatch: mocks.lock }));
vi.mock("./removal-template-observations", () => ({
  getLatestTemplateObservation: mocks.latest, getTemplateObservationById: mocks.byId,
}));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({
  requireEmissionsEntriesEnabled: vi.fn(),
}));
const ctx = makeTestOrgContext();
const input = {
  creditBatchId: "00000000-0000-4000-8000-000000000001",
  componentId: "energy", occurredOn: "2026-06-13",
  values: [{ inputKey: "electricity_use", quantityKind: "energy" as const, magnitude: "1", unit: "kWh" }],
};
beforeEach(() => { vi.clearAllMocks(); });

it("refuses an unpinned batch with the read model's blocker before looking up observations", async () => {
  mocks.lock.mockResolvedValue({
    batch: { removalTemplateId: null, archivedAt: null }, facility: { archivedAt: null },
  });
  await expect(createEmissionEntry(ctx, input)).rejects.toThrow(REMOVAL_TEMPLATE_BLOCKERS.unpinnedTemplate);
  expect(mocks.lock).toHaveBeenCalledWith(ctx, mocks.tx, input.creditBatchId);
  expect(mocks.latest).not.toHaveBeenCalled();
  expect(mocks.byId).not.toHaveBeenCalled();
});

it("looks up the pinned observation through the writer transaction", async () => {
  mocks.lock.mockResolvedValue({
    batch: { removalTemplateId: "template", archivedAt: null }, facility: { archivedAt: null },
  });
  mocks.latest.mockResolvedValue(null);
  await expect(createEmissionEntry(ctx, input))
    .rejects.toThrow("Read the credit batch's Removal template before adding entries.");
  expect(mocks.latest).toHaveBeenCalledExactlyOnceWith(ctx, "isometric", "template", mocks.tx);
});
