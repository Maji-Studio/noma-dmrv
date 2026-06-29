ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_truck_mass_on_arrival_non_negative";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_truck_mass_on_departure_non_negative";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP CONSTRAINT "feedstocks_truck_mass_arrival_gte_departure";--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_truck_mass_on_arrival_non_negative";--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_truck_mass_on_departure_non_negative";--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_truck_mass_arrival_gte_departure";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "truck_mass_on_arrival_kg";--> statement-breakpoint
ALTER TABLE "feedstocks" DROP COLUMN "truck_mass_on_departure_kg";--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN "truck_mass_on_arrival_kg";--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN "truck_mass_on_departure_kg";