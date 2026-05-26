CREATE TYPE "public"."project_emission_category" AS ENUM('staff_travel', 'pyrolyzer_direct', 'biochar_storage_fuel', 'miscellaneous', 'lab_electricity', 'sampling_consumables');--> statement-breakpoint
CREATE TABLE "certifier_project_emissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"category" "project_emission_category" NOT NULL,
	"lca_window_start_on" date NOT NULL,
	"lca_window_end_on" date NOT NULL,
	"magnitude" real NOT NULL,
	"unit" text NOT NULL,
	"allocation_strategy_recommendation" text DEFAULT 'CUSTOM_TIME_PERIOD' NOT NULL,
	"source_document_id" uuid,
	"notes" text,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "certifier_project_emissions_facility_period_category_unique" UNIQUE("provider","facility_id","lca_window_end_on","category"),
	CONSTRAINT "certifier_project_emissions_window_chronology" CHECK ("certifier_project_emissions"."lca_window_start_on" <= "certifier_project_emissions"."lca_window_end_on")
);
--> statement-breakpoint
ALTER TABLE "certifier_project_emissions" ADD CONSTRAINT "certifier_project_emissions_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_project_emissions" ADD CONSTRAINT "certifier_project_emissions_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifier_project_emissions" ADD CONSTRAINT "certifier_project_emissions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certifier_project_emissions_facility_id_idx" ON "certifier_project_emissions" USING btree ("facility_id");