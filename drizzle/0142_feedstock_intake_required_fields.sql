ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_gps_latitude_range";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_gps_longitude_range";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_mass_dry_lte_wet";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_moisture_content_percent_range";--> statement-breakpoint
ALTER TABLE "feedstocks" ALTER COLUMN "delivery_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedstocks" ALTER COLUMN "supplier_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedstocks" ALTER COLUMN "mass_wet_kg" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedstocks" ALTER COLUMN "moisture_content_percent" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedstocks" ALTER COLUMN "storage_location_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_locations" DROP COLUMN "supplier_reference_id";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "gps_latitude";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "gps_longitude";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "co2e_feedstock_tons";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "feedstock_source_region";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "counterfactual_category";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "counterfactual_emissions_15_tons";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "counterfactual_storage_50_tons";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "market_leakage_method";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "market_leakage_tons";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "baseline_scenario";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "baseline_description";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "eligibility_status";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "bill_of_lading";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "weigh_scale_ticket_ref";--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_feedstock_loss_time" CHECK ("bin_movements"."lane" <> 'feedstock' or "bin_movements"."movement_type" <> 'loss' or "bin_movements"."occurred_at" is not null);--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_mass_dry_lte_wet" CHECK ("feedstocks"."mass_dry_kg" <= "feedstocks"."mass_wet_kg");--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_moisture_content_percent_range" CHECK (("feedstocks"."moisture_content_percent" >= 0 and "feedstocks"."moisture_content_percent" < 100));--> statement-breakpoint
DROP TYPE "public"."feedstock_eligibility_status";