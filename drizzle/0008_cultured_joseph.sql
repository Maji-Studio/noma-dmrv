CREATE TABLE "supplier_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name" text,
	"country" text DEFAULT 'UNKNOWN' NOT NULL,
	"state_region" text,
	"city" text,
	"gps_latitude" double precision,
	"gps_longitude" double precision,
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_locations_gps_latitude_range" CHECK ("supplier_locations"."gps_latitude" is null or ("supplier_locations"."gps_latitude" >= -90 and "supplier_locations"."gps_latitude" <= 90)),
	CONSTRAINT "supplier_locations_gps_longitude_range" CHECK ("supplier_locations"."gps_longitude" is null or ("supplier_locations"."gps_longitude" >= -180 and "supplier_locations"."gps_longitude" <= 180))
);
--> statement-breakpoint
ALTER TABLE "customer_locations" ALTER COLUMN "name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD COLUMN "country" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD COLUMN "state_region" text;--> statement-breakpoint
ALTER TABLE "customer_locations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD CONSTRAINT "supplier_locations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;