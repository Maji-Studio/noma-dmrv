import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { emissionEntries, emissionEntryValues } from "@/db/schema";
import { recordEmissionEntryActivity } from "./emission-entry-activity";

const ctx = { organizationId: "org", userId: "user", orgRole: "owner" as const, isPlatformAdmin: false };
const entry: typeof emissionEntries.$inferSelect & { values: (typeof emissionEntryValues.$inferSelect)[] } = {
  id: "entry",
  organizationId: "org",
  creditBatchId: "batch",
  removalTemplateId: "template",
  componentId: "component",
  inputShape: [],
  lineRule: "additive",
  observationId: "observation",
  kind: "value",
  confirmedForRemovalId: null,
  occurredOn: "2026-01-01",
  note: null,
  createdBy: "user",
  version: 1,
  contentRevision: 1,
  deletedAt: null,
  sentByRemovalId: null,
  sendReservedBySubmissionId: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  values: [
    {
      id: "value",
      organizationId: "org",
      entryId: "entry",
      inputKey: "fuel",
      magnitude: "1.234567890123456789",
      unit: "L",
      massDistanceDetail: null,
    },
  ],
};

it("retains unchanged user saves with batch scope and no captured bookkeeping", async () => {
  const values = vi.fn().mockResolvedValue(undefined);
  const tx = { insert: vi.fn().mockReturnValue({ values }) } as unknown as DbTransaction;
  await recordEmissionEntryActivity(ctx, tx, "updated", entry, {
    ...entry,
    version: 2,
    contentRevision: 2,
    updatedAt: new Date("2026-01-02"),
  });
  expect(values).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      entityType: "emission_entry",
      entityId: entry.id,
      creditBatchId: entry.creditBatchId,
      action: "updated",
      source: "form",
      changedFields: [],
      changes: {},
    }),
  );
});

it("records changed persisted values by name without magnitudes or private notes", async () => {
  const values = vi.fn().mockResolvedValue(undefined);
  const tx = { insert: vi.fn().mockReturnValue({ values }) } as unknown as DbTransaction;
  await recordEmissionEntryActivity(ctx, tx, "updated", entry, {
    ...entry,
    note: "private note",
    values: [{ ...entry.values[0], id: "replacement", magnitude: "2.345678901234567891" }],
  });
  expect(values).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      changedFields: ["note", "values"],
      changes: {},
    }),
  );
  expect(JSON.stringify(values.mock.calls)).not.toContain("private note");
  expect(JSON.stringify(values.mock.calls)).not.toContain("2.345678901234567891");
});
