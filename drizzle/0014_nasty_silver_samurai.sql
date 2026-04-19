CREATE TABLE "power_procurement_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"contract_type" text,
	"generator_cod_date" date,
	"grid_region" text,
	"matching_type" text,
	"eac_registry" text,
	"eac_retirement_id" text,
	"retired_at" timestamp,
	"document_ref" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "power_procurement_evidence_facility_period_unique" UNIQUE("facility_id","period_start","period_end"),
	CONSTRAINT "power_procurement_evidence_period_check" CHECK ("power_procurement_evidence"."period_start" < "power_procurement_evidence"."period_end")
);
--> statement-breakpoint
CREATE TABLE "stockpile_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"material_type" text NOT NULL,
	"material_id" uuid NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"last_control_at" timestamp,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"mitigation_notes" text,
	"exception_ref" text,
	"document_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stockpile_events_dates_check" CHECK ("stockpile_events"."ended_at" is null or "stockpile_events"."ended_at" > "stockpile_events"."started_at"),
	CONSTRAINT "stockpile_events_material_type_check" CHECK ("stockpile_events"."material_type" in ('biochar', 'feedstock')),
	CONSTRAINT "stockpile_events_risk_level_check" CHECK ("stockpile_events"."risk_level" in ('low', 'medium', 'high')),
	CONSTRAINT "stockpile_events_exception_ref_required" CHECK ("stockpile_events"."ended_at" is null
        or "stockpile_events"."ended_at" <= "stockpile_events"."started_at" + interval '12 months'
        or "stockpile_events"."exception_ref" is not null)
);
--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "total_feedstock_mass_kg" real;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "ineligible_feedstock_mass_kg" real;--> statement-breakpoint
ALTER TABLE "power_procurement_evidence" ADD CONSTRAINT "power_procurement_evidence_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stockpile_events" ADD CONSTRAINT "stockpile_events_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_total_feedstock_mass_non_negative" CHECK ("credit_batches"."total_feedstock_mass_kg" is null or "credit_batches"."total_feedstock_mass_kg" >= 0);--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_ineligible_feedstock_mass_non_negative" CHECK ("credit_batches"."ineligible_feedstock_mass_kg" is null or "credit_batches"."ineligible_feedstock_mass_kg" >= 0);--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_ineligible_feedstock_check" CHECK ("credit_batches"."ineligible_feedstock_mass_kg" is null
        or "credit_batches"."total_feedstock_mass_kg" is null
        or "credit_batches"."ineligible_feedstock_mass_kg" <= "credit_batches"."total_feedstock_mass_kg");