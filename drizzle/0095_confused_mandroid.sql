ALTER TYPE "public"."documentation_type" ADD VALUE 'gis_boundary';--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "gis_boundary" jsonb;--> statement-breakpoint
ALTER TABLE "applications" DROP COLUMN "gis_boundary_reference";