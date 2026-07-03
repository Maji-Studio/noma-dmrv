ALTER TABLE "credit_batches" DROP CONSTRAINT "credit_batches_total_feedstock_mass_non_negative";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP CONSTRAINT "credit_batches_ineligible_feedstock_mass_non_negative";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP CONSTRAINT "credit_batches_ineligible_feedstock_check";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "weight_tons";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "total_co2e_stored_tons";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "total_co2e_emissions_tons";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "total_co2e_counterfactual_tons";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "total_feedstock_mass_kg";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "ineligible_feedstock_mass_kg";