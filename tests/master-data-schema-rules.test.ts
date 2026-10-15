import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { certifierProjects } from "@/db/schema/certification";
import { reactors } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { facilityEmissionConfigSchema } from "@/schemas/certification";

const dialect = new PgDialect();
const MIGRATION_SUFFIX = "_facility_reactor_feedstock_type_rules.sql";
const drizzleDir = new URL("../drizzle/", import.meta.url);
const migrationFile = readdirSync(drizzleDir).find((name) => name.endsWith(MIGRATION_SUFFIX));
if (!migrationFile) throw new Error(`No migration ending in ${MIGRATION_SUFFIX}`);
const migration = readFileSync(new URL(migrationFile, drizzleDir), "utf8");

describe("master-data schema invariants", () => {
  it.each([
    { table: reactors, constraint: "reactors_reactor_type_valid" },
    { table: feedstockTypes, constraint: "feedstock_types_category_valid" },
  ])("keeps $constraint SQL identical to migration 0143", ({ table, constraint }) => {
    const check = getTableConfig(table).checks.find((item) => item.name === constraint);
    expect(check).toBeDefined();
    const expression = dialect.sqlToQuery(check!.value).sql;
    const statement = migration.split("--> statement-breakpoint").map((item) => item.trim())
      .find((item) => item.includes(`ADD CONSTRAINT "${constraint}"`));
    expect(statement).toBe(`ALTER TABLE "${getTableConfig(table).name}" ADD CONSTRAINT "${constraint}" CHECK (${expression});`);
  });

  it("requires the external facility ID and explicit feedstock usage", () => {
    expect(certifierProjects.externalFacilityId.notNull).toBe(true);
    expect(feedstockTypes.usage.hasDefault).toBe(false);
    expect(feedstockTypes.usage.notNull).toBe(true);
  });

  it("removes the unused genset yield from storage and parsed emission settings", () => {
    expect(getTableConfig(certifierProjects).columns.map((column) => column.name)).not.toContain("genset_energy_yield_kwh_per_litre");
    const settings = facilityEmissionConfigSchema.parse({
      facilityId: "11111111-1111-4111-8111-111111111111",
      defaultSoilTemperatureC: 20,
      gensetEnergyYieldKwhPerLitre: 3,
    });
    expect(settings).not.toHaveProperty("gensetEnergyYieldKwhPerLitre");
    expect(settings.defaultSoilTemperatureC).toBe(20);
  });
});
