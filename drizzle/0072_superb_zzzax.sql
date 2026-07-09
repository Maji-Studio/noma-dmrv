CREATE TYPE "public"."transport_trip_type" AS ENUM('return', 'one_way');--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "trip_type" "transport_trip_type" DEFAULT 'return' NOT NULL;--> statement-breakpoint
ALTER TABLE "transport_legs" ADD COLUMN "trip_type" "transport_trip_type" DEFAULT 'return' NOT NULL;