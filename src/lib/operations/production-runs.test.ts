import { beforeEach, expect, it, vi } from "vitest";
import type { OperationScope } from "./runner";
const mocks = vi.hoisted(() => ({ zone: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock("@/data-access/production-run-input", () => ({ readRunFacilityTimeZone: mocks.zone }));
vi.mock("@/data-access/production-runs", () => ({ createProductionRunInTransaction: mocks.create, updateProductionRunInTransaction: mocks.update, deleteProductionRunInTransaction: vi.fn() }));
vi.mock("@/data-access/code-generator", () => ({ CODE_CONFLICT_MESSAGES: { productionRun: "duplicate" }, withAutoCodes: async (_ctx: unknown, tx: unknown, _prefix: unknown, _table: unknown, _col: unknown, _count: unknown, callback: (codes: string[], tx: unknown) => unknown) => callback(["PR-1"], tx) }));
vi.mock("@/data-access/storage-object-deletions", () => ({ processPendingStorageObjectDeletions: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
import { startProductionRun, updateProductionRun } from "./production-runs";
const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const scope = { ctx: { organizationId: id, userId: id, orgRole: "owner", isPlatformAdmin: false }, tx: {} as OperationScope["tx"], afterCommit: vi.fn() } satisfies OperationScope;
const local = { date: "2026-01-01", time: "10:00" };
beforeEach(() => { vi.clearAllMocks(); });
it("resolves create locals using the facility read through the operation transaction", async () => {
  mocks.zone.mockResolvedValue("Europe/Paris");
  const input = startProductionRun.input.parse({ facilityId: id, reactorId: id, startTime: local });
  await startProductionRun.execute(scope, input);
  expect(mocks.zone).toHaveBeenCalledWith(scope.ctx, scope.tx, input);
  expect(mocks.create.mock.calls[0][2].startTime.toISOString()).toBe("2026-01-01T09:00:00.000Z");
});
it.each([undefined, otherId])("resolves update locals with the effective facility, new facility %s", async (facilityId) => {
  mocks.zone.mockResolvedValue(facilityId ? "Africa/Nairobi" : "Europe/Paris");
  const input = updateProductionRun.input.parse({ productionRunId: id, expectedVersion: 1, facilityId, startTime: local, endTime: local });
  await updateProductionRun.execute(scope, input);
  expect(mocks.zone).toHaveBeenCalledWith(scope.ctx, scope.tx, input);
  expect(mocks.update.mock.calls[0][3].startTime.toISOString()).toBe(facilityId ? "2026-01-01T07:00:00.000Z" : "2026-01-01T09:00:00.000Z");
});

it("does not read a time zone for native Dates, offset strings or absent times", async () => {
  const input = updateProductionRun.input.parse({ productionRunId: id, expectedVersion: 1, startTime: new Date("2026-01-01T10:00:00Z"), endTime: "2026-01-01T12:00:00+02:00" });
  await updateProductionRun.execute(scope, input);
  await updateProductionRun.execute(scope, updateProductionRun.input.parse({ productionRunId: id, expectedVersion: 1 }));
  expect(mocks.zone).not.toHaveBeenCalled();
});
