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
-- One-off staging copy (approved by Kenji 2026-10-16, #456): an organization
-- with exactly one facility had one meaning for the old per-location distance,
-- so copy it into that facility's pair row and stamp existing deliveries.
-- Multi-facility organizations re-enter distances per facility.
INSERT INTO "customer_location_facility_distances" ("organization_id", "location_id", "facility_id", "distance_km", "distance_source")
SELECT cl."organization_id", cl."id", f."id", cl."distance_from_facility_km", COALESCE(cl."distance_source", 'manual')
FROM "customer_locations" cl
JOIN "facilities" f ON f."organization_id" = cl."organization_id"
WHERE cl."distance_from_facility_km" IS NOT NULL
  AND (SELECT count(*) FROM "facilities" f2 WHERE f2."organization_id" = cl."organization_id") = 1;--> statement-breakpoint
INSERT INTO "supplier_location_facility_distances" ("organization_id", "location_id", "facility_id", "distance_km", "distance_source")
SELECT sl."organization_id", sl."id", f."id", sl."distance_from_facility_km", COALESCE(sl."distance_source", 'manual')
FROM "supplier_locations" sl
JOIN "facilities" f ON f."organization_id" = sl."organization_id"
WHERE sl."distance_from_facility_km" IS NOT NULL
  AND (SELECT count(*) FROM "facilities" f2 WHERE f2."organization_id" = sl."organization_id") = 1;--> statement-breakpoint
UPDATE "deliveries" d
SET "recorded_distance_km" = p."distance_km", "recorded_distance_source" = p."distance_source"
FROM "orders" o
JOIN "customer_location_facility_distances" p ON p."location_id" = o."customer_location_id" AND p."organization_id" = o."organization_id"
WHERE d."order_id" = o."id" AND d."organization_id" = o."organization_id"
  AND p."facility_id" = d."facility_id" AND d."recorded_distance_km" IS NULL;--> statement-breakpoint
ALTER TABLE "customer_locations" DROP COLUMN "distance_from_facility_km";--> statement-breakpoint
ALTER TABLE "customer_locations" DROP COLUMN "distance_source";--> statement-breakpoint
ALTER TABLE "supplier_locations" DROP COLUMN "distance_from_facility_km";--> statement-breakpoint
ALTER TABLE "supplier_locations" DROP COLUMN "distance_source";
