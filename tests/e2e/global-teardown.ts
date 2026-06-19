/**
 * Playwright Global Teardown
 *
 * Sweeps ALL E2E test data from the database after the entire test suite finishes.
 * This is the safety net that catches anything the per-test fixture cleanup missed,
 * including:
 * - Entities created via the browser UI (not tracked by fixtures)
 * - Orphaned data from tests that failed mid-cleanup
 * - Accumulated data from interrupted test runs
 *
 * Identification strategy:
 * - Code columns: LIKE 'E2E-%'
 * - Name columns: LIKE 'E2E %' OR LIKE 'UI %' OR LIKE 'Chain %'
 * - User IDs: LIKE 'e2e-%'
 * - User emails: LIKE '%@e2e.local'
 * - Project names: LIKE 'E2E Test Project%'
 */
import { Pool } from "pg";

export default async function globalTeardown() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/app_template_test";

  const url = new URL(databaseUrl);
  const dbName = url.pathname.replace(/^\//, "");
  const hostname = url.hostname;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
  const isTestDb = dbName.includes("_test") || dbName.includes("_e2e");
  if (!isLocalHost && !isTestDb) {
    console.error(
      `[global-teardown] ABORTED: database "${dbName}" on host "${hostname}" does not look like a test database. ` +
      `Host must be localhost/127.0.0.1, or DB name must contain "_test" or "_e2e".`
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log("\n[global-teardown] Sweeping E2E test data...");

    // Use a single connection for the entire cleanup to avoid pool exhaustion
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // ─── Junction tables first (no FKs pointing to them) ───

      // credit_batch_production_runs
      await client.query(`
        DELETE FROM credit_batch_production_runs
        WHERE credit_batch_id IN (
          SELECT id FROM credit_batches WHERE code LIKE 'E2E-%'
        )
      `);

      // credit_batch_applications (legacy)
      await client.query(`
        DELETE FROM credit_batch_applications
        WHERE credit_batch_id IN (
          SELECT id FROM credit_batches WHERE code LIKE 'E2E-%'
        )
      `);

      // production_run_feedstocks
      await client.query(`
        DELETE FROM production_run_feedstocks
        WHERE production_run_id IN (
          SELECT id FROM production_runs
          WHERE code LIKE 'E2E-%'
             OR facility_id IN (
                  SELECT id FROM facilities
                  WHERE code LIKE 'E2E-%'
                     OR name LIKE 'UI %'
                     OR name LIKE 'Chain %'
                     OR name LIKE 'Duplicate Test %'
                )
             OR reactor_id IN (
                  SELECT id FROM reactors
                  WHERE code LIKE 'E2E-%'
                     OR identifier LIKE 'UI %'
                     OR identifier LIKE 'Chain %'
                )
             OR feedstock_storage_location_id IN (
                  SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
                )
             OR biochar_storage_location_id IN (
                  SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
                )
        )
        OR feedstock_id IN (
          SELECT id FROM feedstocks WHERE code LIKE 'E2E-%'
        )
      `);

      // ─── Leaf entities (nothing references them) ───

      // samples (references production_runs)
      await client.query(`
        DELETE FROM samples
        WHERE sample_code LIKE 'E2E-%'
           OR production_run_id IN (
                SELECT id FROM production_runs
                WHERE code LIKE 'E2E-%'
                   OR facility_id IN (
                        SELECT id FROM facilities
                        WHERE code LIKE 'E2E-%'
                           OR name LIKE 'UI %'
                           OR name LIKE 'Chain %'
                           OR name LIKE 'Duplicate Test %'
                      )
                   OR reactor_id IN (
                        SELECT id FROM reactors
                        WHERE code LIKE 'E2E-%'
                           OR identifier LIKE 'UI %'
                           OR identifier LIKE 'Chain %'
                      )
                   OR feedstock_storage_location_id IN (
                        SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
                      )
                   OR biochar_storage_location_id IN (
                        SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
                      )
              )
      `);

      // production_samples (references production_runs)
      await client.query(`
        DELETE FROM production_samples
        WHERE production_run_id IN (
          SELECT id FROM production_runs
          WHERE code LIKE 'E2E-%'
             OR facility_id IN (
                  SELECT id FROM facilities
                  WHERE code LIKE 'E2E-%'
                     OR name LIKE 'UI %'
                     OR name LIKE 'Chain %'
                     OR name LIKE 'Duplicate Test %'
                )
             OR reactor_id IN (
                  SELECT id FROM reactors
                  WHERE code LIKE 'E2E-%'
                     OR identifier LIKE 'UI %'
                     OR identifier LIKE 'Chain %'
                )
             OR feedstock_storage_location_id IN (
                  SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
                )
             OR biochar_storage_location_id IN (
                  SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
                )
        )
      `);

      // ─── Certifier sync events + submissions for E2E credit batches ───
      // No FK constraint to credit_batches (entity_id / local_entity_id are
      // plain uuid), but stale rows would accumulate across runs. Sweep
      // before the credit_batches delete so the local_entity_id values can
      // still be resolved.
      await client.query(`
        DELETE FROM certifier_sync_events
        WHERE entity_type = 'creditBatch'
          AND entity_id IN (
            SELECT id FROM credit_batches
            WHERE code LIKE 'E2E-%'
               OR facility_id IN (
                    SELECT id FROM facilities
                    WHERE code LIKE 'E2E-%'
                       OR name LIKE 'UI %'
                       OR name LIKE 'Chain %'
                       OR name LIKE 'Duplicate Test %'
                  )
          )
      `);
      await client.query(`
        DELETE FROM certification_submissions
        WHERE local_entity_type = 'creditBatch'
          AND local_entity_id IN (
            SELECT id FROM credit_batches
            WHERE code LIKE 'E2E-%'
               OR facility_id IN (
                    SELECT id FROM facilities
                    WHERE code LIKE 'E2E-%'
                       OR name LIKE 'UI %'
                       OR name LIKE 'Chain %'
                       OR name LIKE 'Duplicate Test %'
                  )
          )
      `);

      // ─── Credit batches ───
      // Delete by code prefix AND by facility reference (UI-created batches have auto-generated codes)
      await client.query(`
        DELETE FROM credit_batch_production_runs
        WHERE credit_batch_id IN (
          SELECT id FROM credit_batches
          WHERE facility_id IN (
            SELECT id FROM facilities
            WHERE code LIKE 'E2E-%'
               OR name LIKE 'UI %'
               OR name LIKE 'Chain %'
               OR name LIKE 'Duplicate Test %'
          )
        )
      `);
      await client.query(`
        DELETE FROM credit_batch_applications
        WHERE credit_batch_id IN (
          SELECT id FROM credit_batches
          WHERE facility_id IN (
            SELECT id FROM facilities
            WHERE code LIKE 'E2E-%'
               OR name LIKE 'UI %'
               OR name LIKE 'Chain %'
               OR name LIKE 'Duplicate Test %'
          )
        )
      `);
      await client.query(`
        DELETE FROM credit_batches
        WHERE code LIKE 'E2E-%'
           OR facility_id IN (
                SELECT id FROM facilities
                WHERE code LIKE 'E2E-%'
                   OR name LIKE 'UI %'
                   OR name LIKE 'Chain %'
                   OR name LIKE 'Duplicate Test %'
              )
      `);

      // ─── Applications ───
      await client.query(`
        DELETE FROM applications
        WHERE code LIKE 'E2E-%'
           OR delivery_id IN (
                SELECT id FROM deliveries
                WHERE facility_id IN (
                  SELECT id FROM facilities
                  WHERE code LIKE 'E2E-%'
                     OR name LIKE 'UI %'
                     OR name LIKE 'Chain %'
                     OR name LIKE 'Duplicate Test %'
                )
              )
      `);

      // ─── Deliveries ───
      // Also catch UI-created deliveries (auto-generated codes) via facility or order reference
      await client.query(`
        DELETE FROM deliveries
        WHERE code LIKE 'E2E-%'
           OR facility_id IN (
                SELECT id FROM facilities
                WHERE code LIKE 'E2E-%'
                   OR name LIKE 'UI %'
                   OR name LIKE 'Chain %'
                   OR name LIKE 'Duplicate Test %'
              )
           OR order_id IN (
                SELECT id FROM orders
                WHERE code LIKE 'E2E-%'
                   OR facility_id IN (
                        SELECT id FROM facilities
                        WHERE code LIKE 'E2E-%'
                           OR name LIKE 'UI %'
                           OR name LIKE 'Chain %'
                           OR name LIKE 'Duplicate Test %'
                      )
              )
      `);

      // ─── Orders ───
      // Also catch UI-created orders (auto-generated codes) that reference E2E biochar products
      await client.query(`
        DELETE FROM orders
        WHERE code LIKE 'E2E-%'
           OR biochar_product_id IN (SELECT id FROM biochar_products WHERE code LIKE 'E2E-%')
           OR facility_id IN (
                SELECT id FROM facilities
                WHERE code LIKE 'E2E-%'
                   OR name LIKE 'UI %'
                   OR name LIKE 'Chain %'
                   OR name LIKE 'Duplicate Test %'
              )
      `);

      // ─── Biochar storage inventory (FK: biochar_product_id, storage_location_id) ───
      await client.query(`
        DELETE FROM biochar_storage_inventory
        WHERE biochar_product_id IN (SELECT id FROM biochar_products WHERE code LIKE 'E2E-%')
           OR storage_location_id IN (SELECT id FROM storage_locations WHERE code LIKE 'E2E-%')
      `);

      // ─── Biochar products ───
      await client.query(`DELETE FROM biochar_products WHERE code LIKE 'E2E-%'`);

      // ─── Production-run readings documents and telemetry ───
      await client.query(`
        DELETE FROM documents
        WHERE entity_type = 'production_run'
          AND entity_id IN (
            SELECT id FROM production_runs
            WHERE code LIKE 'E2E-%'
               OR facility_id IN (
                    SELECT id FROM facilities
                    WHERE code LIKE 'E2E-%'
                       OR name LIKE 'UI %'
                       OR name LIKE 'Chain %'
                       OR name LIKE 'Duplicate Test %'
                  )
               OR reactor_id IN (
                    SELECT id FROM reactors
                    WHERE code LIKE 'E2E-%'
                       OR identifier LIKE 'UI %'
                       OR identifier LIKE 'Chain %'
                  )
               OR feedstock_storage_location_id IN (
                    SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
                  )
               OR biochar_storage_location_id IN (
                    SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
                  )
          )
      `);
      await client.query(`
        DELETE FROM production_run_readings
        WHERE production_run_id IN (
          SELECT id FROM production_runs
          WHERE code LIKE 'E2E-%'
             OR facility_id IN (
                  SELECT id FROM facilities
                  WHERE code LIKE 'E2E-%'
                     OR name LIKE 'UI %'
                     OR name LIKE 'Chain %'
                     OR name LIKE 'Duplicate Test %'
                )
             OR reactor_id IN (
                  SELECT id FROM reactors
                  WHERE code LIKE 'E2E-%'
                     OR identifier LIKE 'UI %'
                     OR identifier LIKE 'Chain %'
                )
             OR feedstock_storage_location_id IN (
                  SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
                )
             OR biochar_storage_location_id IN (
                  SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
                )
        )
      `);

      // ─── Production runs ───
      await client.query(`DELETE FROM production_runs WHERE code LIKE 'E2E-%'`);
      await client.query(`
        DELETE FROM production_runs
        WHERE facility_id IN (
          SELECT id FROM facilities
          WHERE code LIKE 'E2E-%'
             OR name LIKE 'UI %'
             OR name LIKE 'Chain %'
             OR name LIKE 'Duplicate Test %'
        )
        OR reactor_id IN (
          SELECT id FROM reactors
          WHERE code LIKE 'E2E-%'
             OR identifier LIKE 'UI %'
             OR identifier LIKE 'Chain %'
        )
        OR feedstock_storage_location_id IN (
          SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
        )
        OR biochar_storage_location_id IN (
          SELECT id FROM storage_locations WHERE code LIKE 'E2E-%'
        )
      `);

      // ─── Feedstocks ───
      await client.query(`
        DELETE FROM feedstocks
        WHERE code LIKE 'E2E-%'
           OR facility_id IN (
                SELECT id FROM facilities
                WHERE code LIKE 'E2E-%'
                   OR name LIKE 'UI %'
                   OR name LIKE 'Chain %'
                   OR name LIKE 'Duplicate Test %'
              )
           OR feedstock_delivery_id IN (
                SELECT id FROM feedstock_deliveries
                WHERE code LIKE 'E2E-%'
                   OR facility_id IN (
                        SELECT id FROM facilities
                        WHERE code LIKE 'E2E-%'
                           OR name LIKE 'UI %'
                           OR name LIKE 'Chain %'
                           OR name LIKE 'Duplicate Test %'
                      )
              )
      `);

      // ─── Feedstock deliveries ───
      await client.query(`
        DELETE FROM feedstock_deliveries
        WHERE code LIKE 'E2E-%'
           OR facility_id IN (
                SELECT id FROM facilities
                WHERE code LIKE 'E2E-%'
                   OR name LIKE 'UI %'
                   OR name LIKE 'Chain %'
                   OR name LIKE 'Duplicate Test %'
              )
      `);

      // ─── Formulations ───
      await client.query(`DELETE FROM formulations WHERE code LIKE 'E2E-%'`);

      // ─── Customer locations (references customers) ───
      await client.query(`
        DELETE FROM customer_locations
        WHERE customer_id IN (
          SELECT id FROM customers WHERE code LIKE 'E2E-%'
        )
        OR name LIKE 'E2E %'
        OR name LIKE 'Farm Location %'
      `);

      // ─── Customers ───
      await client.query(`DELETE FROM customers WHERE code LIKE 'E2E-%'`);

      // ─── Suppliers ───
      await client.query(`DELETE FROM suppliers WHERE code LIKE 'E2E-%'`);

      // ─── Feedstock types ───
      await client.query(`DELETE FROM feedstock_types WHERE code LIKE 'E2E-%'`);

      // ─── Vehicles ───
      await client.query(`DELETE FROM vehicles WHERE code LIKE 'E2E-%'`);

      // ─── Storage locations (references facilities) ───
      await client.query(`DELETE FROM storage_locations WHERE code LIKE 'E2E-%'`);

      // ─── Reactors (references facilities) ───
      // Delete by code prefix, identifier prefix, or facility reference
      await client.query(`
        DELETE FROM reactors
        WHERE code LIKE 'E2E-%'
           OR identifier LIKE 'UI %'
           OR identifier LIKE 'Chain %'
           OR facility_id IN (
                SELECT id FROM facilities
                WHERE code LIKE 'E2E-%'
                   OR name LIKE 'UI %'
                   OR name LIKE 'Chain %'
                   OR name LIKE 'Duplicate Test %'
              )
      `);

      // ─── Certifier projects (FK to facilities) ───
      await client.query(`
        DELETE FROM certifier_projects
        WHERE facility_id IN (
          SELECT id FROM facilities
          WHERE code LIKE 'E2E-%'
             OR name LIKE 'UI %'
             OR name LIKE 'Chain %'
             OR name LIKE 'Duplicate Test %'
        )
      `);

      // ─── Removal submission ledger rows ───
      // No FK to certifier_removals (local_entity_id is a plain uuid), but
      // stale rows would accumulate across runs. Sweep before the
      // certifier_removals delete so local_entity_id can still resolve.
      await client.query(`
        DELETE FROM certification_submissions
        WHERE local_entity_type = 'removal'
          AND local_entity_id IN (
            SELECT id FROM certifier_removals
            WHERE facility_id IN (
              SELECT id FROM facilities
              WHERE code LIKE 'E2E-%'
                 OR name LIKE 'UI %'
                 OR name LIKE 'Chain %'
                 OR name LIKE 'Duplicate Test %'
            )
          )
      `);

      // ─── Certifier removals (FK to facilities; also FKs ghg_statements) ───
      // Must go before certifier_ghg_statements (removal.ghg_statement_id FKs
      // it) and before facilities. credit_batches.removal_id FKs this table and
      // is already swept above, so removals can now be deleted.
      await client.query(`
        DELETE FROM certifier_removals
        WHERE facility_id IN (
          SELECT id FROM facilities
          WHERE code LIKE 'E2E-%'
             OR name LIKE 'UI %'
             OR name LIKE 'Chain %'
             OR name LIKE 'Duplicate Test %'
        )
      `);

      // ─── Certifier GHG statements (FK to facilities) ───
      await client.query(`
        DELETE FROM certifier_ghg_statements
        WHERE facility_id IN (
          SELECT id FROM facilities
          WHERE code LIKE 'E2E-%'
             OR name LIKE 'UI %'
             OR name LIKE 'Chain %'
             OR name LIKE 'Duplicate Test %'
        )
      `);

      // ─── Certifier project emissions (FK to facilities) ───
      await client.query(`
        DELETE FROM certifier_project_emissions
        WHERE facility_id IN (
          SELECT id FROM facilities
          WHERE code LIKE 'E2E-%'
             OR name LIKE 'UI %'
             OR name LIKE 'Chain %'
             OR name LIKE 'Duplicate Test %'
        )
      `);

      // ─── Stockpile events (FK to facilities) ───
      await client.query(`
        DELETE FROM stockpile_events
        WHERE facility_id IN (
          SELECT id FROM facilities
          WHERE code LIKE 'E2E-%'
             OR name LIKE 'UI %'
             OR name LIKE 'Chain %'
             OR name LIKE 'Duplicate Test %'
        )
      `);

      // ─── Power procurement evidence (FK to facilities) ───
      await client.query(`
        DELETE FROM power_procurement_evidence
        WHERE facility_id IN (
          SELECT id FROM facilities
          WHERE code LIKE 'E2E-%'
             OR name LIKE 'UI %'
             OR name LIKE 'Chain %'
             OR name LIKE 'Duplicate Test %'
        )
      `);

      // ─── Facilities ───
      await client.query(`
        DELETE FROM facilities
        WHERE code LIKE 'E2E-%'
           OR name LIKE 'UI %'
           OR name LIKE 'Chain %'
           OR name LIKE 'Duplicate Test %'
      `);

      // ─── Auth data: sessions, accounts, users ───

      // Sessions for E2E users
      await client.query(`DELETE FROM session WHERE user_id LIKE 'e2e-%'`);

      // Accounts for E2E users
      await client.query(`DELETE FROM account WHERE user_id LIKE 'e2e-%'`);

      // Users
      await client.query(`DELETE FROM users WHERE id LIKE 'e2e-%' OR email LIKE '%@e2e.local'`);

      await client.query("COMMIT");
      console.log("[global-teardown] E2E test data cleanup complete.");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("[global-teardown] Cleanup failed, rolled back:", error);
      // Don't throw - teardown failure shouldn't mark tests as failed
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
