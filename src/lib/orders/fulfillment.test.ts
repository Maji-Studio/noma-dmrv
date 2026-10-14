import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { ORDER_FULFILLED_SHORTFALL_FRACTION } from "./fulfillment";
import { orderFulfillmentExpression } from "@/data-access/order-fulfillment-sql";

it("uses delivery count and the exact numeric threshold shared by the app and API", () => {
  const expression = orderFulfillmentExpression(sql`quantity`, sql`delivery_count`, sql`wet_mass`);
  const query = new PgDialect().sqlToQuery(expression);
  expect(query.sql).toContain("coalesce(delivery_count, 0) = 0 then 'no_deliveries'");
  expect(query.sql).toContain("coalesce(wet_mass, 0) >= quantity::numeric");
  expect(query.sql).toContain("else 'partial'");
  expect(query.params).toEqual([ORDER_FULFILLED_SHORTFALL_FRACTION]);
});
