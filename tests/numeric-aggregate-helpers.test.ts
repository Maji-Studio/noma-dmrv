import { describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import {
  countRows,
  numericAggregate,
  sumNumeric,
} from "@/db/aggregate";

type SQLWithDecoder = SQL<number> & {
  decoder: { mapFromDriverValue(value: unknown): number };
};

function decode(fragment: SQL<number>, value: unknown): number {
  return (fragment as SQLWithDecoder).decoder.mapFromDriverValue(value);
}

describe("numeric aggregate helpers", () => {
  it("decodes numeric and bigint text values as JavaScript numbers", () => {
    const sum = decode(sumNumeric(sql`mass_kg`), "12.5");
    const filteredSum = decode(
      sumNumeric(sql`mass_kg`, sql`status = 'done'`),
      "3.5",
    );
    const count = decode(countRows(), "12");
    const filteredCount = decode(countRows(sql`status = 'done'`), "3");
    const complex = decode(
      numericAggregate(sql<number>`COALESCE(SUM(mass_kg * ratio), 0)`),
      "7.25",
    );

    expect(sum).toBe(12.5);
    expect(typeof sum).toBe("number");
    expect(filteredSum).toBe(3.5);
    expect(typeof filteredSum).toBe("number");
    expect(count).toBe(12);
    expect(typeof count).toBe("number");
    expect(filteredCount).toBe(3);
    expect(typeof filteredCount).toBe("number");
    expect(complex).toBe(7.25);
    expect(typeof complex).toBe("number");
  });
});
