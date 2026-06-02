CREATE TABLE "certifier_sensors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"reactor_id" uuid NOT NULL,
	"measurement_property" text NOT NULL,
	"external_sensor_id" text NOT NULL,
	"sensor_reference" text NOT NULL,
	"units" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "certifier_sensors_reactor_property_unique" UNIQUE("reactor_id","measurement_property"),
	CONSTRAINT "certifier_sensors_provider_reference_unique" UNIQUE("provider","sensor_reference")
);
--> statement-breakpoint
ALTER TABLE "certifier_projects" ADD COLUMN "external_facility_id" text;--> statement-breakpoint
ALTER TABLE "certifier_sensors" ADD CONSTRAINT "certifier_sensors_reactor_id_reactors_id_fk" FOREIGN KEY ("reactor_id") REFERENCES "public"."reactors"("id") ON DELETE no action ON UPDATE no action;