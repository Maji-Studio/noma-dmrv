CREATE TYPE "public"."moisture_pathway" AS ENUM('dry_weight_every_batch', 'consistent_target_moisture', 'measured_every_batch');--> statement-breakpoint
ALTER TABLE "production_processes" ADD COLUMN "agreed_baseline_size" integer;--> statement-breakpoint
ALTER TABLE "production_processes" ADD COLUMN "random_sampling_plan_ref" text;--> statement-breakpoint
ALTER TABLE "production_processes" ADD COLUMN "moisture_pathway" "moisture_pathway";