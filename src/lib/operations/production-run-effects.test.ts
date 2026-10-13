import { expect, it, vi } from "vitest";
vi.mock("@/data-access/production-runs", () => ({
  createProductionRunInTransaction: vi.fn(), updateProductionRunInTransaction: vi.fn(), deleteProductionRunInTransaction: vi.fn(),
}));
vi.mock("@/data-access/code-generator", () => ({ withAutoCodes: vi.fn(), CODE_CONFLICT_MESSAGES: {} }));
vi.mock("@/data-access/storage-object-deletions", () => ({ processPendingStorageObjectDeletions: vi.fn() }));
import { startProductionRun, updateProductionRun, deleteProductionRun } from "./production-runs";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";

const id = "00000000-0000-4000-8000-000000000001";
it("describes the created run with its returned version and only decoded field names", () => {
  const input = startProductionRun.input.parse({
    facilityId: id, reactorId: id, startTime: new Date("2026-01-01T10:00:00Z"),
    status: "draft", cancellationReason: "private note",
  });
  const effect = startProductionRun.describe!(input, { id, version: 1 } as ProductionRunWithRelations);
  expect(effect).toEqual({
    outcome: "created", entityType: "productionRun", entityIds: [id], versionBefore: null, versionAfter: 1,
    changedFields: ["cancellationReason", "facilityId", "reactorId", "startTime", "status"],
  });
  expect(JSON.stringify(effect)).not.toContain("private note");
});
it("includes clears and zero but excludes omitted fields and preconditions", () => {
  const input = updateProductionRun.input.parse({ productionRunId: id, expectedVersion: 4, endTime: null, electricityKwh: 0 });
  expect(updateProductionRun.describe!(input, { id, version: 5 } as ProductionRunWithRelations)).toEqual({
    outcome: "updated", entityType: "productionRun", entityIds: [id], versionBefore: 4, versionAfter: 5,
    changedFields: ["electricityKwh", "endTime"],
  });
});
it("describes deletion from its input", () => {
  expect(deleteProductionRun.describe!({ productionRunId: id, expectedVersion: 5 }, undefined)).toEqual({
    outcome: "deleted", entityType: "productionRun", entityIds: [id], versionBefore: 5, versionAfter: null, changedFields: [],
  });
});
