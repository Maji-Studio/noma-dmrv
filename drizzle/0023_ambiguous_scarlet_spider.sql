CREATE TABLE "certifier_ghg_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"reporting_period_end_on" date NOT NULL,
	"reporting_period_start_on" date,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "certifier_removals" ADD COLUMN "ghg_statement_id" uuid;--> statement-breakpoint
ALTER TABLE "certifier_ghg_statements" ADD CONSTRAINT "certifier_ghg_statements_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_removals" ADD CONSTRAINT "certifier_removals_ghg_statement_id_certifier_ghg_statements_id_fk" FOREIGN KEY ("ghg_statement_id") REFERENCES "public"."certifier_ghg_statements"("id") ON DELETE no action ON UPDATE no action;