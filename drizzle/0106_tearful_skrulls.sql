CREATE TABLE "production_run_feedstock_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"production_run_id" uuid NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"wet_mass_kg" numeric(14, 3) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "production_run_feedstock_draws_run_bin_unique" UNIQUE("organization_id","production_run_id","storage_location_id"),
	CONSTRAINT "production_run_feedstock_draws_wet_mass_positive" CHECK ("production_run_feedstock_draws"."wet_mass_kg" > 0)
);
--> statement-breakpoint
ALTER TABLE "production_run_feedstock_draws" ADD CONSTRAINT "production_run_feedstock_draws_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_feedstock_draws" ADD CONSTRAINT "production_run_feedstock_draws_production_run_id_organization_id_production_runs_id_organization_id_fk" FOREIGN KEY ("production_run_id","organization_id") REFERENCES "public"."production_runs"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_run_feedstock_draws" ADD CONSTRAINT "production_run_feedstock_draws_storage_location_id_organization_id_storage_locations_id_organization_id_fk" FOREIGN KEY ("storage_location_id","organization_id") REFERENCES "public"."storage_locations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_run_feedstock_draws_organization_run_idx" ON "production_run_feedstock_draws" USING btree ("organization_id","production_run_id");--> statement-breakpoint
CREATE INDEX "production_run_feedstock_draws_organization_bin_idx" ON "production_run_feedstock_draws" USING btree ("organization_id","storage_location_id");--> statement-breakpoint
INSERT INTO "production_run_feedstock_draws" (
	"organization_id",
	"production_run_id",
	"storage_location_id",
	"wet_mass_kg"
)
SELECT
	"organization_id",
	"id",
	"feedstock_storage_location_id",
	"feedstock_wet_mass_kg"
FROM "production_runs"
WHERE "feedstock_storage_location_id" IS NOT NULL
	AND "feedstock_wet_mass_kg" > 0;
