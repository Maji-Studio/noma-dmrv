import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import { createCustomer } from "@/data-access/customers";
import { customers } from "@/db/schema";
import { SafeError } from "@/lib/errors";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000425";

describe("customer code concurrency", () => {
  const createdCodes: string[] = [];

  beforeAll(() => ensureTestOrg());

  afterEach(async () => {
    for (const code of createdCodes.splice(0)) {
      await db
        .delete(customers)
        .where(
          and(
            eq(customers.organizationId, TEST_ORG_ID),
            eq(customers.code, code),
          ),
        );
    }
  });

  it("surfaces a concurrent duplicate as SafeError instead of raw Postgres", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const code = `CUS-DUP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    createdCodes.push(code);

    const create = (name: string) =>
      withAutoCode(
        ctx,
        "CUS",
        customers,
        customers.code,
        code,
        (resolvedCode) => createCustomer(ctx, { code: resolvedCode, name }),
        CODE_CONFLICT_MESSAGES.customer,
      );

    const results = await Promise.allSettled([
      create("Concurrent Customer A"),
      create("Concurrent Customer B"),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(SafeError);
    expect(reason).toMatchObject({ message: CODE_CONFLICT_MESSAGES.customer });
    expect(reason.message).not.toMatch(/duplicate key|23505|constraint/i);
  });
});
