import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCode,
} from "@/data-access/code-generator";
import { createCustomer } from "@/data-access/customers";
import { customers } from "@/db/schema";
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

  it("retries a concurrent auto-generated code collision", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    let firstAttemptsReady = 0;
    let releaseFirstAttempts = () => {};
    const firstAttemptBarrier = new Promise<void>((resolve) => {
      releaseFirstAttempts = resolve;
    });

    const create = (name: string) => {
      let attempt = 0;
      return withAutoCode(
        ctx,
        "CUS",
        customers,
        customers.code,
        undefined,
        async (resolvedCode) => {
          if (attempt++ === 0) {
            firstAttemptsReady += 1;
            if (firstAttemptsReady === 2) releaseFirstAttempts();
            await firstAttemptBarrier;
          }
          const customer = await createCustomer(ctx, {
            code: resolvedCode,
            name,
          });
          createdCodes.push(customer.code);
          return customer;
        },
        CODE_CONFLICT_MESSAGES.customer,
      );
    };

    const results = await Promise.all([
      create("Concurrent Customer A"),
      create("Concurrent Customer B"),
    ]);

    expect(results.map((customer) => customer.code)).toHaveLength(2);
    expect(new Set(results.map((customer) => customer.code)).size).toBe(2);
  });
});
