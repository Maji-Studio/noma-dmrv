ALTER TABLE "power_procurement_evidence" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "stockpile_events" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "reactors" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "storage_locations" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "feedstock_deliveries" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "feedstocks" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "biochar_products" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "archived_at" timestamp;