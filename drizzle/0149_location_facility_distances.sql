CREATE TABLE "customer_location_facility_distances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"distance_km" real NOT NULL,
	"distance_source" "distance_source" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_location_facility_distance_pair_unique" UNIQUE("location_id","facility_id"),
	CONSTRAINT "customer_location_facility_distance_positive" CHECK ("customer_location_facility_distances"."distance_km" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_location_facility_distances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"location_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"distance_km" real NOT NULL,
	"distance_source" "distance_source" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_location_facility_distance_pair_unique" UNIQUE("location_id","facility_id"),
	CONSTRAINT "supplier_location_facility_distance_positive" CHECK ("supplier_location_facility_distances"."distance_km" > 0)
);
--> statement-breakpoint
ALTER TABLE "customer_locations" DROP CONSTRAINT "customer_locations_distance_from_facility_km_positive";--> statement-breakpoint
ALTER TABLE "supplier_locations" DROP CONSTRAINT "supplier_locations_distance_from_facility_km_positive";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "recorded_distance_km" real;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "recorded_distance_source" "distance_source";--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD CONSTRAINT "supplier_locations_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "customer_location_facility_distances" ADD CONSTRAINT "customer_location_facility_distances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_location_facility_distances" ADD CONSTRAINT "customer_location_facility_distance_location_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."customer_locations"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_location_facility_distances" ADD CONSTRAINT "customer_location_facility_distance_facility_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_location_facility_distances" ADD CONSTRAINT "supplier_location_facility_distances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_location_facility_distances" ADD CONSTRAINT "supplier_location_facility_distance_location_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."supplier_locations"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_location_facility_distances" ADD CONSTRAINT "supplier_location_facility_distance_facility_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_location_facility_distances_org_idx" ON "customer_location_facility_distances" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "supplier_location_facility_distances_org_idx" ON "supplier_location_facility_distances" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "customer_locations" DROP COLUMN "distance_from_facility_km";--> statement-breakpoint
ALTER TABLE "customer_locations" DROP COLUMN "distance_source";--> statement-breakpoint
ALTER TABLE "supplier_locations" DROP COLUMN "distance_from_facility_km";--> statement-breakpoint
ALTER TABLE "supplier_locations" DROP COLUMN "distance_source";
