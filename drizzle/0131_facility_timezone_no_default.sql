ALTER TABLE "facilities" ALTER COLUMN "timezone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization_settings" ALTER COLUMN "default_timezone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization_settings" ALTER COLUMN "default_timezone" DROP NOT NULL;--> statement-breakpoint
UPDATE "organization_settings" SET "default_timezone" = NULL WHERE "default_timezone" = 'UTC';