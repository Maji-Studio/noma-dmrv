ALTER TABLE "customer_locations" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD COLUMN "distance_from_facility_km" real;--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "distance_km_override" real;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "distance_note" text;--> statement-breakpoint
CREATE INDEX "customer_locations_customer_id_idx" ON "customer_locations" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_locations_one_default_per_customer" ON "customer_locations" USING btree ("customer_id") WHERE "customer_locations"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_locations_one_default_per_supplier" ON "supplier_locations" USING btree ("supplier_id") WHERE "supplier_locations"."is_default" = true;--> statement-breakpoint
ALTER TABLE "supplier_locations" ADD CONSTRAINT "supplier_locations_distance_from_facility_km_non_negative" CHECK ("supplier_locations"."distance_from_facility_km" is null or "supplier_locations"."distance_from_facility_km" >= 0);--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_distance_km_override_non_negative" CHECK ("deliveries"."distance_km_override" is null or "deliveries"."distance_km_override" >= 0);