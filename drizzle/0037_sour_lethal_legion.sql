ALTER TABLE "certifier_sources" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custody_handoffs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feedstock_sc_assessments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ghg_materiality_assessments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reversal_risk_assessments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "emission_factors" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loss_records" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "certifier_sources" CASCADE;--> statement-breakpoint
DROP TABLE "custody_handoffs" CASCADE;--> statement-breakpoint
DROP TABLE "feedstock_sc_assessments" CASCADE;--> statement-breakpoint
DROP TABLE "ghg_materiality_assessments" CASCADE;--> statement-breakpoint
DROP TABLE "reversal_risk_assessments" CASCADE;--> statement-breakpoint
DROP TABLE "emission_factors" CASCADE;--> statement-breakpoint
DROP TABLE "loss_records" CASCADE;--> statement-breakpoint
DROP TABLE "project_members" CASCADE;--> statement-breakpoint
DROP TABLE "projects" CASCADE;--> statement-breakpoint
DROP TABLE "items" CASCADE;--> statement-breakpoint
ALTER TABLE "certification_submissions" DROP CONSTRAINT "certification_submissions_source_id_certifier_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_batches" DROP CONSTRAINT "credit_batches_reversal_risk_assessment_id_reversal_risk_assessments_id_fk";
--> statement-breakpoint
ALTER TABLE "certification_submissions" DROP COLUMN "source_id";--> statement-breakpoint
ALTER TABLE "credit_batches" DROP COLUMN "reversal_risk_assessment_id";--> statement-breakpoint
ALTER TABLE "production_runs" DROP COLUMN "emission_factors_used";--> statement-breakpoint
DROP TYPE "public"."climate_volatility_risk";--> statement-breakpoint
DROP TYPE "public"."land_tenure_type";--> statement-breakpoint
DROP TYPE "public"."natural_disaster_risk";--> statement-breakpoint
DROP TYPE "public"."operator_track_record";--> statement-breakpoint
DROP TYPE "public"."soil_erosion_risk";