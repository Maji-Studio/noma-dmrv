import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../drizzle/0113_marvelous_sister_grimm.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Biochar Application journal migration", () => {
  it("preserves exactly mapped confirmed rows and removes only unmappable rows", () => {
    const addNullable =
      'ADD COLUMN "removal_submission_id" uuid;';
    const mapConfirmed =
      'UPDATE "certifier_biochar_applications" AS "application_journal"';
    const deleteUnmapped =
      'DELETE FROM "certifier_biochar_applications"\nWHERE "removal_submission_id" IS NULL;';
    const setNotNull =
      'ALTER COLUMN "removal_submission_id" SET NOT NULL';

    expect(migration).toContain(addNullable);
    expect(migration).toContain('"lifecycle_status" = \'confirmed\'');
    expect(migration).toContain(
      '"submission"."external_id" = "application_journal"."observed_ghg_entry_id"',
    );
    expect(migration).toContain(
      '"submission"."external_id" = "application_journal"."observed_removal_id"',
    );
    expect(migration).toContain(
      'HAVING count(DISTINCT "submission"."id") = 1',
    );
    expect(migration).toContain(deleteUnmapped);
    expect(migration).not.toMatch(
      /DELETE FROM "certifier_biochar_applications";(?=-->|\s*$)/,
    );
    expect(migration.indexOf(addNullable)).toBeLessThan(
      migration.indexOf(mapConfirmed),
    );
    expect(migration.indexOf(mapConfirmed)).toBeLessThan(
      migration.indexOf(deleteUnmapped),
    );
    expect(migration.indexOf(deleteUnmapped)).toBeLessThan(
      migration.indexOf(setNotNull),
    );
  });

  it("creates the tenant key before enforcing the composite submission FK", () => {
    const referencedKey =
      'ADD CONSTRAINT "certification_submissions_id_organization_id_unique"';
    const compositeForeignKey =
      'ADD CONSTRAINT "certifier_bca_removal_submission_org_fk"';

    expect(migration).toContain(
      '"submission"."organization_id" = "application_journal"."organization_id"',
    );
    expect(migration.indexOf(referencedKey)).toBeGreaterThanOrEqual(0);
    expect(migration.indexOf(compositeForeignKey)).toBeGreaterThanOrEqual(0);
    expect(migration.indexOf(referencedKey)).toBeLessThan(
      migration.indexOf(compositeForeignKey),
    );
    expect(migration).toContain(
      'FOREIGN KEY ("removal_submission_id","organization_id")',
    );
  });
});
