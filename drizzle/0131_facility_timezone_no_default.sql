ALTER TABLE "facilities" ALTER COLUMN "timezone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization_settings" ALTER COLUMN "default_timezone" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organization_settings" ALTER COLUMN "default_timezone" DROP NOT NULL;