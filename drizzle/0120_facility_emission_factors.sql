CREATE TABLE "facility_emission_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"facility_id" uuid NOT NULL,
	"diesel_kg_co2e_per_litre" numeric(12, 6) NOT NULL,
	"grid_kg_co2e_per_kwh" numeric(12, 6) NOT NULL,
	"road_freight_kg_co2e_per_tonne_km" numeric(12, 6) NOT NULL,
	"source_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "facility_emission_factors_facility_id_unique" UNIQUE("facility_id"),
	CONSTRAINT "facility_emission_factors_non_negative" CHECK ("facility_emission_factors"."diesel_kg_co2e_per_litre" >= 0 and "facility_emission_factors"."grid_kg_co2e_per_kwh" >= 0 and "facility_emission_factors"."road_freight_kg_co2e_per_tonne_km" >= 0)
);
--> statement-breakpoint
ALTER TABLE "facility_emission_factors" ADD CONSTRAINT "facility_emission_factors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facility_emission_factors" ADD CONSTRAINT "facility_emission_factors_facility_id_organization_id_facilities_id_organization_id_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facility_emission_factors_organization_id_idx" ON "facility_emission_factors" USING btree ("organization_id");