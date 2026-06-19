CREATE TABLE "production_processes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"feedstock_type_id" uuid NOT NULL,
	"established_at" timestamp DEFAULT now() NOT NULL,
	"sampling_method" "sampling_method" DEFAULT 'method_a' NOT NULL,
	"method_b_unlocked_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "samples" ALTER COLUMN "production_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "feedstock_type_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "production_process_id" uuid;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "credit_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "production_processes" ADD CONSTRAINT "production_processes_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processes" ADD CONSTRAINT "production_processes_feedstock_type_id_feedstock_types_id_fk" FOREIGN KEY ("feedstock_type_id") REFERENCES "public"."feedstock_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_processes_facility_feedstock_idx" ON "production_processes" USING btree ("facility_id","feedstock_type_id");--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_feedstock_type_id_feedstock_types_id_fk" FOREIGN KEY ("feedstock_type_id") REFERENCES "public"."feedstock_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_production_process_id_production_processes_id_fk" FOREIGN KEY ("production_process_id") REFERENCES "public"."production_processes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactors" DROP COLUMN "sampling_method";--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_isometric_max_one_month" CHECK ("credit_batches"."certifier" is distinct from 'isometric'
        or ("credit_batches"."end_date" - "credit_batches"."start_date") <= 31);