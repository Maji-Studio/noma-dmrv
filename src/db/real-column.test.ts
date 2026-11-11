import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect, PgReal, pgTable } from "drizzle-orm/pg-core";
import { realColumn } from "./schema/real-column";

const table = pgTable("real_column_test", {
  value: realColumn("value"),
  requiredValue: realColumn("required_value").notNull().default(0),
});
const dialect = new PgDialect();
const UNDERFLOW_VALUES = [4.0781595846974355e-194, 2.225073858507203e-309, -1e-60];
const UNCHANGED_VALUES = [1e-40, 0, 12.5, 100, 1e39];

describe("realColumn", () => {
  it.each(UNDERFLOW_VALUES)("maps underflow %s to plain zero", (value) => {
    expect(table.value.mapToDriverValue(value)).toBe(0);
  });

  it.each(UNCHANGED_VALUES)("passes %s through unchanged, including denormals and overflow", (value) => {
    expect(table.value.mapToDriverValue(value)).toBe(value);
  });

  it("keeps native real metadata, numeric reads, nullability and defaults", () => {
    expect(table.value).toBeInstanceOf(PgReal);
    expect(table.value.getSQLType()).toBe("real");
    expect(table.value.dataType).toBe("number");
    expect(table.value.columnType).toBe("PgReal");
    expect(table.value.mapFromDriverValue("12.5")).toBe(12.5);
    expect(table.value.mapFromDriverValue(100)).toBe(100);
    expect(table.requiredValue.notNull).toBe(true);
    expect(table.requiredValue.default).toBe(0);
    expectTypeOf<typeof table.$inferSelect.value>().toEqualTypeOf<number | null>();
    expectTypeOf<typeof table.$inferSelect.requiredValue>().toEqualTypeOf<number>();
  });

  it("maps bound parameters and lets Drizzle bypass the mapper for null", () => {
    const mapper = vi.spyOn(table.value, "mapToDriverValue");
    expect(dialect.sqlToQuery(sql`${sql.param(UNDERFLOW_VALUES[0], table.value)}`).params).toEqual([0]);
    mapper.mockClear();
    expect(dialect.sqlToQuery(sql`${sql.param(null, table.value)}`).params).toEqual([null]);
    expect(mapper).not.toHaveBeenCalled();
    expect(table.value.mapToDriverValue(null)).toBeNull();
  });
});
