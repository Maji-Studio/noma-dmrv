/**
 * Find supplier rows whose names collide with customer names (#104).
 *
 * The supplier picker reads only the `suppliers` table, so "customer names in
 * the supplier picker" means someone registered those organizations as
 * suppliers (the code-path audit found no form, quick-add, seed, or import
 * path that crosses the tables). This script confirms which rows those are
 * and prints enough context (code, createdAt, FK usage) to decide whether
 * each duplicate can be deleted or is already referenced by feedstock data.
 *
 * READ-ONLY — never modifies data. Point DATABASE_URL at the environment to
 * inspect (defaults to .env.local).
 *
 * Usage:
 *   pnpm tsx scripts/find-supplier-customer-overlap.ts
 *   DATABASE_URL=<staging-url> pnpm tsx scripts/find-supplier-customer-overlap.ts
 */
import { config } from "dotenv";

if (!process.env.DATABASE_URL) {
  config({ path: ".env.local" });
}

// env.ts requires a valid NODE_ENV; tsx doesn't set one
(process.env as Record<string, string | undefined>).NODE_ENV ??= "development";

async function main(): Promise<void> {
  const { db } = await import("../src/db");
  const { suppliers, customers } = await import("../src/db/schema/parties");
  const { feedstocks, feedstockDeliveries } = await import("../src/db/schema/feedstock");
  const { eq, sql } = await import("drizzle-orm");

  const normalizedName = (column: typeof suppliers.name | typeof customers.name) =>
    sql`lower(trim(${column}))`;

  const overlaps = await db
    .select({
      supplierId: suppliers.id,
      supplierCode: suppliers.code,
      supplierName: suppliers.name,
      supplierCreatedAt: suppliers.createdAt,
      customerId: customers.id,
      customerCode: customers.code,
      feedstockCount: sql<number>`(
        select count(*)::int from ${feedstocks}
        where ${feedstocks.supplierId} = ${suppliers.id}
      )`,
      deliveryCount: sql<number>`(
        select count(*)::int from ${feedstockDeliveries}
        where ${feedstockDeliveries.supplierId} = ${suppliers.id}
      )`,
    })
    .from(suppliers)
    .innerJoin(customers, eq(normalizedName(suppliers.name), normalizedName(customers.name)))
    .orderBy(suppliers.createdAt);

  if (overlaps.length === 0) {
    console.log("No supplier names collide with customer names.");
  } else {
    console.log(
      `${overlaps.length} supplier row(s) share a name with a customer:\n`,
    );
    for (const row of overlaps) {
      const usage = row.feedstockCount + row.deliveryCount;
      const referenced =
        usage > 0
          ? `REFERENCED by ${row.feedstockCount} feedstock(s) + ${row.deliveryCount} delivery(ies) — do not delete blindly`
          : "unreferenced — safe to delete after review";
      console.log(`- supplier ${row.supplierCode} "${row.supplierName}"`);
      console.log(`    supplierId: ${row.supplierId}`);
      console.log(`    createdAt:  ${row.supplierCreatedAt.toISOString()}`);
      console.log(`    matches customer ${row.customerCode} (${row.customerId})`);
      console.log(`    ${referenced}`);
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("find-supplier-customer-overlap failed:", error);
  process.exit(1);
});
