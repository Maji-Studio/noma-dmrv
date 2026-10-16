import { describe, expect, it } from "vitest";
import { checkMigrations, HISTORIC_TIMESTAMP_INVERSION as HISTORIC } from "./check-migrations";

const ENTRIES = [
  { idx: 0, tag: "0000_first", when: 100 },
  { idx: 1, tag: "0001_second", when: 200 },
];
const FILES = ENTRIES.map((entry) => `${entry.tag}.sql`);

describe("checkMigrations", () => {
  it("accepts a consistent journal", () => {
    expect(checkMigrations(ENTRIES, FILES)).toEqual([]);
  });

  it("rejects duplicate migration prefixes", () => {
    expect(checkMigrations(ENTRIES, [...FILES, "0001_other.sql"]))
      .toContain("Migration prefix 0001 is shared by 0001_second.sql and 0001_other.sql.");
  });

  it.each([99, 100])("rejects a non-increasing when (%s)", (when) => {
    expect(checkMigrations([ENTRIES[0], { ...ENTRIES[1], when }], FILES))
      .toEqual([`Journal entry 1 when ${when} must be greater than entry 0 when 100.`]);
  });

  it("rejects missing files, missing entries, out-of-order indexes and mismatched prefixes", () => {
    const failures = checkMigrations([{ ...ENTRIES[0], idx: 1 }], ["0002_other.sql", "151_fix.sql"]);
    expect(failures).toEqual([
      "Journal entry 0 has idx 1; expected 0.",
      "Journal entry 1 is missing drizzle/0000_first.sql.",
      "Journal tag 0000_first has a numeric prefix different from idx 1.",
      "drizzle/0002_other.sql has no journal entry.",
      "drizzle/151_fix.sql has no journal entry.",
    ]);
  });

  it("exempts only the historic timestamp pair", () => {
    const entries = Array.from({ length: 12 }, (_, idx) => ({
      idx, tag: `${String(idx).padStart(4, "0")}_migration`, when: HISTORIC.previousWhen - HISTORIC.previousIdx + idx,
    }));
    entries[HISTORIC.idx].when = HISTORIC.when;
    const files = entries.map((entry) => `${entry.tag}.sql`);
    expect(checkMigrations(entries, files)).toEqual([]);
    entries[10].when -= 1;
    expect(checkMigrations(entries, files)).toHaveLength(1);
    entries[10].when += 1;
    entries[11].when = entries[10].when;
    expect(checkMigrations(entries, files)).toHaveLength(1);
    // Newer than its neighbour but older than idx 9: Drizzle would still skip it.
    entries[11].when = entries[10].when + 1;
    expect(checkMigrations(entries, files)).toHaveLength(1);
  });
});
