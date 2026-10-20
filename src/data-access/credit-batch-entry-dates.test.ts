import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { CreditBatch } from "@/db/schema/credits";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
const mocks = vi.hoisted(() => ({ tombstone: vi.fn() }));
vi.mock("./emission-entries", () => ({ tombstoneEmissionZeros: mocks.tombstone }));
vi.mock("./activity-events", () => ({ recordActivityChange: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getTemplateObservationsByIds: vi.fn() }));
import { syncCreditBatchEntryDates } from "./credit-batch-entry-dates";
it("invalidates zeros after redating a single value", async () => {
  mocks.tombstone.mockClear();
  const row = { id: "entry", kind: "value", lineRule: "single", creditBatchId: "batch", componentId: "line", occurredOn: "2026-06-01" };
  const after = { ...row, occurredOn: "2026-05-01" };
  const query = (result: object[]) => {
    const q = { from: () => q, where: () => q, orderBy: () => q, for: () => q, returning: () => q,
      then: (resolve: (rows: object[]) => unknown) => Promise.resolve(result).then(resolve) };
    return q;
  };
  const tx = { select: () => query([row]), update: () => ({ set: () => query([after]) }) } as unknown as DbTransaction;
  const ctx = makeTestOrgContext();
  await syncCreditBatchEntryDates(ctx, tx, { id: "batch", startDate: "2026-06-01", endDate: "2026-06-30" } as CreditBatch, "2026-05-01", "2026-06-30");
  expect(mocks.tombstone).toHaveBeenCalledExactlyOnceWith(ctx, tx, after);
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
