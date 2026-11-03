DELETE FROM "production_run_feedstocks" WHERE "wet_mass_used_kg" <= 0;
--> statement-breakpoint
ALTER TABLE "production_run_feedstocks" ADD CONSTRAINT "production_run_feedstocks_positive_wet_mass" CHECK ("production_run_feedstocks"."wet_mass_used_kg" > 0);
