ALTER TABLE "credit_batches" DROP CONSTRAINT "credit_batches_isometric_max_one_month";--> statement-breakpoint
ALTER TABLE "credit_batches" ADD CONSTRAINT "credit_batches_isometric_max_one_month" CHECK ("credit_batches"."certifier" is distinct from 'isometric'
        or "credit_batches"."end_date" < ("credit_batches"."start_date" + interval '1 month')::date);