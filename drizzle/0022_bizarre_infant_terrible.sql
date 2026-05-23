CREATE TABLE "certifier_removals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"started_on" date,
	"completed_on" date,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "removal_id" uuid;--> statement-breakpoint
ALTER TABLE "certifier_removals" ADD CONSTRAINT "certifier_removals_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_removal_id_certifier_removals_id_fk" FOREIGN KEY ("removal_id") REFERENCES "public"."certifier_removals"("id") ON DELETE no action ON UPDATE no action;