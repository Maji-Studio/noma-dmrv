-- Older Failed runs on staging can lack output. NOT VALID skips their initial
-- scan while checking every insert and update; their next save must supply output.
ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_complete_has_output_posted_at";--> statement-breakpoint
ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_complete_has_output";--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_complete_has_output_posted_at" CHECK ("production_runs"."status" not in ('complete', 'failed') or "production_runs"."output_posted_at" is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_complete_has_output" CHECK ("production_runs"."status" not in ('complete', 'failed') or ("production_runs"."biochar_moisture_percent" is not null and "production_runs"."biochar_output_kg" is not null and "production_runs"."biochar_output_kg" > 0 and "production_runs"."biochar_storage_location_id" is not null)) NOT VALID;
