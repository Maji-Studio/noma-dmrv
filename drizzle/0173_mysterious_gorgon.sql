CREATE TABLE "feedstock_bin_method_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"stock_mode" "output_stock_mode" NOT NULL,
	"draw_order" "output_draw_order" NOT NULL,
	"previous_stock_mode" "output_stock_mode" NOT NULL,
	"previous_draw_order" "output_draw_order" NOT NULL,
	"effective_at" timestamp NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "storage_locations" DROP CONSTRAINT "storage_locations_mix_output_bin_only";--> statement-breakpoint
ALTER TABLE "feedstock_bin_method_changes" ADD CONSTRAINT "feedstock_bin_method_changes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_bin_method_changes" ADD CONSTRAINT "feedstock_bin_method_changes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedstock_bin_method_changes" ADD CONSTRAINT "feedstock_bin_method_changes_storage_location_id_organization_id_storage_locations_id_organization_id_fk" FOREIGN KEY ("storage_location_id","organization_id") REFERENCES "public"."storage_locations"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedstock_bin_method_changes_bin_idx" ON "feedstock_bin_method_changes" USING btree ("organization_id","storage_location_id","effective_at");--> statement-breakpoint
DELETE FROM production_run_feedstocks WHERE wet_mass_used_kg <= 0;--> statement-breakpoint
ALTER TABLE "production_run_feedstocks" ADD CONSTRAINT "production_run_feedstocks_positive_wet_mass" CHECK ("production_run_feedstocks"."wet_mass_used_kg" > 0);