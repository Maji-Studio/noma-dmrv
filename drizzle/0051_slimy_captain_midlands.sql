ALTER TABLE "vehicles" ALTER COLUMN "identifier" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "fuel_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "fuel_consumption_l_per_km" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "model_year" DROP NOT NULL;