ALTER TABLE "production_runs" ALTER COLUMN "end_time" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "production_runs" ALTER COLUMN "end_time" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "production_runs_reactor_start_unique_idx" ON "production_runs" USING btree ("reactor_id","start_time") WHERE "production_runs"."status" <> 'void' and "production_runs"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "production_runs" DROP COLUMN "date";--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_end_after_start" CHECK ("production_runs"."end_time" is null or "production_runs"."end_time" > "production_runs"."start_time");