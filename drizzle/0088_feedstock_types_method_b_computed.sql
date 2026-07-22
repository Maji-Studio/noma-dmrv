-- ADR 0022 removes the stored Method-B unlock and its write-time trigger
-- machinery before dropping the columns those functions reference.
DROP TRIGGER IF EXISTS samples_method_b_minimum_samples ON samples;
--> statement-breakpoint
DROP TRIGGER IF EXISTS credit_batches_method_b_minimum_samples ON credit_batches;
--> statement-breakpoint
DROP TRIGGER IF EXISTS process_method_b_minimum_samples ON production_processes;
--> statement-breakpoint
DROP TRIGGER IF EXISTS production_process_established_at_immutable ON production_processes;
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_method_b_minimum_samples_after_sample_write();
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_method_b_minimum_samples_after_credit_batch_write();
--> statement-breakpoint
DROP FUNCTION IF EXISTS assert_existing_process_method_b_minimum_samples(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_process_method_b_minimum_samples();
--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_established_at_immutable_after_unlock();
--> statement-breakpoint

ALTER TABLE "production_processes" DROP CONSTRAINT "production_processes_method_b_prereqs_chk";
--> statement-breakpoint
ALTER TABLE "production_processes" DROP COLUMN "sampling_method";
--> statement-breakpoint
ALTER TABLE "production_processes" DROP COLUMN "method_b_unlocked_at";
--> statement-breakpoint
ALTER TABLE "production_processes" ADD CONSTRAINT "production_processes_method_b_prereqs_chk" CHECK ((
  "production_processes"."agreed_baseline_size" IS NULL
  AND "production_processes"."random_sampling_plan_ref" IS NULL
  AND "production_processes"."moisture_pathway" IS NULL
) OR (
  "production_processes"."agreed_baseline_size" IS NOT NULL
  AND "production_processes"."random_sampling_plan_ref" IS NOT NULL
  AND btrim("production_processes"."random_sampling_plan_ref") <> ''
  AND "production_processes"."moisture_pathway" IS NOT NULL
));
--> statement-breakpoint

CREATE TYPE "public"."credit_batch_sampling" AS ENUM('sampled', 'unsampled');
--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "sampling" "credit_batch_sampling" DEFAULT 'sampled' NOT NULL;
--> statement-breakpoint

ALTER TABLE "feedstock_types" ADD COLUMN "isometric_feedstock_type_id" text;
--> statement-breakpoint
ALTER TABLE "feedstock_types" ADD COLUMN "archived_at" timestamp;
--> statement-breakpoint
ALTER TABLE "feedstock_types" ADD CONSTRAINT "feedstock_types_organization_id_isometric_id_unique" UNIQUE("organization_id", "isometric_feedstock_type_id");
--> statement-breakpoint

DROP TYPE "public"."sampling_method";
