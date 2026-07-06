-- ADR 0021: durability tier moves from per-batch to facility-scoped. This is a
-- RENAME (default_durability_option -> durability_option), so preserve each
-- facility's existing tier instead of mass-defaulting every row to '1000_year':
-- add nullable, backfill from the old column, then apply the new default + NOT
-- NULL and drop the old column. COALESCE guards any legacy NULL.
ALTER TABLE "facilities" ADD COLUMN "durability_option" "durability_option";--> statement-breakpoint
UPDATE "facilities" SET "durability_option" = COALESCE("default_durability_option", '1000_year');--> statement-breakpoint
ALTER TABLE "facilities" ALTER COLUMN "durability_option" SET DEFAULT '1000_year';--> statement-breakpoint
ALTER TABLE "facilities" ALTER COLUMN "durability_option" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "s_reflectance_fraction" real;--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "durability_option";--> statement-breakpoint
ALTER TABLE "facilities" DROP COLUMN "default_durability_option";
