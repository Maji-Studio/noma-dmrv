import { expect, it } from "vitest";
import { eq, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DbTransaction } from "@/db";
import { creditBatchApplications, creditBatches, emissionEntries } from "@/db/schema";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { lockBatchesThenEntries } from "./emission-entry-release-locks";

it.each([true, false])("locks member and entry batches in id order before entries (extra claim=%s)", async (extraClaim) => {
  const ctx = makeTestOrgContext();
  const locks: unknown[][] = [];
  const filters: { table: unknown; params: unknown[] }[] = [];
  const tx = { select: () => ({ from: (table: unknown) => {
    let order: unknown;
    const rows = table === creditBatchApplications ? [{ creditBatchId: "member-only" }]
      : table === emissionEntries ? [{ creditBatchId: "entry-only" }, { creditBatchId: "member-only" }] : [];
    const query = {
      where: (filter: SQL) => { filters.push({ table, params: new PgDialect().sqlToQuery(filter).params }); return query; },
      orderBy: (column: unknown) => { order = column; return query; },
      for: (mode: string) => { locks.push([table, order, mode]); return query; },
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return query;
  } }) } as unknown as DbTransaction;
  await lockBatchesThenEntries(ctx, tx, { removalId: "removal", entryFilter: eq(emissionEntries.sendReservedBySubmissionId, "attempt"),
    extraBatchFilter: extraClaim ? eq(creditBatches.productionEmissionsClaimReservedBySubmissionId, "attempt") : undefined });
  expect(locks).toEqual([[creditBatches, creditBatches.id, "update"], [emissionEntries, emissionEntries.id, "update"]]);
  expect(filters.every(({ params }) => params.includes(ctx.organizationId))).toBe(true);
  expect(filters.find(({ table }) => table === creditBatchApplications)?.params).toContain("removal");
  expect(filters.filter(({ table }) => table === emissionEntries).every(({ params }) => params.includes("attempt"))).toBe(true);
  const batchParams = filters.find(({ table }) => table === creditBatches)!.params;
  expect(batchParams.filter((id) => id === "member-only")).toHaveLength(1);
  expect(batchParams).toContain("entry-only");
  expect(batchParams.includes("attempt")).toBe(extraClaim);
});
