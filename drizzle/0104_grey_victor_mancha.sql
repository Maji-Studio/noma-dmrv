DROP INDEX "production_run_feedstocks_organization_id_idx";--> statement-breakpoint
DROP INDEX "biochar_product_source_allocations_organization_id_idx";--> statement-breakpoint
CREATE INDEX "applications_organization_id_delivery_id_application_date_idx" ON "applications" USING btree ("organization_id","delivery_id","application_date");--> statement-breakpoint
CREATE INDEX "production_run_feedstocks_organization_id_production_run_id_idx" ON "production_run_feedstocks" USING btree ("organization_id","production_run_id");--> statement-breakpoint
CREATE INDEX "samples_organization_id_credit_batch_id_sampling_time_idx" ON "samples" USING btree ("organization_id","credit_batch_id","sampling_time") WHERE "samples"."credit_batch_id" is not null;--> statement-breakpoint
CREATE INDEX "biochar_product_source_allocations_org_production_run_idx" ON "biochar_product_source_allocations" USING btree ("organization_id","production_run_id");--> statement-breakpoint
CREATE INDEX "deliveries_organization_id_order_id_delivery_date_idx" ON "deliveries" USING btree ("organization_id","order_id","delivery_date");