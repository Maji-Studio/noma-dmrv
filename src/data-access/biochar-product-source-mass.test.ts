import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { biocharProducts } from "@/db/schema";
import { sourceBiocharMassKgSql } from "./biochar-product-source-mass";

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
    expect(query.sql).not.toContain("0::real");
  });
});
