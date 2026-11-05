import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { CreditBatch } from "@/db/schema/credits";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
const mocks = vi.hoisted(() => ({ tombstone: vi.fn(), holds: vi.fn() }));
vi.mock("./emission-entries", () => ({ tombstoneEmissionZeros: mocks.tombstone }));
vi.mock("./emission-entry-holds", () => ({ loadEmissionEntryHolds: mocks.holds }));
vi.mock("./activity-events", () => ({ recordActivityChange: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getTemplateObservationsByIds: vi.fn() }));
import { syncCreditBatchEntryDates } from "./credit-batch-entry-dates";
it.each([null, "holding-removal"])("invalidates zeros after redating a single value with explicit hold %s", async (holdingRemovalId) => {
  mocks.tombstone.mockClear();
  mocks.holds.mockResolvedValue(new Map([["entry", holdingRemovalId]]));
  const row = { id: "entry", kind: "value", lineRule: "single", creditBatchId: "batch", componentId: "line", occurredOn: "2026-06-01",
    sentByRemovalId: null, replacesEntryId: holdingRemovalId ? "sent-original" : null };
  const after = { ...row, occurredOn: "2026-05-01" };
  const query = (result: object[]) => {
    const q = { from: () => q, where: () => q, orderBy: () => q, for: () => q, returning: () => q,
      then: (resolve: (rows: object[]) => unknown) => Promise.resolve(result).then(resolve) };
    return q;
  };
  const tx = { select: () => query([row]), update: () => ({ set: () => query([after]) }) } as unknown as DbTransaction;
  const ctx = makeTestOrgContext();
  await syncCreditBatchEntryDates(ctx, tx, { id: "batch", startDate: "2026-06-01", endDate: "2026-06-30" } as CreditBatch, "2026-05-01", "2026-06-30");
  expect(mocks.holds).toHaveBeenLastCalledWith(ctx, [after], tx);
  expect(mocks.tombstone).toHaveBeenCalledExactlyOnceWith(ctx, tx, { ...after, holdingRemovalId });
});

it("redates an additive zero when narrowing the start without treating it as a manual dated value", async () => {
  const row = { id: "zero", kind: "zero", lineRule: "additive", creditBatchId: "batch", occurredOn: "2026-06-01" };
  const query = (rows: object[]) => {
    const q = { from: () => q, where: () => q, orderBy: () => q, for: () => q, returning: () => q,
      then: (resolve: (rows: object[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return q;
  };
  const set = vi.fn(() => query([{ ...row, occurredOn: "2026-06-02" }]));
  const tx = { select: () => query([row]), update: () => ({ set }) } as unknown as DbTransaction;
  await syncCreditBatchEntryDates(makeTestOrgContext(), tx, { id: "batch", startDate: "2026-06-01", endDate: "2026-06-30" } as CreditBatch, "2026-06-02", "2026-06-30");
  expect(set).toHaveBeenCalledWith(expect.objectContaining({ occurredOn: "2026-06-02" }));
});
