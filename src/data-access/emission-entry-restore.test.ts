import { beforeEach, expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import type { emissionEntries } from "@/db/schema";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

const mocks = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn(), latest: vi.fn(), previous: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock("./batch-emission-automatic-figures", () => ({ loadBatchAutomaticFigures: vi.fn() }));
vi.mock("./emission-entry-facts", () => ({ loadBatchEmissionEntryFacts: vi.fn() }));
vi.mock("./removal-template-observations", () => ({ getLatestTemplateObservation: mocks.latest, getTemplateObservationById: mocks.previous }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ requireEmissionsEntriesEnabled: vi.fn() }));
import { restoreEmissionEntry } from "./emission-entries";

const ctx = makeTestOrgContext();
const id = "00000000-0000-4000-8000-000000000001";
const input = { id, expectedVersion: 2 };
const shape = [{ key: "electricity_use", type: "monitored" as const, quantityKind: "energy" as const }];
const entry: typeof emissionEntries.$inferSelect = {
  id, organizationId: ctx.organizationId, creditBatchId: "batch", removalTemplateId: "template",
  componentId: "line", inputShape: shape, lineRule: "additive", observationId: "observation",
  kind: "value", confirmedForRemovalId: null, occurredOn: "2026-01-01", note: "private note", createdBy: ctx.userId,
  version: 2, contentRevision: 2, deletedAt: new Date("2026-01-02"), sentByRemovalId: null,
  sendReservedBySubmissionId: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"),
};
const saved = { ...entry, deletedAt: null, version: 3, contentRevision: 3 };
const values = [{ id: "value", organizationId: ctx.organizationId, entryId: id,
  inputKey: "electricity_use", magnitude: "1", unit: "kWh", massDistanceDetail: null }];
const observation: EntryObservation & { id: string } = { id: "observation", externalTemplateId: "template",
  definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "G", description: "", components: [
    { id: "line", displayName: "Line", description: null, blueprintKey: "grid_electricity_use", inputs: shape },
  ] }] }, enrichment: { line: { electricity_use: { unit: "kWh" } } },
  lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
};
function query(rows: unknown[]) {
  const builder = { from: () => builder, where: () => builder, for: () => builder,
    orderBy: () => builder, returning: () => builder,
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  return builder;
}
const select = vi.fn();
const update = vi.fn();
const activity = vi.fn();
let lockedEntry: typeof entry;
beforeEach(() => {
  vi.resetAllMocks();
  lockedEntry = { ...entry };
  const batch = { id: "batch", facilityId: "facility", removalTemplateId: "template", archivedAt: null, startDate: "2026-01-01" };
  const rows = [[batch], [{ archivedAt: null, timezone: "UTC" }], [batch], () => [lockedEntry],
    values, [], [saved], values, [{ count: 1 }]];
  select.mockImplementation(() => {
    const result = rows.shift();
    if (!result) throw new Error("Unexpected query");
    return query(typeof result === "function" ? result() : result);
  });
  update.mockReturnValue({ set: () => query([saved]) });
  const tx = { select, update, insert: () => ({ values: activity }) } as unknown as DbTransaction;
  mocks.transaction.mockImplementation((callback: (tx: DbTransaction) => unknown) => callback(tx));
  mocks.select.mockReturnValue(query([entry]));
  mocks.latest.mockResolvedValue(observation);
  mocks.previous.mockResolvedValue(observation);
});

it("runs restore with locked before/after snapshots and keeps original value rows", async () => {
  expect(await restoreEmissionEntry(ctx, input)).toMatchObject({ ...saved, values, documentCount: 1 });
  expect(activity).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: "updated",
    creditBatchId: "batch", changedFields: ["deletedAt"],
    changes: { deletedAt: { from: entry.deletedAt!.toISOString(), to: null } } }));
  expect(JSON.stringify(activity.mock.calls)).not.toContain("private note");
});

it.each(["reserved", "sent", "stale", "active", "owned-zero"] as const)("refuses %s before making any changes", async state => {
  if (state === "reserved") lockedEntry.sendReservedBySubmissionId = "submission";
  if (state === "sent") lockedEntry.sentByRemovalId = "removal";
  if (state === "stale") lockedEntry.version++;
  if (state === "active") lockedEntry.deletedAt = null;
  if (state === "owned-zero") lockedEntry.confirmedForRemovalId = "removal";
  await expect(restoreEmissionEntry(ctx, input)).rejects.toThrow();
  expect(update).not.toHaveBeenCalled();
  expect(activity).not.toHaveBeenCalled();
});

it("refuses missing organization scope before discovery", async () => {
  await expect(restoreEmissionEntry({ ...ctx, organizationId: "" }, input)).rejects.toThrow("Unauthorized");
  expect(mocks.select).not.toHaveBeenCalled();
});
