ALTER TABLE "feedstocks" ADD COLUMN "distance_km_override" real;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD COLUMN "distance_source" "distance_source";--> statement-breakpoint
ALTER TABLE "feedstocks" ADD COLUMN "distance_note" text;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_distance_override_positive" CHECK ("feedstocks"."distance_km_override" is null or "feedstocks"."distance_km_override" > 0);