DROP INDEX "production_runs_reactor_start_unique_idx";--> statement-breakpoint
ALTER TABLE "production_runs" DROP CONSTRAINT "production_runs_cancelled_requires_reason";--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
DROP TYPE "public"."production_run_status";--> statement-breakpoint
CREATE TYPE "public"."production_run_status" AS ENUM('running', 'complete', 'failed', 'cancelled');--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "status" SET DATA TYPE "public"."production_run_status" USING "status"::"public"."production_run_status";--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "status" SET DEFAULT 'running'::"public"."production_run_status";--> statement-breakpoint
CREATE UNIQUE INDEX "production_runs_reactor_start_unique_idx" ON "production_runs" USING btree ("reactor_id","start_time") WHERE "production_runs"."status" <> 'cancelled' and "production_runs"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_cancelled_requires_reason" CHECK ("production_runs"."status" <> 'cancelled' or COALESCE(length(trim("production_runs"."cancellation_reason")), 0) > 0);
