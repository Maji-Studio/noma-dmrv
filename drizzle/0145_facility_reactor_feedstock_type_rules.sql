ALTER TABLE "certifier_projects" ALTER COLUMN "external_facility_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedstock_types" ALTER COLUMN "usage" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "certifier_projects" DROP COLUMN "genset_energy_yield_kwh_per_litre";--> statement-breakpoint
ALTER TABLE "reactors" ADD CONSTRAINT "reactors_reactor_type_valid" CHECK ("reactors"."reactor_type" in ('fixed-bed', 'auger', 'rotary-kiln', 'batch', 'continuous'));--> statement-breakpoint
ALTER TABLE "feedstock_types" ADD CONSTRAINT "feedstock_types_category_valid" CHECK ("feedstock_types"."category" in ('forestry', 'agricultural', 'industrial', 'municipal', 'invasive', 'compost', 'mineral', 'lime', 'binder', 'amendment', 'other'));