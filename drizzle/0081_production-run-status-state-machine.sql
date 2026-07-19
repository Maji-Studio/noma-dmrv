DROP INDEX "production_runs_reactor_start_unique_idx";--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "status" SET DEFAULT 'draft'::text;--> statement-breakpoint
DROP TYPE "public"."production_run_status";--> statement-breakpoint
CREATE TYPE "public"."production_run_status" AS ENUM('draft', 'running', 'complete', 'failed', 'cancelled');--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."production_run_status";--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "status" SET DATA TYPE "public"."production_run_status" USING "status"::"public"."production_run_status";--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "production_runs_reactor_start_unique_idx" ON "production_runs" USING btree ("reactor_id","start_time") WHERE "production_runs"."status" <> 'cancelled' and "production_runs"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_cancelled_requires_reason" CHECK ("production_runs"."status" <> 'cancelled' or COALESCE(length(trim("production_runs"."cancellation_reason")), 0) > 0);
