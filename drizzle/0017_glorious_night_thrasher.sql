CREATE TABLE "certifier_ghg_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "certifier_provider" DEFAULT 'isometric' NOT NULL,
	"external_project_id" text NOT NULL,
	"reporting_period_end_at" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "certifier_ghg_periods_provider_project_period_unique" UNIQUE("provider","external_project_id","reporting_period_end_at")
);
