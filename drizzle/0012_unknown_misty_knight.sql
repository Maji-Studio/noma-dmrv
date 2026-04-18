CREATE TYPE "public"."climate_volatility_risk" AS ENUM('stable', 'moderate', 'variable');--> statement-breakpoint
CREATE TYPE "public"."electricity_source_category" AS ENUM('ec1_grid_average', 'ec2_ppa', 'ec3_eac', 'ec4_cod', 'ec5_direct_connection');--> statement-breakpoint
CREATE TYPE "public"."feedstock_eligibility_status" AS ENUM('eligible', 'ineligible', 'conditional');--> statement-breakpoint
CREATE TYPE "public"."land_tenure_type" AS ENUM('owned', 'long_term_lease', 'short_term_lease');--> statement-breakpoint
CREATE TYPE "public"."natural_disaster_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."operator_track_record" AS ENUM('new', 'established', 'experienced');--> statement-breakpoint
CREATE TYPE "public"."soil_erosion_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "reversal_risk_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"land_tenure_type" "land_tenure_type" NOT NULL,
	"soil_erosion_risk" "soil_erosion_risk" NOT NULL,
	"climate_volatility_risk" "climate_volatility_risk" NOT NULL,
	"natural_disaster_risk" "natural_disaster_risk" NOT NULL,
	"operator_track_record" "operator_track_record" NOT NULL,
	"calculated_buffer_percent" real NOT NULL,
	"location_notes" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reversal_risk_assessments_code_unique" UNIQUE("code"),
	CONSTRAINT "reversal_risk_buffer_percent_range" CHECK ("reversal_risk_assessments"."calculated_buffer_percent" >= 0 and "reversal_risk_assessments"."calculated_buffer_percent" <= 20)
);
--> statement-breakpoint
CREATE TABLE "loss_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"loss_type_code" text NOT NULL,
	"mass_kg_lost" real NOT NULL,
	"discovered_at" timestamp NOT NULL,
	"cause" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "loss_records_code_unique" UNIQUE("code"),
	CONSTRAINT "loss_records_mass_kg_lost_non_negative" CHECK ("loss_records"."mass_kg_lost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "biochar_storage_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"biochar_product_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"quantity_kg_stored" real NOT NULL,
	"quantity_kg_remaining" real NOT NULL,
	"stored_at" timestamp NOT NULL,
	"source_inventory_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "biochar_storage_inventory_code_unique" UNIQUE("code"),
	CONSTRAINT "biochar_storage_inventory_qty_remaining_non_negative" CHECK ("biochar_storage_inventory"."quantity_kg_remaining" >= 0),
	CONSTRAINT "biochar_storage_inventory_qty_remaining_lte_stored" CHECK ("biochar_storage_inventory"."quantity_kg_remaining" <= "biochar_storage_inventory"."quantity_kg_stored"),
	CONSTRAINT "biochar_storage_inventory_qty_stored_positive" CHECK ("biochar_storage_inventory"."quantity_kg_stored" > 0)
);
--> statement-breakpoint
ALTER TABLE "certifier_projects" ADD COLUMN "webhook_secret" text;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "reversal_risk_assessment_id" uuid;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD COLUMN "eligibility_status" "feedstock_eligibility_status";--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "electricity_source_category" "electricity_source_category";--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "low_carbon_percentage" real;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "biochar_storage_inventory_id" uuid;--> statement-breakpoint
ALTER TABLE "reversal_risk_assessments" ADD CONSTRAINT "reversal_risk_assessments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_storage_inventory" ADD CONSTRAINT "biochar_storage_inventory_biochar_product_id_biochar_products_id_fk" FOREIGN KEY ("biochar_product_id") REFERENCES "public"."biochar_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_storage_inventory" ADD CONSTRAINT "biochar_storage_inventory_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_storage_inventory" ADD CONSTRAINT "biochar_storage_inventory_source_inventory_id_biochar_storage_inventory_id_fk" FOREIGN KEY ("source_inventory_id") REFERENCES "public"."biochar_storage_inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_reversal_risk_assessment_id_reversal_risk_assessments_id_fk" FOREIGN KEY ("reversal_risk_assessment_id") REFERENCES "public"."reversal_risk_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_biochar_storage_inventory_id_biochar_storage_inventory_id_fk" FOREIGN KEY ("biochar_storage_inventory_id") REFERENCES "public"."biochar_storage_inventory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_low_carbon_percentage_range" CHECK ("production_runs"."low_carbon_percentage" is null or ("production_runs"."low_carbon_percentage" >= 0 and "production_runs"."low_carbon_percentage" <= 100));