CREATE TYPE "public"."bin_movement_lane" AS ENUM('feedstock', 'biochar', 'product');--> statement-breakpoint
CREATE TYPE "public"."bin_movement_type" AS ENUM('adjustment', 'loss');--> statement-breakpoint
CREATE TABLE "bin_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_location_id" uuid NOT NULL,
	"lane" "bin_movement_lane" NOT NULL,
	"movement_type" "bin_movement_type" NOT NULL,
	"mass_delta_kg" numeric(14, 3) NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"counted_mass_kg" numeric(14, 3),
	"derived_mass_kg_at_time" numeric(14, 3),
	"counted_wet_mass_kg" numeric(14, 3),
	"moisture_ratio_used" numeric(7, 6),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bin_movements_loss_is_negative" CHECK ("bin_movements"."movement_type" <> 'loss' OR "bin_movements"."mass_delta_kg" < 0)
);
--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_storage_location_id_storage_locations_id_fk" FOREIGN KEY ("storage_location_id") REFERENCES "public"."storage_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bin_movements" ADD CONSTRAINT "bin_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bin_movements_storage_location_lane_idx" ON "bin_movements" USING btree ("storage_location_id","lane");