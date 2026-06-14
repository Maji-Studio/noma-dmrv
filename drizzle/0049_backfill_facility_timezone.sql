UPDATE "facilities"
SET "timezone" = 'UTC'
WHERE "timezone" IS NULL;--> statement-breakpoint
ALTER TABLE "facilities"
ALTER COLUMN "timezone" SET DEFAULT 'UTC';--> statement-breakpoint
ALTER TABLE "facilities"
ALTER COLUMN "timezone" SET NOT NULL;
