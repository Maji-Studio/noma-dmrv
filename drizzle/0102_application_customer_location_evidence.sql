ALTER TABLE "applications" ALTER COLUMN "evidence_method" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "organization_settings" ALTER COLUMN "default_evidence_method" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "evidence_method" SET DATA TYPE text USING "evidence_method"::text;
--> statement-breakpoint
ALTER TABLE "organization_settings" ALTER COLUMN "default_evidence_method" SET DATA TYPE text USING "default_evidence_method"::text;
--> statement-breakpoint
DROP TYPE "public"."application_evidence_method";
--> statement-breakpoint
CREATE TYPE "public"."application_evidence_method" AS ENUM ('location', 'boundary', 'visual');
--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "evidence_method" SET DATA TYPE "public"."application_evidence_method" USING "evidence_method"::"public"."application_evidence_method";
--> statement-breakpoint
ALTER TABLE "organization_settings" ALTER COLUMN "default_evidence_method" SET DATA TYPE "public"."application_evidence_method" USING "default_evidence_method"::"public"."application_evidence_method";
--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "evidence_method" SET DEFAULT 'location';
--> statement-breakpoint
ALTER TABLE "organization_settings" ALTER COLUMN "default_evidence_method" SET DEFAULT 'location';
