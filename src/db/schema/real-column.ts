import { PgReal, PgRealBuilder, type AnyPgTable, type PgRealBuilderInitial } from "drizzle-orm/pg-core";

/** Match float4 underflow without rounding other representable values. */
export function normalizeRealUnderflow(value: number): number {
  return value !== 0 && Math.fround(value) === 0 ? 0 : value;
}

class RealColumnBuilder<TName extends string> extends PgRealBuilder<PgRealBuilderInitial<TName>["_"]> {
  // Keep the native column class, SQL type, number metadata and read mapping.
  build(table: AnyPgTable) {
    const column = new PgReal(table, this.config);
    column.mapToDriverValue = (value: unknown) =>
      typeof value === "number" ? normalizeRealUnderflow(value) : value;
    return column;
  }
}

/** Store values that round to float4 zero as plain zero, avoiding Postgres underflow. */
export const realColumn = <TName extends string>(name: TName) => new RealColumnBuilder(name);
