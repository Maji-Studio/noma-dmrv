ALTER TABLE "certifier_removals" ADD COLUMN "code" text;--> statement-breakpoint
WITH numbered_removals AS (
  SELECT "id", to_char("created_at", 'YY') AS "year",
    row_number() OVER (
      PARTITION BY "organization_id", date_trunc('year', "created_at")
      ORDER BY "created_at", "id"
    )::text AS "sequence"
  FROM "certifier_removals"
)
UPDATE "certifier_removals" AS removals
SET "code" = 'RM-' || numbered_removals."year" || '-' ||
  lpad(numbered_removals."sequence", greatest(3, length(numbered_removals."sequence")), '0')
FROM numbered_removals
WHERE removals."id" = numbered_removals."id";--> statement-breakpoint
ALTER TABLE "certifier_removals" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_removals" ADD CONSTRAINT "certifier_removals_organization_id_code_unique" UNIQUE("organization_id","code");
