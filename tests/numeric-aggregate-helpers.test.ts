import { drizzle } from "drizzle-orm/node-postgres";
import { sql, type SQL } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  avgNumeric,
  countRows,
  numericAggregate,
  sumNumeric,
} from "@/db/aggregate";

type SQLWithDecoder<TResult> = SQL<TResult> & {
  decoder: { mapFromDriverValue(value: unknown): TResult };
};

function decode<TResult>(fragment: SQL<TResult>, value: unknown): TResult {
  return (fragment as SQLWithDecoder<TResult>).decoder.mapFromDriverValue(value);
}

describe("numeric aggregate helpers — decoder", () => {
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
    const average = decode(avgNumeric(sql`mass_kg`), "5.5");
    const emptyAverage = decode(avgNumeric(sql`mass_kg`), null);

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
    expect(average).toBe(5.5);
    expect(typeof average).toBe("number");
    expect(emptyAverage).toBeNull();
  });
});

// Real-SQL coverage: renders the helpers' actual SQL, executes it against
// Postgres, and asserts the decoder yields JS numbers. Unlike the decoder-only
// test above, a malformed COALESCE / FILTER / count(*) would fail here. Uses an
// inline VALUES source so no app schema is required; skips when the database is
// unreachable (mirrors tests/*.integration.test.ts).
describe("numeric aggregate helpers — real SQL", () => {
  let pool: Pool | undefined;
  let db: ReturnType<typeof drizzle> | undefined;

  // Three rows: mass_kg / ratio / status. Filtered aggregates target status='done'.
  const source = sql`(VALUES
    (10.5::numeric, 2::numeric, 'done'::text),
    (4.5::numeric, 3::numeric, 'pending'::text),
    (2::numeric, 4::numeric, 'done'::text)
  ) AS t(mass_kg, ratio, status)`;
  // A guaranteed-empty source to exercise zero-row / NULL-aggregate behaviour.
  const emptySource = sql`(SELECT 1::numeric AS mass_kg, 'x'::text AS status WHERE false) AS t`;
  const allNullSource = sql`(VALUES
    (NULL::numeric),
    (NULL::numeric)
  ) AS t(mass_kg)`;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return;
    const candidate = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 2_000,
    });
    try {
      await candidate.query("select 1");
    } catch {
      await candidate.end().catch(() => {});
      return;
    }
    pool = candidate;
    db = drizzle(candidate);
  });

  afterAll(async () => {
    await pool?.end().catch(() => {});
  });

  it("executes filtered and unfiltered sum/count as numbers", async (ctx) => {
    if (!db) return ctx.skip();

    const [row] = await db
      .select({
        total: sumNumeric(sql`mass_kg`),
        doneTotal: sumNumeric(sql`mass_kg`, sql`status = 'done'`),
        weighted: numericAggregate(sql<number>`COALESCE(SUM(mass_kg * ratio), 0)`),
        average: avgNumeric(sql`mass_kg`),
        n: countRows(),
        doneN: countRows(sql`status = 'done'`),
      })
      .from(source);

    expect(row.total).toBe(17); // 10.5 + 4.5 + 2
    expect(row.doneTotal).toBe(12.5); // 10.5 + 2
    expect(row.weighted).toBe(42.5); // 10.5*2 + 4.5*3 + 2*4
    expect(row.average).toBeCloseTo(17 / 3);
    expect(row.n).toBe(3);
    expect(row.doneN).toBe(2);
    for (const value of Object.values(row)) {
      expect(typeof value).toBe("number");
    }
  });

  it("preserves null for zero-row and all-null averages", async (ctx) => {
    if (!db) return ctx.skip();

    const [emptyRow] = await db
      .select({ average: avgNumeric(sql`mass_kg`) })
      .from(emptySource);
    const [allNullRow] = await db
      .select({ average: avgNumeric(sql`mass_kg`) })
      .from(allNullSource);

    expect(emptyRow.average).toBeNull();
    expect(allNullRow.average).toBeNull();
  });

  it("coalesces zero-row sums to 0 and counts to 0", async (ctx) => {
    if (!db) return ctx.skip();

    const [row] = await db
      .select({
        total: sumNumeric(sql`mass_kg`),
        filteredTotal: sumNumeric(sql`mass_kg`, sql`status = 'done'`),
        n: countRows(),
        filteredN: countRows(sql`status = 'done'`),
      })
      .from(emptySource);

    expect(row.total).toBe(0);
    expect(row.filteredTotal).toBe(0);
    expect(row.n).toBe(0);
    expect(row.filteredN).toBe(0);
    for (const value of Object.values(row)) {
      expect(typeof value).toBe("number");
    }
  });
});
