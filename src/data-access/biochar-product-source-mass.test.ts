import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { biocharProducts } from "@/db/schema";
import {
  productWetMassKgSql,
  sourceBiocharMassKgSql,
} from "./biochar-product-source-mass";

describe("productWetMassKgSql", () => {
  it("combines persisted blend mass and added water in one shared fragment", () => {
    const query = new PgDialect().sqlToQuery(
      productWetMassKgSql(
        biocharProducts.massKg,
        biocharProducts.waterAddedKg,
      ),
    );

    expect(query.sql).toContain("mass_kg");
    expect(query.sql).toContain("water_added_kg");
    expect(query.sql.match(/COALESCE/g)).toHaveLength(2);
  });
});

describe("sourceBiocharMassKgSql", () => {
  it("clamps invalid negative allocations with exact numeric SQL", () => {
    const query = new PgDialect().sqlToQuery(
      sourceBiocharMassKgSql(
        biocharProducts.massKg,
        biocharProducts.composition,
      ),
    );

    expect(query.sql).toContain("GREATEST(");
    expect(query.sql).toContain("0::numeric");
    expect(query.sql).toContain("::numeric > 0");
    expect(query.sql).not.toContain("0::real");
  });

  it.each([
    {
      name: "ignores a negative ingredient mass",
      blendMassKg: 100,
      ingredients: [{ massKg: -25 }],
      expectedSourceMassKg: 100,
    },
    {
      name: "clamps a positive ingredient over-allocation",
      blendMassKg: 100,
      ingredients: [{ massKg: 120 }],
      expectedSourceMassKg: 0,
    },
  ])("$name", async ({ blendMassKg, ingredients, expectedSourceMassKg }) => {
    const result = await db.execute<{ source_mass_kg: string }>(sql`
      SELECT ${sourceBiocharMassKgSql(
        sql`${blendMassKg}::numeric`,
        sql`${JSON.stringify({ ingredients })}::jsonb`,
      )} AS source_mass_kg
    `);

    expect(Number(result.rows[0]?.source_mass_kg)).toBe(expectedSourceMassKg);
  });
});
