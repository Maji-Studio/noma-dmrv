import { and, eq } from "drizzle-orm";
import { PgSelectBase, QueryBuilder } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { creditBatches } from "@/db/schema";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { getBiocharProducts } from "./biochar-products";
import { inCreditBatchLineage } from "./credit-batch-lineage-filter";

// Compile real Drizzle queries without creating a database connection.
vi.mock("@/db", async () => {
  const { QueryBuilder } = await import("drizzle-orm/pg-core");
  return { db: new QueryBuilder() };
});
// The list module re-exports writers; keep their storage/auth setup out of this read test.
vi.mock("./biochar-product-create", () => ({ createBiocharProduct: vi.fn() }));
vi.mock("./biochar-product-update", () => ({
  updateBiocharProduct: vi.fn(), updateBiocharProductInTransaction: vi.fn(),
}));
vi.mock("./biochar-product-delete", () => ({
  deleteBiocharProduct: vi.fn(), deleteBiocharProductInTransaction: vi.fn(),
}));

const ctx = makeTestOrgContext();
const BATCH_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000002";
type RenderedQuery = { sql: string; params: unknown[] };

describe("credit batch product lineage SQL", () => {
  it("correlates both list and count queries to the outer product", async () => {
    const rendered: RenderedQuery[] = [];
    vi.spyOn(PgSelectBase.prototype, "then").mockImplementation(function (
      this: { toSQL(): RenderedQuery }, onfulfilled, onrejected,
    ) {
      const query = this.toSQL();
      rendered.push(query);
      const rows = query.sql.startsWith("select count(") ? [{ totalCount: 0 }] : [];
      return Promise.resolve(rows).then(onfulfilled, onrejected);
    });

    await getBiocharProducts(ctx, { creditBatchId: BATCH_ID });

    expect(rendered).toHaveLength(2);
    for (const query of rendered) {
      const subquery = query.sql.slice(query.sql.indexOf("exists ("));
      expect(subquery).toContain("exists (select 1");
      expect(subquery).not.toContain('"biochar_products"."id" = "biochar_products"."id"');
      expect(subquery).not.toContain('join "biochar_products"');
      expect(subquery).toContain(
        '"biochar_product_source_allocations"."biochar_product_id" = "biochar_products"."id"',
      );
      for (const table of ["biochar_product_source_allocations", "credit_batch_production_runs"]) {
        const binding = subquery.match(new RegExp(`"${table}"\\."organization_id" = \\$(\\d+)`));
        expect(binding).not.toBeNull();
        expect(query.params[Number(binding![1]) - 1]).toBe(ctx.organizationId);
      }
      expect(query.params).toContain(BATCH_ID);
      expect(query.params).toContain(ctx.organizationId);
    }
  });

  it("binds a literal product ID while correlating to the outer credit batch", () => {
    const query = new QueryBuilder().select({ id: creditBatches.id }).from(creditBatches)
      .where(and(
        eq(creditBatches.organizationId, ctx.organizationId),
        inCreditBatchLineage(ctx, creditBatches.id, PRODUCT_ID),
      )).toSQL();

    expect(query.sql).toContain(
      '"credit_batch_production_runs"."credit_batch_id" = "credit_batches"."id"',
    );
    expect(query.sql).toMatch(/"biochar_product_source_allocations"\."biochar_product_id" = \$\d+/);
    expect(query.sql).not.toContain('join "biochar_products"');
    expect(query.params).toEqual([
      ctx.organizationId, ctx.organizationId, PRODUCT_ID, ctx.organizationId,
    ]);
  });

  it("requires an organization scope before building lineage SQL", () => {
    expect(() => inCreditBatchLineage({ ...ctx, organizationId: "" }, BATCH_ID, PRODUCT_ID))
      .toThrow("Unauthorized");
  });
});
