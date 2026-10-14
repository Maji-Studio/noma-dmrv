import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";

const { loadDatabase, insert } = vi.hoisted(() => ({
  loadDatabase: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/db", () => {
  loadDatabase();
  return { db: { insert } };
});

it("loads the default database only when no transaction is supplied", async () => {
  const { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } = await import("./test-org");
  expect(makeTestOrgContext().organizationId).toBe(TEST_ORG_ID);
  expect(makeTestOrgContext("user-custom").userId).toBe("user-custom");
  expect(loadDatabase).not.toHaveBeenCalled();

  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const transactionInsert = vi.fn().mockReturnValue({ values });
  const transaction = { insert: transactionInsert } as unknown as DbTransaction;

  await ensureTestOrg(transaction);
  expect(loadDatabase).not.toHaveBeenCalled();
  expect(transactionInsert).toHaveBeenCalledOnce();
  expect(values).toHaveBeenCalledWith({
    id: TEST_ORG_ID,
    name: "Unit Test Fixtures",
    slug: "unit-test-fixtures",
  });
  expect(onConflictDoNothing).toHaveBeenCalledOnce();

  insert.mockReturnValue({ values });
  await ensureTestOrg();
  expect(loadDatabase).toHaveBeenCalledOnce();
  expect(insert).toHaveBeenCalledWith(transactionInsert.mock.calls[0][0]);
  expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
});
