import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { certificationSubmissions, creditBatchApplications, creditBatches, emissionEntries } from "@/db/schema";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
vi.mock("./activity-events", () => ({ recordActivityChange: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("./certification-status-activity", () => ({ withCertificationStatusActivity: async (_ctx: unknown, _ids: unknown,
  run: (tx: DbTransaction) => unknown, tx: DbTransaction) => run(tx) }));
import { recordActivityChange } from "./activity-events";
import { markSubmissionSubmitted } from "./submission-ledger-transitions";
it.each(["entry", "wrong-entry"])("locks member batches before stamping and checks exact frozen identity (%s)", async (stampedId) => {
  vi.mocked(recordActivityChange).mockClear();
  const events: unknown[] = [];
  const query = (rows: unknown[], table?: unknown) => {
    const q = { where: () => q, orderBy: (column: unknown) => { expect([creditBatches.id, emissionEntries.id]).toContain(column); return q; },
      for: (mode: string) => { events.push([table, mode]); return q; }, returning: () => q,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return q;
  };
  const tx = {
    select: () => ({ from: (table: unknown) => query(table === creditBatchApplications || table === emissionEntries
      ? [{ id: "entry", creditBatchId: "entry-batch", sendReservedBySubmissionId: "submission", sentByRemovalId: null }] : [{ id: "entry-batch" }, { id: "production-batch" }], table) }),
    update: (table: unknown) => ({ set: () => {
      events.push(table);
      return query(table === certificationSubmissions ? [{ id: "submission", payloadSnapshot: { frozenEntrySet: [{ entryId: "entry", contentRevision: 1 }] } }]
        : table === emissionEntries ? [{ id: stampedId, creditBatchId: "entry-batch", contentRevision: 1, sendReservedBySubmissionId: null, sentByRemovalId: "removal" }] : [{ id: "production-batch" }]);
    } }),
  } as unknown as DbTransaction;
  const result = markSubmissionSubmitted(makeTestOrgContext(), "submission", { externalId: "remote",
    productionEmissionsClaim: { removalId: "removal", creditBatchIds: ["production-batch"] } }, tx);
  if (stampedId === "entry") await expect(result).resolves.toBeUndefined();
  else await expect(result).rejects.toThrow("reservation changed");
  if (stampedId === "entry") expect(recordActivityChange).toHaveBeenCalledWith(expect.anything(), tx,
    expect.objectContaining({ entityType: "emission_entry", entityId: "entry" }),
    expect.objectContaining({ sendReservedBySubmissionId: "submission", sentByRemovalId: null }),
    expect.objectContaining({ sendReservedBySubmissionId: null, sentByRemovalId: "removal" }), { skipEmpty: true });
  else expect(recordActivityChange).not.toHaveBeenCalled();
  expect(events.slice(0, 4)).toEqual([certificationSubmissions, [creditBatches, "update"], [emissionEntries, "update"], emissionEntries]);
});
