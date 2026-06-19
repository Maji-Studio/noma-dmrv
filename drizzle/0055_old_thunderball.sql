CREATE TABLE "credit_batch_production_runs" (
	"credit_batch_id" uuid NOT NULL,
	"production_run_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_batch_production_runs_credit_batch_id_production_run_id_pk" PRIMARY KEY("credit_batch_id","production_run_id"),
	CONSTRAINT "credit_batch_production_runs_run_unique" UNIQUE("production_run_id")
);
--> statement-breakpoint
ALTER TABLE "credit_batch_production_runs" ADD CONSTRAINT "credit_batch_production_runs_credit_batch_id_credit_batches_id_fk" FOREIGN KEY ("credit_batch_id") REFERENCES "public"."credit_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batch_production_runs" ADD CONSTRAINT "credit_batch_production_runs_production_run_id_production_runs_id_fk" FOREIGN KEY ("production_run_id") REFERENCES "public"."production_runs"("id") ON DELETE no action ON UPDATE no action;