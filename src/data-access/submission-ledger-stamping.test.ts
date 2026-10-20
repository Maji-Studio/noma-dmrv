import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { certificationSubmissions, creditBatchApplications, creditBatches, emissionEntries } from "@/db/schema";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
vi.mock("@/db", () => ({ db: {} }));
vi.mock("./certification-status-activity", () => ({ withCertificationStatusActivity: async (_ctx: unknown, _ids: unknown,
  run: (tx: DbTransaction) => unknown, tx: DbTransaction) => run(tx) }));
import { markSubmissionSubmitted } from "./submission-ledger-transitions";
it.each(["entry", "wrong-entry"])("locks member batches before stamping and checks exact frozen identity (%s)", async (stampedId) => {
  const events: unknown[] = [];
  const query = (rows: unknown[], table?: unknown) => {
    const q = { where: () => q, orderBy: (column: unknown) => { expect(column).toBe(creditBatches.id); return q; },
      for: (mode: string) => { events.push([table, mode]); return q; }, returning: () => q,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return q;
  };
  const tx = {
    select: () => ({ from: (table: unknown) => query(table === creditBatchApplications || table === emissionEntries
      ? [{ creditBatchId: "entry-batch" }] : [{ id: "entry-batch" }, { id: "production-batch" }], table) }),
    update: (table: unknown) => ({ set: () => {
      events.push(table);
      return query(table === certificationSubmissions ? [{ id: "submission", payloadSnapshot: { frozenEntrySet: [{ entryId: "entry", contentRevision: 1 }] } }]
        : table === emissionEntries ? [{ id: stampedId, contentRevision: 1 }] : [{ id: "production-batch" }]);
    } }),
  } as unknown as DbTransaction;
  const result = markSubmissionSubmitted(makeTestOrgContext(), "submission", { externalId: "remote",
    productionEmissionsClaim: { removalId: "removal", creditBatchIds: ["production-batch"] } }, tx);
  if (stampedId === "entry") await expect(result).resolves.toBeUndefined();
  else await expect(result).rejects.toThrow("reservation changed");
  expect(events.slice(0, 3)).toEqual([certificationSubmissions, [creditBatches, "update"], emissionEntries]);
});
