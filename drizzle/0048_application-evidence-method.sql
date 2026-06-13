CREATE TYPE "public"."application_evidence_method" AS ENUM('visual', 'boundary');--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "evidence_method" "application_evidence_method" DEFAULT 'visual' NOT NULL;--> statement-breakpoint
UPDATE "applications"
SET "evidence_method" = 'boundary'
WHERE "gis_boundary_reference" IS NOT NULL
  AND btrim("gis_boundary_reference") <> '';--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_photo_video_require_captured_at";
