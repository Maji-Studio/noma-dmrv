ALTER TABLE "certifier_biochar_applications" DROP CONSTRAINT "certifier_biochar_applications_provider_application_batch_unique";--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "field_size_ha" SET NOT NULL;--> statement-breakpoint
-- The former journal identity did not distinguish superseding Removal
-- submissions. This pre-production journal is reconstructible from stable
-- registry supplier references, so discard its rows instead of fabricating a
-- submission-version association.
DELETE FROM "certifier_biochar_applications";--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD COLUMN "removal_submission_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD CONSTRAINT "certifier_biochar_applications_removal_submission_id_certification_submissions_id_fk" FOREIGN KEY ("removal_submission_id") REFERENCES "public"."certification_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certifier_biochar_applications_removal_submission_id_idx" ON "certifier_biochar_applications" USING btree ("removal_submission_id");--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD CONSTRAINT "certifier_biochar_applications_provider_application_batch_submission_unique" UNIQUE("provider","application_id","credit_batch_id","removal_submission_id");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_field_size_positive" CHECK ("applications"."field_size_ha" > 0);
