CREATE TABLE "production_processes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"feedstock_type_id" uuid NOT NULL,
	"established_at" timestamp DEFAULT now() NOT NULL,
	"sampling_method" "sampling_method" DEFAULT 'method_a' NOT NULL,
	"method_b_unlocked_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "samples" ALTER COLUMN "production_run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "feedstock_type_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD COLUMN "production_process_id" uuid;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "credit_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "production_processes" ADD CONSTRAINT "production_processes_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processes" ADD CONSTRAINT "production_processes_feedstock_type_id_feedstock_types_id_fk" FOREIGN KEY ("feedstock_type_id") REFERENCES "public"."feedstock_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_processes" ADD CONSTRAINT "production_processes_id_facility_feedstock_unique" UNIQUE("id","facility_id","feedstock_type_id");--> statement-breakpoint
CREATE INDEX "production_processes_facility_feedstock_idx" ON "production_processes" USING btree ("facility_id","feedstock_type_id");--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_feedstock_type_id_feedstock_types_id_fk" FOREIGN KEY ("feedstock_type_id") REFERENCES "public"."feedstock_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_production_process_id_production_processes_id_fk" FOREIGN KEY ("production_process_id") REFERENCES "public"."production_processes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DO $$
DECLARE
	duplicate_run_count integer;
BEGIN
	WITH legacy_membership AS (
		SELECT DISTINCT
			cba.credit_batch_id,
			bp.linked_production_run_id AS production_run_id
		FROM credit_batch_applications cba
		INNER JOIN applications a ON a.id = cba.application_id
		INNER JOIN deliveries d ON d.id = a.delivery_id
		LEFT JOIN orders o ON o.id = d.order_id
		INNER JOIN biochar_products bp ON bp.id = coalesce(d.biochar_product_id, o.biochar_product_id)
		WHERE bp.linked_production_run_id IS NOT NULL
	),
	duplicate_runs AS (
		SELECT production_run_id
		FROM legacy_membership
		GROUP BY production_run_id
		HAVING count(DISTINCT credit_batch_id) > 1
	)
	SELECT count(*)
	INTO duplicate_run_count
	FROM duplicate_runs;

	IF duplicate_run_count > 0 THEN
		RAISE EXCEPTION 'Cannot backfill credit_batch_production_runs: % production run(s) are linked to more than one legacy credit batch', duplicate_run_count;
	END IF;
END $$;--> statement-breakpoint
INSERT INTO credit_batch_production_runs ("credit_batch_id", "production_run_id")
SELECT DISTINCT
	cba.credit_batch_id,
	bp.linked_production_run_id
FROM credit_batch_applications cba
INNER JOIN applications a ON a.id = cba.application_id
INNER JOIN deliveries d ON d.id = a.delivery_id
LEFT JOIN orders o ON o.id = d.order_id
INNER JOIN biochar_products bp ON bp.id = coalesce(d.biochar_product_id, o.biochar_product_id)
WHERE bp.linked_production_run_id IS NOT NULL;--> statement-breakpoint
DO $$
DECLARE
	invalid_batch_count integer;
BEGIN
	WITH batch_feedstocks AS (
		SELECT
			cb.id AS credit_batch_id,
			count(DISTINCT fs.feedstock_type_id) AS feedstock_type_count,
			min(fs.feedstock_type_id::text)::uuid AS feedstock_type_id
		FROM credit_batches cb
		LEFT JOIN credit_batch_production_runs cbpr ON cbpr.credit_batch_id = cb.id
		LEFT JOIN production_run_feedstocks prf ON prf.production_run_id = cbpr.production_run_id
		LEFT JOIN feedstocks fs ON fs.id = prf.feedstock_id
		GROUP BY cb.id
	)
	SELECT count(*)
	INTO invalid_batch_count
	FROM batch_feedstocks
	WHERE feedstock_type_id IS NULL OR feedstock_type_count <> 1;

	IF invalid_batch_count > 0 THEN
		RAISE EXCEPTION 'Cannot backfill credit_batches.feedstock_type_id: % existing credit batch(es) have no linked feedstock or span multiple feedstock types', invalid_batch_count;
	END IF;
END $$;--> statement-breakpoint
WITH batch_feedstocks AS (
	SELECT
		cb.id AS credit_batch_id,
		cb.facility_id,
		min(fs.feedstock_type_id::text)::uuid AS feedstock_type_id
	FROM credit_batches cb
	INNER JOIN credit_batch_production_runs cbpr ON cbpr.credit_batch_id = cb.id
	INNER JOIN production_run_feedstocks prf ON prf.production_run_id = cbpr.production_run_id
	INNER JOIN feedstocks fs ON fs.id = prf.feedstock_id
	GROUP BY cb.id, cb.facility_id
)
INSERT INTO production_processes ("facility_id", "feedstock_type_id")
SELECT DISTINCT bf.facility_id, bf.feedstock_type_id
FROM batch_feedstocks bf
WHERE NOT EXISTS (
	SELECT 1
	FROM production_processes pp
	WHERE pp.facility_id = bf.facility_id
		AND pp.feedstock_type_id = bf.feedstock_type_id
);--> statement-breakpoint
WITH batch_feedstocks AS (
	SELECT
		cb.id AS credit_batch_id,
		cb.facility_id,
		min(fs.feedstock_type_id::text)::uuid AS feedstock_type_id
	FROM credit_batches cb
	INNER JOIN credit_batch_production_runs cbpr ON cbpr.credit_batch_id = cb.id
	INNER JOIN production_run_feedstocks prf ON prf.production_run_id = cbpr.production_run_id
	INNER JOIN feedstocks fs ON fs.id = prf.feedstock_id
	GROUP BY cb.id, cb.facility_id
)
UPDATE credit_batches cb
SET
	feedstock_type_id = bf.feedstock_type_id,
	production_process_id = (
		SELECT pp.id
		FROM production_processes pp
		WHERE pp.facility_id = bf.facility_id
			AND pp.feedstock_type_id = bf.feedstock_type_id
		ORDER BY pp.established_at DESC, pp.created_at DESC, pp.id DESC
		LIMIT 1
	)
FROM batch_feedstocks bf
WHERE cb.id = bf.credit_batch_id;--> statement-breakpoint
ALTER TABLE "credit_batches" ALTER COLUMN "feedstock_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batches" ALTER COLUMN "production_process_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_process_identity_fk" FOREIGN KEY ("production_process_id","facility_id","feedstock_type_id") REFERENCES "public"."production_processes"("id","facility_id","feedstock_type_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_credit_batch_id_credit_batches_id_fk" FOREIGN KEY ("credit_batch_id") REFERENCES "public"."credit_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP TRIGGER IF EXISTS reactor_method_b_minimum_samples ON reactors;--> statement-breakpoint
DROP FUNCTION IF EXISTS enforce_reactor_method_b_minimum_samples();--> statement-breakpoint
ALTER TABLE "reactors" DROP COLUMN "sampling_method";--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_isometric_max_one_month" CHECK ("credit_batches"."certifier" is distinct from 'isometric'
        or "credit_batches"."end_date" <= ("credit_batches"."start_date" + interval '1 month')::date);
