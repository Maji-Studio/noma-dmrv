ALTER TABLE "production_runs" ADD COLUMN "output_posted_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "production_runs"
SET "output_posted_at" = "updated_at" AT TIME ZONE 'UTC'
WHERE "status" = 'complete'
  AND "biochar_storage_location_id" IS NOT NULL
  AND "biochar_output_kg" > 0;
