ALTER TABLE "deliveries" DROP COLUMN "trip_type";--> statement-breakpoint
ALTER TABLE "transport_legs" DROP COLUMN "trip_type";--> statement-breakpoint
ALTER TABLE "organization_settings" DROP COLUMN "default_trip_type";--> statement-breakpoint
DROP TYPE "public"."transport_trip_type";