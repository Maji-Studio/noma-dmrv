CREATE TYPE "public"."application_method" AS ENUM('manual', 'mechanical');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('delivered', 'applied');--> statement-breakpoint
CREATE TYPE "public"."biochar_product_status" AS ENUM('draft', 'testing', 'ready', 'sold');--> statement-breakpoint
CREATE TYPE "public"."certifier_provider" AS ENUM('isometric');--> statement-breakpoint
CREATE TYPE "public"."credit_batch_status" AS ENUM('draft', 'pending', 'verified', 'issued', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('scheduled', 'processing', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."documentation_type" AS ENUM('weighbridge_ticket', 'bill_of_lading', 'lab_report', 'delivery_receipt', 'invoice', 'pdd', 'affidavit', 'calibration_certificate', 'photo', 'video', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."durability_option" AS ENUM('200_year', '1000_year');--> statement-breakpoint
CREATE TYPE "public"."emissions_calculation_method" AS ENUM('energy_usage', 'distance_based');--> statement-breakpoint
CREATE TYPE "public"."feedstock_status" AS ENUM('missing_data', 'complete');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."isometric_submission_status" AS ENUM('draft', 'submitted', 'accepted', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'ordered', 'processed');--> statement-breakpoint
CREATE TYPE "public"."packaging_type" AS ENUM('loose', 'bagged');--> statement-breakpoint
CREATE TYPE "public"."production_run_status" AS ENUM('draft', 'running', 'complete', 'void');--> statement-breakpoint
CREATE TYPE "public"."storage_location_type" AS ENUM('feedstock_bin', 'feedstock_pile', 'biochar_pile', 'product_pile');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."transport_entity_type" AS ENUM('feedstock', 'biochar', 'sample', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."transport_method" AS ENUM('road', 'rail', 'ship', 'pipeline', 'aircraft');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'operator', 'lab_technician', 'viewer');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"application_date" timestamp DEFAULT now() NOT NULL,
	"status" "application_status" DEFAULT 'delivered' NOT NULL,
	"delivery_id" uuid NOT NULL,
	"biochar_applied_tons" real NOT NULL,
	"biochar_applied_dry_tons" real NOT NULL,
	"biochar_dry_matter_tons" real,
	"total_applied_tons" real,
	"average_application_rate_magnitude" real,
	"average_application_rate_unit" text,
	"gps_latitude" real,
	"gps_longitude" real,
	"field_size_ha" real,
	"field_size_hectares" real,
	"crop_type" text,
	"application_method" "application_method",
	"field_identifier" text,
	"gis_boundary_reference" text,
	"co2e_stored_tonnes" real,
	"co2e_stored_tons" real,
	"truck_mass_on_arrival_kg" real,
	"truck_mass_on_departure_kg" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "applications_code_unique" UNIQUE("code"),
	CONSTRAINT "applications_gps_latitude_range" CHECK ("applications"."gps_latitude" is null or ("applications"."gps_latitude" >= -90 and "applications"."gps_latitude" <= 90)),
	CONSTRAINT "applications_gps_longitude_range" CHECK ("applications"."gps_longitude" is null or ("applications"."gps_longitude" >= -180 and "applications"."gps_longitude" <= 180))
);
--> statement-breakpoint
CREATE TABLE "soil_temperature_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"measurement_date" date NOT NULL,
	"temperature_c" real NOT NULL,
	"temperature_celsius" real,
	"measurement_method" text,
	"measurement_approach" text,
	"measurement_depth_cm" real,
	"depth_cm" real,
	"gps_latitude" real,
	"gps_longitude" real,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "soil_temperature_measurements_gps_latitude_range" CHECK ("soil_temperature_measurements"."gps_latitude" is null or ("soil_temperature_measurements"."gps_latitude" >= -90 and "soil_temperature_measurements"."gps_latitude" <= 90)),
	CONSTRAINT "soil_temperature_measurements_gps_longitude_range" CHECK ("soil_temperature_measurements"."gps_longitude" is null or ("soil_temperature_measurements"."gps_longitude" >= -180 and "soil_temperature_measurements"."gps_longitude" <= 180))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"expires_at" timestamp,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'user' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custody_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_type" text NOT NULL,
	"material_id" uuid NOT NULL,
	"from_party_type" text NOT NULL,
	"from_party_id" uuid,
	"to_party_type" text NOT NULL,
	"to_party_id" uuid,
	"handoff_at" timestamp NOT NULL,
	"quantity_kg" real,
	"reference_number" text,
	"document_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedstock_sc_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feedstock_id" uuid NOT NULL,
	"criterion_code" text NOT NULL,
	"assessment_date" date NOT NULL,
	"outcome" text NOT NULL,
	"assessor" text,
	"valid_from" date,
	"valid_to" date,
	"evidence_document_id" uuid,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feedstock_sc_assessments_feedstock_criterion_date_unique" UNIQUE("feedstock_id","criterion_code","assessment_date"),
	CONSTRAINT "feedstock_sc_assessments_validity_window" CHECK ("feedstock_sc_assessments"."valid_from" is null or "feedstock_sc_assessments"."valid_to" is null or "feedstock_sc_assessments"."valid_from" <= "feedstock_sc_assessments"."valid_to")
);
--> statement-breakpoint
CREATE TABLE "ghg_materiality_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_batch_id" uuid NOT NULL,
	"assessment_date" date NOT NULL,
	"estimated_ssr_emissions_tco2e" real NOT NULL,
	"estimated_net_removals_tco2e" real NOT NULL,
	"materiality_percent" real,
	"is_material" boolean,
	"reassessment_required_by" date,
	"methodology_reference" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ghg_materiality_assessments_percent_range" CHECK ("ghg_materiality_assessments"."materiality_percent" is null or ("ghg_materiality_assessments"."materiality_percent" >= 0 and "ghg_materiality_assessments"."materiality_percent" <= 100))
);
--> statement-breakpoint
CREATE TABLE "credit_batch_applications" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"credit_batch_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_batch_applications_credit_batch_id_application_id_pk" PRIMARY KEY("credit_batch_id","application_id")
);
--> statement-breakpoint
CREATE TABLE "credit_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "credit_batch_status" DEFAULT 'pending' NOT NULL,
	"reactor_id" uuid,
	"start_date" timestamp,
	"end_date" timestamp,
	"reporting_period_start" date DEFAULT CURRENT_DATE NOT NULL,
	"reporting_period_end" date DEFAULT CURRENT_DATE NOT NULL,
	"certifier" text,
	"registry" text,
	"batches_count" integer,
	"weight_tons" real,
	"credits_tco2e" real,
	"value_tzs" real,
	"buffer_pool_percent" real,
	"durability_option" "durability_option" DEFAULT '200_year' NOT NULL,
	"soil_temperature_c" real,
	"soil_temperature_celsius" real,
	"soil_temperature_source" text,
	"h_to_c_org_ratio" real,
	"mean_random_reflectance_percent" real,
	"std_random_reflectance" real,
	"mean_non_reactive_carbon_percent" real,
	"std_non_reactive_carbon_percent" real,
	"std_non_reactive_carbon" real,
	"f_durable_calculated" real,
	"f_durable_fraction" real,
	"total_co2e_stored_tons" real,
	"total_co2e_emissions_tons" real,
	"total_co2e_counterfactual_tons" real,
	"net_co2e_removal_tons" real,
	"total_credits_tons" real,
	"site_management_notes" text,
	"affidavit_reference" text,
	"intended_use_confirmation" text,
	"company_verification_ref" text,
	"mixing_timeline_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_batches_code_unique" UNIQUE("code"),
	CONSTRAINT "credit_batches_200_year_requires_soil_temp_and_h_to_corg" CHECK ("credit_batches"."durability_option" <> '200_year'::durability_option or (
        "credit_batches"."soil_temperature_c" is not null and
        "credit_batches"."h_to_c_org_ratio" is not null
      )),
	CONSTRAINT "credit_batches_1000_year_requires_reflectance_and_non_reactive_carbon" CHECK ("credit_batches"."durability_option" <> '1000_year'::durability_option or (
        "credit_batches"."mean_random_reflectance_percent" is not null and
        "credit_batches"."mean_non_reactive_carbon_percent" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "lab_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_batch_id" uuid NOT NULL,
	"sample_id" uuid NOT NULL,
	"lab_name" text NOT NULL,
	"analysis_date" timestamp NOT NULL,
	"iso_17025_accreditation" boolean NOT NULL,
	"results" jsonb NOT NULL,
	"analyst_name" text,
	"report_file_url" text NOT NULL,
	"report_file" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_type" "documentation_type" NOT NULL,
	"file_url" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size_bytes" integer,
	"mime_type" text,
	"checksum_sha256" text,
	"issued_at" timestamp,
	"captured_at" timestamp,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"notes" text,
	"feedstock_id" uuid,
	"feedstock_delivery_id" uuid,
	"production_run_id" uuid,
	"sample_id" uuid,
	"incident_report_id" uuid,
	"biochar_product_id" uuid,
	"delivery_id" uuid,
	"transport_leg_id" uuid,
	"application_id" uuid,
	"credit_batch_id" uuid,
	"lab_analysis_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "documents_exactly_one_owner_check" CHECK ((
      (case when "documents"."feedstock_id" is not null then 1 else 0 end) +
      (case when "documents"."feedstock_delivery_id" is not null then 1 else 0 end) +
      (case when "documents"."production_run_id" is not null then 1 else 0 end) +
      (case when "documents"."sample_id" is not null then 1 else 0 end) +
      (case when "documents"."incident_report_id" is not null then 1 else 0 end) +
      (case when "documents"."biochar_product_id" is not null then 1 else 0 end) +
      (case when "documents"."delivery_id" is not null then 1 else 0 end) +
      (case when "documents"."transport_leg_id" is not null then 1 else 0 end) +
      (case when "documents"."application_id" is not null then 1 else 0 end) +
      (case when "documents"."credit_batch_id" is not null then 1 else 0 end) +
      (case when "documents"."lab_analysis_id" is not null then 1 else 0 end)
      ) = 1),
	CONSTRAINT "documents_photo_video_require_captured_at" CHECK ("documents"."document_type" <> all (array['photo', 'video']::documentation_type[]) or "documents"."captured_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "emission_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" text NOT NULL,
	"region" text,
	"fuel_type" text NOT NULL,
	"emission_factor_kg_co2e_per_unit" real NOT NULL,
	"unit" text NOT NULL,
	"source" text NOT NULL,
	"notes" text,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"gps_latitude" real,
	"gps_longitude" real,
	"country" text DEFAULT 'UNKNOWN' NOT NULL,
	"address" text,
	"contact_email" text,
	"contact_phone" text,
	"default_durability_option" "durability_option" DEFAULT '200_year' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "facilities_code_unique" UNIQUE("code"),
	CONSTRAINT "facilities_gps_latitude_range" CHECK ("facilities"."gps_latitude" is null or ("facilities"."gps_latitude" >= -90 and "facilities"."gps_latitude" <= 90)),
	CONSTRAINT "facilities_gps_longitude_range" CHECK ("facilities"."gps_longitude" is null or ("facilities"."gps_longitude" >= -180 and "facilities"."gps_longitude" <= 180))
);
--> statement-breakpoint
CREATE TABLE "reactors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"identifier" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"reactor_type" text NOT NULL,
	"type" text NOT NULL,
	"capacity_kg" real,
	"design_specs" text,
	"specifications" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reactors_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "storage_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "storage_location_type" NOT NULL,
	"capacity_kg" real,
	"latitude" real,
	"longitude" real,
	"isometric_storage_method" text,
	"isometric_description" text,
	"isometric_supplier_reference_id" text,
	"facility_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "storage_locations_code_unique" UNIQUE("code"),
	CONSTRAINT "storage_locations_latitude_range" CHECK ("storage_locations"."latitude" is null or ("storage_locations"."latitude" >= -90 and "storage_locations"."latitude" <= 90)),
	CONSTRAINT "storage_locations_longitude_range" CHECK ("storage_locations"."longitude" is null or ("storage_locations"."longitude" >= -180 and "storage_locations"."longitude" <= 180))
);
--> statement-breakpoint
CREATE TABLE "feedstock_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"status" "feedstock_status" DEFAULT 'missing_data' NOT NULL,
	"delivery_date" timestamp NOT NULL,
	"supplier_id" uuid NOT NULL,
	"driver_id" uuid,
	"vehicle_id" uuid,
	"vehicle_description" text,
	"vehicle_type" text,
	"fuel_type" text,
	"gps_latitude" real,
	"gps_longitude" real,
	"distance_km" real,
	"fuel_consumed_liters" real,
	"transport_emissions_tco2e" real,
	"transport_emissions_co2e_kg" real,
	"emission_factor_used" text,
	"feedstock_type_id" uuid,
	"weight_kg" real,
	"moisture_percent" real,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feedstock_deliveries_code_unique" UNIQUE("code"),
	CONSTRAINT "feedstock_deliveries_gps_latitude_range" CHECK ("feedstock_deliveries"."gps_latitude" is null or ("feedstock_deliveries"."gps_latitude" >= -90 and "feedstock_deliveries"."gps_latitude" <= 90)),
	CONSTRAINT "feedstock_deliveries_gps_longitude_range" CHECK ("feedstock_deliveries"."gps_longitude" is null or ("feedstock_deliveries"."gps_longitude" >= -180 and "feedstock_deliveries"."gps_longitude" <= 180))
);
--> statement-breakpoint
CREATE TABLE "feedstock_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feedstock_types_code_unique" UNIQUE("code"),
	CONSTRAINT "feedstock_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "feedstocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "feedstock_status" DEFAULT 'missing_data' NOT NULL,
	"feedstock_delivery_id" uuid,
	"collection_date" timestamp,
	"delivery_date" timestamp NOT NULL,
	"supplier_id" uuid NOT NULL,
	"driver_id" uuid,
	"vehicle_type" text,
	"fuel_type" text,
	"fuel_consumed_liters" real,
	"distance_km" real,
	"transport_emissions_tco2e" real,
	"feedstock_type_id" uuid NOT NULL,
	"weight_kg" real,
	"mass_wet_kg" real NOT NULL,
	"mass_dry_kg" real NOT NULL,
	"moisture_percent" real,
	"moisture_content_percent" real,
	"total_carbon_percent" real,
	"inorganic_carbon_percent" real,
	"total_organic_carbon_percent" real,
	"co2e_feedstock_tons" real,
	"feedstock_source_region" text,
	"storage_location_id" uuid,
	"counterfactual_category" text,
	"counterfactual_emissions_15_tons" real,
	"counterfactual_storage_50_tons" real,
	"market_leakage_method" text,
	"market_leakage_tons" real,
	"baseline_scenario" text DEFAULT 'unknown' NOT NULL,
	"baseline_description" text DEFAULT '' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feedstocks_code_unique" UNIQUE("code"),
	CONSTRAINT "feedstocks_mass_dry_non_negative" CHECK ("feedstocks"."mass_dry_kg" >= 0),
	CONSTRAINT "feedstocks_mass_dry_lte_wet" CHECK ("feedstocks"."mass_dry_kg" <= "feedstocks"."mass_wet_kg")
);
--> statement-breakpoint
CREATE TABLE "customer_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"gps_latitude" real NOT NULL,
	"gps_longitude" real NOT NULL,
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_locations_gps_latitude_range" CHECK ("customer_locations"."gps_latitude" >= -90 and "customer_locations"."gps_latitude" <= 90),
	CONSTRAINT "customer_locations_gps_longitude_range" CHECK ("customer_locations"."gps_longitude" >= -180 and "customer_locations"."gps_longitude" <= 180)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"gps_latitude" real NOT NULL,
	"gps_longitude" real NOT NULL,
	"distance_km" real,
	"crop_type" text,
	"address" text,
	"contact_email" text,
	"contact_phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customers_code_unique" UNIQUE("code"),
	CONSTRAINT "customers_gps_latitude_range" CHECK ("customers"."gps_latitude" >= -90 and "customers"."gps_latitude" <= 90),
	CONSTRAINT "customers_gps_longitude_range" CHECK ("customers"."gps_longitude" >= -180 and "customers"."gps_longitude" <= 180)
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"license_number" text,
	"contact_phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"credentials" text,
	"contact_phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "operators_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"gps_latitude" real,
	"gps_longitude" real,
	"address" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"annual_revenue_usd" real,
	"chain_of_custody_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_code_unique" UNIQUE("code"),
	CONSTRAINT "suppliers_gps_latitude_range" CHECK ("suppliers"."gps_latitude" is null or ("suppliers"."gps_latitude" >= -90 and "suppliers"."gps_latitude" <= 90)),
	CONSTRAINT "suppliers_gps_longitude_range" CHECK ("suppliers"."gps_longitude" is null or ("suppliers"."gps_longitude" >= -180 and "suppliers"."gps_longitude" <= 180))
);
--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_run_id" uuid NOT NULL,
	"incident_time" timestamp NOT NULL,
	"incident_date" timestamp DEFAULT now() NOT NULL,
	"operator_id" uuid,
	"reactor_id" uuid,
	"description" text NOT NULL,
	"severity" "incident_severity",
	"corrective_actions" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_run_feedstocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_run_id" uuid NOT NULL,
	"feedstock_id" uuid NOT NULL,
	"mass_used_kg" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_run_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_run_id" uuid NOT NULL,
	"timestamp" timestamp NOT NULL,
	"temperature_c" real,
	"temperature_celsius" real,
	"pressure_bar" real,
	"continuous_gas_measurement" boolean DEFAULT false NOT NULL,
	"ch4_composition" real,
	"n2o_composition" real,
	"co_composition" real,
	"co2_composition" real,
	"gas_flow_rate" real,
	"ch4_ppm" real,
	"n2o_ppm" real,
	"co_ppm" real,
	"co2_ppm" real,
	"flow_rate" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "production_run_readings_ppm_required_when_continuous" CHECK ("production_run_readings"."continuous_gas_measurement" = false or (
        "production_run_readings"."ch4_ppm" is not null and
        "production_run_readings"."n2o_ppm" is not null and
        "production_run_readings"."co_ppm" is not null and
        "production_run_readings"."co2_ppm" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "production_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "production_run_status" DEFAULT 'running' NOT NULL,
	"start_time" timestamp DEFAULT now() NOT NULL,
	"end_time" timestamp DEFAULT now() NOT NULL,
	"reactor_id" uuid NOT NULL,
	"operator_id" uuid,
	"feedstock_mix" text,
	"feedstock_storage_location_id" uuid,
	"feedstock_amount_kg" real,
	"feeding_rate_kg_hr" real,
	"moisture_before_drying_percent" real,
	"moisture_after_drying_percent" real,
	"biochar_amount_kg" real,
	"biochar_dry_weight_kg" real,
	"biochar_wet_weight_kg" real,
	"biochar_dry_moisture_percent" real,
	"uncarbonized_biochar_kg" real,
	"yield_percent" real,
	"biochar_storage_location_id" uuid,
	"pyrolysis_temperature_c" real,
	"temperature_celsius" real,
	"residence_time_minutes" integer,
	"diesel_operation_liters" real,
	"diesel_genset_liters" real,
	"preprocessing_fuel_liters" real,
	"electricity_kwh" real,
	"plc_data_file_url" text,
	"emissions_from_fossils_kg" real,
	"emissions_from_grid_kg" real,
	"total_emissions_kg" real,
	"energy_emissions_co2e_kg" real,
	"total_emissions_co2e_kg" real,
	"emission_factors_used" jsonb,
	"quenching_dry_weight_kg" real,
	"quenching_wet_weight_kg" real,
	"biochar_output_kg" real,
	"yield_percentage" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "production_runs_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_run_id" uuid NOT NULL,
	"sampling_time" timestamp NOT NULL,
	"operator_id" uuid,
	"reactor_id" uuid,
	"sample_code" text NOT NULL,
	"weight_g" real,
	"weight_grams" real,
	"volume_ml" real,
	"temperature_c" real,
	"analysis_date" date,
	"total_carbon_percent" real NOT NULL,
	"inorganic_carbon_percent" real,
	"organic_carbon_percent" real NOT NULL,
	"carbon_content_percent" real,
	"hydrogen_content_percent" real,
	"total_hydrogen_percent" real,
	"oxygen_content_percent" real,
	"total_oxygen_percent" real,
	"nitrogen_percent" real,
	"total_nitrogen_percent" real,
	"sulfur_percent" real,
	"total_sulfur_percent" real,
	"h_corg_molar_ratio" real,
	"h_to_c_org_ratio" real,
	"o_corg_molar_ratio" real,
	"o_to_c_org_ratio" real,
	"moisture_percent" real,
	"moisture_content_percent" real,
	"ash_percent" real,
	"ash_content_percent" real,
	"volatile_matter_percent" real,
	"fixed_carbon_percent" real,
	"ph" real,
	"salt_content_g_per_kg" real,
	"bulk_density_kg_per_m3" real,
	"water_holding_capacity_percent" real,
	"lead_mg_per_kg" real,
	"lead_mg_kg" real,
	"cadmium_mg_per_kg" real,
	"cadmium_mg_kg" real,
	"copper_mg_per_kg" real,
	"copper_mg_kg" real,
	"nickel_mg_per_kg" real,
	"nickel_mg_kg" real,
	"mercury_mg_per_kg" real,
	"mercury_mg_kg" real,
	"zinc_mg_per_kg" real,
	"zinc_mg_kg" real,
	"chromium_mg_per_kg" real,
	"chromium_mg_kg" real,
	"arsenic_mg_per_kg" real,
	"arsenic_mg_kg" real,
	"pahs_efsa8_mg_per_kg" real,
	"pah_total_mg_kg" real,
	"pahs_epa16_mg_per_kg" real,
	"pcdd_f_ng_per_kg" real,
	"dioxins_ng_kg" real,
	"furans_ng_kg" real,
	"pcb_mg_per_kg" real,
	"pcb_total_mg_kg" real,
	"nutrient_claim_enabled" boolean DEFAULT false NOT NULL,
	"phosphorus_g_per_kg" real,
	"phosphorus_percent" real,
	"potassium_g_per_kg" real,
	"potassium_percent" real,
	"magnesium_g_per_kg" real,
	"magnesium_percent" real,
	"calcium_g_per_kg" real,
	"calcium_percent" real,
	"iron_g_per_kg" real,
	"iron_percent" real,
	"random_reflectance_r0" real,
	"random_reflectance_r0_percent" real,
	"r0_measurement_count" integer,
	"residual_organic_carbon_percent" real,
	"residual_carbon_percent" real,
	"reactive_carbon_percent" real,
	"tga_analysis_date" date,
	"r0_analysis_date" date,
	"r0_histogram_file_url" text,
	"tga_thermogram_file_url" text,
	"lab_name" text,
	"lab_accreditation_number" text,
	"lab_accreditation" text,
	"analysis_method" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "samples_nutrients_required_when_claim_enabled" CHECK ("samples"."nutrient_claim_enabled" = false or (
        "samples"."phosphorus_g_per_kg" is not null and
        "samples"."potassium_g_per_kg" is not null and
        "samples"."magnesium_g_per_kg" is not null and
        "samples"."calcium_g_per_kg" is not null and
        "samples"."iron_g_per_kg" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "biochar_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"production_date" timestamp DEFAULT now() NOT NULL,
	"status" "biochar_product_status" DEFAULT 'testing' NOT NULL,
	"formulation_id" uuid NOT NULL,
	"source_storage_location_id" uuid,
	"destination_storage_location_id" uuid,
	"biochar_source_storage_id" uuid,
	"linked_production_run_id" uuid,
	"biochar_amount_kg" real,
	"biochar_per_m3_kg" real,
	"compost_weight_kg" real,
	"compost_per_m3_kg" real,
	"total_weight_kg" real,
	"mass_kg" real,
	"total_volume_liters" real,
	"density_kg_l" real,
	"density_kg_m3" real,
	"composition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"storage_location_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "biochar_products_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "formulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"biochar_ratio" real,
	"compost_ratio" real,
	"description" text,
	"ratio" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "formulations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"delivery_date" timestamp NOT NULL,
	"status" "delivery_status" DEFAULT 'processing' NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_location_id" uuid,
	"biochar_product_id" uuid,
	"storage_location_id" uuid,
	"quantity_tons" real,
	"quantity_m3" real,
	"biochar_tons" real,
	"fixed_carbon_percent" real,
	"delivered_wet_mass_kg" real,
	"mass_dry_kg" real,
	"driver_id" uuid,
	"vehicle_id" uuid,
	"vehicle_description" text,
	"vehicle_type" text,
	"transport_emissions_co2e_kg" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_code_unique" UNIQUE("code"),
	CONSTRAINT "deliveries_mass_dry_non_negative" CHECK ("deliveries"."mass_dry_kg" is null or "deliveries"."mass_dry_kg" >= 0),
	CONSTRAINT "deliveries_delivered_wet_mass_non_negative" CHECK ("deliveries"."delivered_wet_mass_kg" is null or "deliveries"."delivered_wet_mass_kg" >= 0),
	CONSTRAINT "deliveries_mass_dry_lte_wet_mass" CHECK ("deliveries"."mass_dry_kg" is null or "deliveries"."delivered_wet_mass_kg" is null or "deliveries"."mass_dry_kg" <= "deliveries"."delivered_wet_mass_kg")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"order_date" timestamp NOT NULL,
	"status" "order_status" DEFAULT 'ordered' NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_location_id" uuid NOT NULL,
	"invoice_number" text,
	"formulation_id" uuid,
	"biochar_product_id" uuid NOT NULL,
	"quantity_tons" real NOT NULL,
	"quantity_kg" real NOT NULL,
	"quantity_m3" real,
	"biochar_tons" real,
	"packaging" "packaging_type" NOT NULL,
	"packaging_type" text DEFAULT 'bagged' NOT NULL,
	"value_tzs" real,
	"application_status" text,
	"bulk_density_kg_l" real,
	"c_sink_type" text,
	"compost_per_m3_percent" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "transport_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "transport_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"origin_gps_latitude" real,
	"origin_gps_longitude" real,
	"origin_name" text,
	"destination_gps_latitude" real,
	"destination_gps_longitude" real,
	"destination_name" text,
	"distance_km" real NOT NULL,
	"transport_method" "transport_method" NOT NULL,
	"vehicle_type" text,
	"vehicle_model_year" text,
	"model_year" integer,
	"fuel_type" text,
	"fuel_consumed_liters" real,
	"electricity_kwh" real,
	"load_weight_tonnes" real,
	"load_mass_kg" real,
	"load_capacity_utilization_percent" real,
	"calculation_method" "emissions_calculation_method" NOT NULL,
	"emission_factor_used" real,
	"emission_factor_source" text,
	"emissions_co2e_kg" real,
	"transport_emissions_co2e_kg" real,
	"bcu_used" real,
	"bcu_provider" text,
	"bcu_certification_ref" text,
	"bill_of_lading" text,
	"weigh_scale_ticket_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transport_legs_origin_gps_latitude_range" CHECK ("transport_legs"."origin_gps_latitude" is null or ("transport_legs"."origin_gps_latitude" >= -90 and "transport_legs"."origin_gps_latitude" <= 90)),
	CONSTRAINT "transport_legs_origin_gps_longitude_range" CHECK ("transport_legs"."origin_gps_longitude" is null or ("transport_legs"."origin_gps_longitude" >= -180 and "transport_legs"."origin_gps_longitude" <= 180)),
	CONSTRAINT "transport_legs_destination_gps_latitude_range" CHECK ("transport_legs"."destination_gps_latitude" is null or ("transport_legs"."destination_gps_latitude" >= -90 and "transport_legs"."destination_gps_latitude" <= 90)),
	CONSTRAINT "transport_legs_destination_gps_longitude_range" CHECK ("transport_legs"."destination_gps_longitude" is null or ("transport_legs"."destination_gps_longitude" >= -180 and "transport_legs"."destination_gps_longitude" <= 180)),
	CONSTRAINT "transport_legs_energy_usage_requirements" CHECK ("transport_legs"."calculation_method" <> 'energy_usage'::emissions_calculation_method or (
        "transport_legs"."fuel_type" is not null and
        ("transport_legs"."fuel_consumed_liters" is not null or "transport_legs"."electricity_kwh" is not null) and
        "transport_legs"."emission_factor_used" is not null
      )),
	CONSTRAINT "transport_legs_distance_based_requirements" CHECK ("transport_legs"."calculation_method" <> 'distance_based'::emissions_calculation_method or (
        "transport_legs"."load_mass_kg" is not null and
        "transport_legs"."vehicle_type" is not null and
        "transport_legs"."emission_factor_used" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"identifier" text NOT NULL,
	"type" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"fuel_type" text NOT NULL,
	"fuel_consumption_l_per_km" real NOT NULL,
	"fuel_consumption_rate" real,
	"model_year" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_code_unique" UNIQUE("code"),
	CONSTRAINT "vehicles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "isometric_biochar_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"external_biochar_application_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "isometric_submission_status" DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp,
	"superseded_at" timestamp,
	"payload_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "isometric_biochar_applications_application_version_unique" UNIQUE("application_id","version"),
	CONSTRAINT "isometric_biochar_applications_external_unique" UNIQUE("external_biochar_application_id")
);
--> statement-breakpoint
CREATE TABLE "isometric_document_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"external_document_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "isometric_document_uploads_document_unique" UNIQUE("document_id"),
	CONSTRAINT "isometric_document_uploads_external_unique" UNIQUE("external_document_id")
);
--> statement-breakpoint
CREATE TABLE "isometric_ghg_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_batch_id" uuid NOT NULL,
	"external_ghg_statement_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "isometric_submission_status" DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp,
	"superseded_at" timestamp,
	"payload_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "isometric_ghg_statements_credit_batch_version_unique" UNIQUE("credit_batch_id","version"),
	CONSTRAINT "isometric_ghg_statements_external_unique" UNIQUE("external_ghg_statement_id")
);
--> statement-breakpoint
CREATE TABLE "isometric_monitoring_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_monitoring_submission_id" text NOT NULL,
	"monitoring_period_start" timestamp,
	"monitoring_period_end" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "isometric_submission_status" DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp,
	"superseded_at" timestamp,
	"payload_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "isometric_monitoring_submissions_source_version_unique" UNIQUE("source_id","version"),
	CONSTRAINT "isometric_monitoring_submissions_external_unique" UNIQUE("external_monitoring_submission_id")
);
--> statement-breakpoint
CREATE TABLE "isometric_production_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_run_id" uuid NOT NULL,
	"external_production_batch_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "isometric_submission_status" DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp,
	"superseded_at" timestamp,
	"payload_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "isometric_production_batches_run_version_unique" UNIQUE("production_run_id","version"),
	CONSTRAINT "isometric_production_batches_external_unique" UNIQUE("external_production_batch_id")
);
--> statement-breakpoint
CREATE TABLE "isometric_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"external_project_id" text NOT NULL,
	"protocol_slug" text DEFAULT 'biochar' NOT NULL,
	"protocol_version" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "isometric_projects_provider_external_project_unique" UNIQUE("provider","external_project_id"),
	CONSTRAINT "isometric_projects_facility_provider_unique" UNIQUE("facility_id","provider")
);
--> statement-breakpoint
CREATE TABLE "isometric_removals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_batch_id" uuid NOT NULL,
	"external_removal_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "isometric_submission_status" DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp,
	"superseded_at" timestamp,
	"payload_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "isometric_removals_credit_batch_version_unique" UNIQUE("credit_batch_id","version"),
	CONSTRAINT "isometric_removals_external_unique" UNIQUE("external_removal_id")
);
--> statement-breakpoint
CREATE TABLE "isometric_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"source_type" text NOT NULL,
	"source_reference_id" text NOT NULL,
	"description" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "isometric_sources_provider_type_ref_unique" UNIQUE("provider","source_type","source_reference_id")
);
--> statement-breakpoint
CREATE TABLE "isometric_storage_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"external_storage_location_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "isometric_submission_status" DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp,
	"superseded_at" timestamp,
	"payload_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "isometric_storage_locations_application_version_unique" UNIQUE("application_id","version"),
	CONSTRAINT "isometric_storage_locations_external_unique" UNIQUE("external_storage_location_id")
);
--> statement-breakpoint
CREATE TABLE "isometric_sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"status" "sync_status" DEFAULT 'pending' NOT NULL,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"error_message" text,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_user_unique" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soil_temperature_measurements" ADD CONSTRAINT "soil_temperature_measurements_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_handoffs" ADD CONSTRAINT "custody_handoffs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_sc_assessments" ADD CONSTRAINT "feedstock_sc_assessments_feedstock_id_feedstocks_id_fk" FOREIGN KEY ("feedstock_id") REFERENCES "public"."feedstocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_sc_assessments" ADD CONSTRAINT "feedstock_sc_assessments_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ghg_materiality_assessments" ADD CONSTRAINT "ghg_materiality_assessments_credit_batch_id_credit_batches_id_fk" FOREIGN KEY ("credit_batch_id") REFERENCES "public"."credit_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD CONSTRAINT "credit_batch_applications_credit_batch_id_credit_batches_id_fk" FOREIGN KEY ("credit_batch_id") REFERENCES "public"."credit_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batch_applications" ADD CONSTRAINT "credit_batch_applications_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_reactor_id_reactors_id_fk" FOREIGN KEY ("reactor_id") REFERENCES "public"."reactors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_analyses" ADD CONSTRAINT "lab_analyses_credit_batch_id_credit_batches_id_fk" FOREIGN KEY ("credit_batch_id") REFERENCES "public"."credit_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_analyses" ADD CONSTRAINT "lab_analyses_sample_id_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."samples"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_feedstock_id_feedstocks_id_fk" FOREIGN KEY ("feedstock_id") REFERENCES "public"."feedstocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_feedstock_delivery_id_feedstock_deliveries_id_fk" FOREIGN KEY ("feedstock_delivery_id") REFERENCES "public"."feedstock_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_production_run_id_production_runs_id_fk" FOREIGN KEY ("production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_sample_id_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."samples"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_incident_report_id_incident_reports_id_fk" FOREIGN KEY ("incident_report_id") REFERENCES "public"."incident_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_biochar_product_id_biochar_products_id_fk" FOREIGN KEY ("biochar_product_id") REFERENCES "public"."biochar_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_transport_leg_id_transport_legs_id_fk" FOREIGN KEY ("transport_leg_id") REFERENCES "public"."transport_legs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_credit_batch_id_credit_batches_id_fk" FOREIGN KEY ("credit_batch_id") REFERENCES "public"."credit_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_lab_analysis_id_lab_analyses_id_fk" FOREIGN KEY ("lab_analysis_id") REFERENCES "public"."lab_analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactors" ADD CONSTRAINT "reactors_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ADD CONSTRAINT "feedstock_deliveries_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ADD CONSTRAINT "feedstock_deliveries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ADD CONSTRAINT "feedstock_deliveries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ADD CONSTRAINT "feedstock_deliveries_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ADD CONSTRAINT "feedstock_deliveries_feedstock_type_id_feedstock_types_id_fk" FOREIGN KEY ("feedstock_type_id") REFERENCES "public"."feedstock_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_feedstock_delivery_id_feedstock_deliveries_id_fk" FOREIGN KEY ("feedstock_delivery_id") REFERENCES "public"."feedstock_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_feedstock_type_id_feedstock_types_id_fk" FOREIGN KEY ("feedstock_type_id") REFERENCES "public"."feedstock_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_production_run_id_production_runs_id_fk" FOREIGN KEY ("production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_reactor_id_reactors_id_fk" FOREIGN KEY ("reactor_id") REFERENCES "public"."reactors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_feedstocks" ADD CONSTRAINT "production_run_feedstocks_production_run_id_production_runs_id_fk" FOREIGN KEY ("production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_feedstocks" ADD CONSTRAINT "production_run_feedstocks_feedstock_id_feedstocks_id_fk" FOREIGN KEY ("feedstock_id") REFERENCES "public"."feedstocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_readings" ADD CONSTRAINT "production_run_readings_production_run_id_production_runs_id_fk" FOREIGN KEY ("production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_reactor_id_reactors_id_fk" FOREIGN KEY ("reactor_id") REFERENCES "public"."reactors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_feedstock_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("feedstock_storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_biochar_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("biochar_storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_production_run_id_production_runs_id_fk" FOREIGN KEY ("production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_reactor_id_reactors_id_fk" FOREIGN KEY ("reactor_id") REFERENCES "public"."reactors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_formulation_id_formulations_id_fk" FOREIGN KEY ("formulation_id") REFERENCES "public"."formulations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_source_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("source_storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_destination_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("destination_storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_biochar_source_storage_id_storage_locations_id_fk" FOREIGN KEY ("biochar_source_storage_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_linked_production_run_id_production_runs_id_fk" FOREIGN KEY ("linked_production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD CONSTRAINT "biochar_products_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customer_location_id_customer_locations_id_fk" FOREIGN KEY ("customer_location_id") REFERENCES "public"."customer_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_biochar_product_id_biochar_products_id_fk" FOREIGN KEY ("biochar_product_id") REFERENCES "public"."biochar_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_location_id_customer_locations_id_fk" FOREIGN KEY ("customer_location_id") REFERENCES "public"."customer_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_formulation_id_formulations_id_fk" FOREIGN KEY ("formulation_id") REFERENCES "public"."formulations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_biochar_product_id_biochar_products_id_fk" FOREIGN KEY ("biochar_product_id") REFERENCES "public"."biochar_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isometric_biochar_applications" ADD CONSTRAINT "isometric_biochar_applications_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isometric_document_uploads" ADD CONSTRAINT "isometric_document_uploads_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isometric_ghg_statements" ADD CONSTRAINT "isometric_ghg_statements_credit_batch_id_credit_batches_id_fk" FOREIGN KEY ("credit_batch_id") REFERENCES "public"."credit_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isometric_monitoring_submissions" ADD CONSTRAINT "isometric_monitoring_submissions_source_id_isometric_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."isometric_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isometric_production_batches" ADD CONSTRAINT "isometric_production_batches_production_run_id_production_runs_id_fk" FOREIGN KEY ("production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isometric_projects" ADD CONSTRAINT "isometric_projects_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isometric_removals" ADD CONSTRAINT "isometric_removals_credit_batch_id_credit_batches_id_fk" FOREIGN KEY ("credit_batch_id") REFERENCES "public"."credit_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isometric_storage_locations" ADD CONSTRAINT "isometric_storage_locations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;