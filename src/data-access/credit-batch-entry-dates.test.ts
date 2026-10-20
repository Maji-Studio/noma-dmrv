import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { CreditBatch } from "@/db/schema/credits";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
const mocks = vi.hoisted(() => ({ tombstone: vi.fn(), enabled: true }));
vi.mock("./emission-entries", () => ({ tombstoneEmissionZeros: mocks.tombstone }));
vi.mock("./activity-events", () => ({ recordActivityChange: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getTemplateObservationsByIds: vi.fn() }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: () => mocks.enabled }));
import { syncCreditBatchEntryDates } from "./credit-batch-entry-dates";
it.each([true, false])("invalidates zeros after redating a single value only when enabled (%s)", async (enabled) => {
  mocks.tombstone.mockClear(); mocks.enabled = enabled;
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
  if (enabled) expect(mocks.tombstone).toHaveBeenCalledExactlyOnceWith(ctx, tx, after);
  else expect(mocks.tombstone).not.toHaveBeenCalled();
});
