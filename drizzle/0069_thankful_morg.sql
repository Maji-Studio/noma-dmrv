ALTER TABLE "facilities" ADD COLUMN "durability_option" "durability_option" DEFAULT '1000_year' NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "s_reflectance_fraction" real;--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "durability_option";--> statement-breakpoint
ALTER TABLE "facilities" DROP COLUMN "default_durability_option";