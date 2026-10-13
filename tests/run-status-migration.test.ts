import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/0133_run_status_no_draft.sql", "utf8");
const statements = migration.split("--> statement-breakpoint").map((statement) => statement.trim());

describe("run status migration", () => {
  it("preserves open and closed draft windows while status is text", () => {
    const conversion = statements.find((statement) => statement.startsWith('UPDATE "production_runs"'));
    expect(conversion).toMatch(
      /SET "status" = CASE\s+WHEN "end_time" IS NULL THEN 'running'\s+ELSE 'failed'\s+END\s+WHERE "status" = 'draft';/,
    );
    const conversionIndex = statements.indexOf(conversion!);
    const textIndex = statements.findIndex((statement) => statement.includes('SET DATA TYPE text'));
    const enumIndex = statements.findIndex((statement) => statement.startsWith('CREATE TYPE'));
    expect(textIndex).toBeGreaterThanOrEqual(0);
    expect(conversionIndex).toBeGreaterThan(textIndex);
    expect(enumIndex).toBeGreaterThan(conversionIndex);
  });
});
