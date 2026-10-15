import { describe, expect, it } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { certifierProjects } from "@/db/schema/certification";
import { reactors } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { reactorTypes } from "@/schemas/reactors";
import { feedstockCategories } from "@/schemas/feedstock-types";
import { facilityEmissionConfigSchema } from "@/schemas/certification";

const dialect = new PgDialect();

describe("master-data schema invariants", () => {
  it.each([
    { table: reactors, constraint: "reactors_reactor_type_valid", values: reactorTypes },
    { table: feedstockTypes, constraint: "feedstock_types_category_valid", values: feedstockCategories },
  ])("keeps $constraint aligned with the input vocabulary", ({ table, constraint, values }) => {
    const check = getTableConfig(table).checks.find((item) => item.name === constraint);
    expect(check).toBeDefined();
    const expression = dialect.sqlToQuery(check!.value).sql;
    const literals = [...expression.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(literals).toEqual([...values]);
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
