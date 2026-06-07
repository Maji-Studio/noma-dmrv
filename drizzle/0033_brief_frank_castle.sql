ALTER TABLE "transport_legs" DROP CONSTRAINT "transport_legs_energy_usage_requirements";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP CONSTRAINT "transport_legs_distance_based_requirements";--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "calculation_method" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "calculation_method" SET DEFAULT 'distance_based'::text;--> statement-breakpoint
UPDATE "transport_legs" SET "calculation_method" = 'distance_based' WHERE "calculation_method" IS DISTINCT FROM 'distance_based';--> statement-breakpoint
UPDATE "transport_legs" SET "load_mass_kg" = 0 WHERE "calculation_method" = 'distance_based' AND "load_mass_kg" IS NULL;--> statement-breakpoint
DROP TYPE "public"."emissions_calculation_method";--> statement-breakpoint
CREATE TYPE "public"."emissions_calculation_method" AS ENUM('distance_based');--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "calculation_method" SET DEFAULT 'distance_based'::"public"."emissions_calculation_method";--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "calculation_method" SET DATA TYPE "public"."emissions_calculation_method" USING CASE WHEN "calculation_method" = 'distance_based' THEN 'distance_based'::"public"."emissions_calculation_method" ELSE 'distance_based'::"public"."emissions_calculation_method" END;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD COLUMN "distance_from_facility_km" real;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "distance_to_facility_km" real;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD COLUMN "is_derived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "fuel_type";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "fuel_consumed_liters";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "electricity_kwh";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "emission_factor_used";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "emission_factor_source";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "transport_emissions_co2e_kg";--> statement-breakpoint
CREATE UNIQUE INDEX "transport_legs_one_derived_per_entity_idx" ON "transport_legs" ("entity_type","entity_id") WHERE "is_derived" = true;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD CONSTRAINT "customer_locations_distance_from_facility_km_non_negative" CHECK ("customer_locations"."distance_from_facility_km" is null or "customer_locations"."distance_from_facility_km" >= 0);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_distance_to_facility_km_non_negative" CHECK ("suppliers"."distance_to_facility_km" is null or "suppliers"."distance_to_facility_km" >= 0);--> statement-breakpoint
ALTER TABLE "transport_legs" ADD CONSTRAINT "transport_legs_distance_based_requirements" CHECK ("transport_legs"."calculation_method" <> 'distance_based'::emissions_calculation_method or "transport_legs"."load_mass_kg" is not null);
