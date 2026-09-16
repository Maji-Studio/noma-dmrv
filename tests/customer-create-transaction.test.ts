/**
 * Customer + locations compound create (issue #771).
 *
 * The create form saves a customer and the locations captured alongside it in
 * one transaction. These specs pin the atomicity contract against a real
 * database: a location that fails must take the customer with it, so the form
 * never reports a failure over a committed customer.
 *
 * Requires a running database (uses DATABASE_URL from .env.test or test defaults).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  createCustomerWithLocations,
  getCustomerById,
  getCustomerLocations,
} from "@/data-access/customers";
import { customerLocations, customers, organizations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";

// Dedicated organizations so concurrent specs in other worktrees cannot collide
// on the org-unique customer name and code indexes.
const RUN_ID = randomUUID().slice(0, 8);
const ORG_ID = `org_test_customer_create_tx_${RUN_ID}`;
const OTHER_ORG_ID = `org_test_customer_create_tx_other_${RUN_ID}`;
const TEST_USER_ID = `test-user-customer-create-tx-${RUN_ID}`;

// Outside the CHECK constraint `customer_locations_gps_latitude_range`, so the
// insert fails inside the transaction the way a real bad write would.
const OUT_OF_RANGE_LATITUDE = 999;

function makeCtx(organizationId: string): OrgContext {
  return {
    userId: TEST_USER_ID,
    organizationId,
    orgRole: "owner",
    isPlatformAdmin: false,
  };
}

const ctx = makeCtx(ORG_ID);
const otherOrgCtx = makeCtx(OTHER_ORG_ID);

let customerSeq = 0;
function nextCustomer() {
  customerSeq += 1;
  return {
    code: `CUS-TX-${RUN_ID}-${customerSeq}`,
    name: `Transactional Customer ${RUN_ID} ${customerSeq}`,
  };
}

function validLocation(name: string, isDefault?: boolean) {
  return {
    name,
    country: "Tanzania",
    gpsLatitude: -3.3349,
    gpsLongitude: 37.3404,
    ...(isDefault === undefined ? {} : { isDefault }),
  };
}

async function countCustomersNamed(name: string): Promise<number> {
  const rows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.name, name));
  return rows.length;
}

describe("createCustomerWithLocations", () => {
  beforeAll(async () => {
    await db
      .insert(organizations)
      .values([
        {
          id: ORG_ID,
          name: `Customer Create Tx ${RUN_ID}`,
          slug: `customer-create-tx-${RUN_ID}`,
        },
        {
          id: OTHER_ORG_ID,
          name: `Customer Create Tx Other ${RUN_ID}`,
          slug: `customer-create-tx-other-${RUN_ID}`,
        },
      ])
      .onConflictDoNothing();
  });

  afterEach(async () => {
    const orgIds = [ORG_ID, OTHER_ORG_ID];
    await db
      .delete(customerLocations)
      .where(inArray(customerLocations.organizationId, orgIds));
    await db.delete(customers).where(inArray(customers.organizationId, orgIds));
  });

  afterAll(async () => {
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [ORG_ID, OTHER_ORG_ID]));
  });

  it("rolls the customer back when a later location fails", async () => {
    const customer = nextCustomer();

    await expect(
      createCustomerWithLocations(ctx, {
        customer,
        locations: [
          validLocation("First Field"),
          {
            ...validLocation("Second Field"),
            gpsLatitude: OUT_OF_RANGE_LATITUDE,
          },
        ],
      }),
      // The location insert is what fails, so this is a real database rollback
      // and not an early return before the customer was written.
    ).rejects.toThrow(/customer_locations/);

    expect(await countCustomersNamed(customer.name)).toBe(0);

    const orphanLocations = await db
      .select({ id: customerLocations.id })
      .from(customerLocations)
      .where(eq(customerLocations.organizationId, ORG_ID));
    expect(orphanLocations).toHaveLength(0);
  });

  it("creates a customer that has no locations", async () => {
    const customer = nextCustomer();

    const created = await createCustomerWithLocations(ctx, {
      customer,
      locations: [],
    });

    expect(created.customer.code).toBe(customer.code);
    expect(created.locations).toHaveLength(0);
    expect(await getCustomerLocations(ctx, created.customer.id)).toHaveLength(0);
  });

  it("saves two locations with exactly one default", async () => {
    const customer = nextCustomer();

    const created = await createCustomerWithLocations(ctx, {
      customer,
      locations: [
        validLocation("Lower Field"),
        validLocation("Upper Field", true),
      ],
    });

    expect(created.locations).toHaveLength(2);

    // The returned rows are what the hook seeds into the location detail cache,
    // so they must show the demotion, not the pre-demotion insert snapshot.
    const returnedDefaults = created.locations.filter(
      (location) => location.isDefault,
    );
    expect(returnedDefaults).toHaveLength(1);
    expect(returnedDefaults[0]?.name).toBe("Upper Field");

    const stored = await db
      .select({
        name: customerLocations.name,
        isDefault: customerLocations.isDefault,
      })
      .from(customerLocations)
      .where(
        and(
          eq(customerLocations.customerId, created.customer.id),
          eq(customerLocations.organizationId, ORG_ID),
        ),
      );

    expect(stored).toHaveLength(2);
    const defaults = stored.filter((location) => location.isDefault);
    expect(defaults).toHaveLength(1);
    // The explicit `isDefault` wins over the implicit first-location default.
    expect(defaults[0]?.name).toBe("Upper Field");
  });

  it("keeps the new rows invisible to another organization", async () => {
    const customer = nextCustomer();

    const created = await createCustomerWithLocations(ctx, {
      customer,
      locations: [validLocation("Scoped Field")],
    });

    await expect(
      getCustomerById(otherOrgCtx, created.customer.id),
    ).rejects.toThrow("Customer was not found.");
    await expect(
      getCustomerLocations(otherOrgCtx, created.customer.id),
    ).rejects.toThrow("Customer was not found.");

    // The owning organization still reads both rows back.
    expect((await getCustomerById(ctx, created.customer.id)).code).toBe(
      customer.code,
    );
    expect(await getCustomerLocations(ctx, created.customer.id)).toHaveLength(1);
  });
});
