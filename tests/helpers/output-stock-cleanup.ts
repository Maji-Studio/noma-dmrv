import { sql } from 'drizzle-orm';
import type { db as database } from '@/db';

/** Remove only parents created by the isolated FIFO transaction fixture. */
export async function cleanupOutputStockFixture(db: typeof database, organizationId: string) {
  if (!organizationId.startsWith('e2e-fifo-org-')) throw new Error('Expected an isolated FIFO test organization');
  await db.transaction(async tx => {
    for (const table of ['application_output_allocations', 'output_stock_run_allocations', 'output_stock_allocations', 'product_ingredient_snapshots', 'bin_movements', 'transport_legs', 'biochar_storage_inventory', 'applications', 'deliveries', 'orders', 'biochar_product_source_allocations', 'biochar_products', 'production_runs', 'reactors', 'storage_locations', 'formulation_ingredients', 'formulations', 'feedstock_types', 'customers', 'facilities']) {
      await tx.execute(sql`delete from ${sql.identifier(table)} where organization_id = ${organizationId}`);
    }
    await tx.execute(sql`delete from organizations where id = ${organizationId}`);
    await tx.execute(sql`delete from users where id = ${organizationId.replace('org-', 'user-')}`);
  });
}
