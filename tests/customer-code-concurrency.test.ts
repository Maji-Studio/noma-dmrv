import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  CODE_CONFLICT_MESSAGES,
  withAutoCodes,
} from "@/data-access/code-generator";
import { createCustomerInTransaction } from "@/data-access/customer-writes";
import { customerLocations, customers } from "@/db/schema";
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
      const parents = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, TEST_ORG_ID), eq(customers.code, code)));
      for (const parent of parents) await db.delete(customerLocations).where(eq(customerLocations.customerId, parent.id));
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
      return db.transaction(tx => withAutoCodes(
        ctx, tx,
        "CUS",
        customers,
        customers.code,
        1,
        async ([resolvedCode], savepoint) => {
          if (attempt++ === 0) {
            firstAttemptsReady += 1;
            if (firstAttemptsReady === 2) releaseFirstAttempts();
            await firstAttemptBarrier;
          }
          const { customer } = await createCustomerInTransaction(ctx, savepoint, {
            code: resolvedCode,
            name,
            locations: [{ name: "Field", country: "TZ", gpsLatitude: 0, gpsLongitude: 0 }],
          });
          createdCodes.push(customer.code);
          return customer;
        },
        CODE_CONFLICT_MESSAGES.customer,
      ));
    };

    const results = await Promise.all([
      create("Concurrent Customer A"),
      create("Concurrent Customer B"),
    ]);

    expect(results.map((customer) => customer.code)).toHaveLength(2);
    expect(new Set(results.map((customer) => customer.code)).size).toBe(2);
  });
});
