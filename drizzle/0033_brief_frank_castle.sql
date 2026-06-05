ALTER TABLE "transport_legs" DROP CONSTRAINT "transport_legs_energy_usage_requirements";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP CONSTRAINT "transport_legs_distance_based_requirements";--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "calculation_method" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "calculation_method" SET DEFAULT 'distance_based'::text;--> statement-breakpoint
DROP TYPE "public"."emissions_calculation_method";--> statement-breakpoint
CREATE TYPE "public"."emissions_calculation_method" AS ENUM('distance_based');--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "calculation_method" SET DEFAULT 'distance_based'::"public"."emissions_calculation_method";--> statement-breakpoint
ALTER TABLE "transport_legs" ALTER COLUMN "calculation_method" SET DATA TYPE "public"."emissions_calculation_method" USING "calculation_method"::"public"."emissions_calculation_method";--> statement-breakpoint
ALTER TABLE "customer_locations" ADD COLUMN "distance_from_facility_km" real;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "distance_to_facility_km" real;--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "fuel_type";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "fuel_consumed_liters";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "electricity_kwh";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "emission_factor_used";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "emission_factor_source";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "transport_emissions_co2e_kg";--> statement-breakpoint
ALTER TABLE "transport_legs" ADD CONSTRAINT "transport_legs_distance_based_requirements" CHECK ("transport_legs"."calculation_method" <> 'distance_based'::emissions_calculation_method or "transport_legs"."load_mass_kg" is not null);