ALTER TABLE "certifier_biochar_applications" DROP CONSTRAINT "certifier_biochar_applications_provider_application_batch_unique";--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD COLUMN "removal_submission_id" uuid;--> statement-breakpoint
ALTER TABLE "certification_submissions" ADD CONSTRAINT "certification_submissions_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
-- Preserve confirmed registry identities by linking each row to the one
-- same-organization Removal submission whose external identity was observed
-- on the Biochar Application. If both provider identity fields point at
-- different submissions, the row is deliberately left unmapped as ambiguous.
WITH "confirmed_submission_matches" AS (
	SELECT
		"application_journal"."id" AS "application_journal_id",
		(array_agg(DISTINCT "submission"."id"))[1] AS "submission_id"
	FROM "certifier_biochar_applications" AS "application_journal"
	INNER JOIN "certification_submissions" AS "submission"
		ON "submission"."organization_id" = "application_journal"."organization_id"
		AND "submission"."provider" = "application_journal"."provider"
		AND "submission"."submission_type" = 'removal'
		AND "submission"."local_entity_type" = 'removal'
		AND "submission"."external_id" IS NOT NULL
		AND (
			"submission"."external_id" = "application_journal"."observed_ghg_entry_id"
			OR "submission"."external_id" = "application_journal"."observed_removal_id"
		)
	WHERE "application_journal"."lifecycle_status" = 'confirmed'
	GROUP BY "application_journal"."id"
	HAVING count(DISTINCT "submission"."id") = 1
)
UPDATE "certifier_biochar_applications" AS "application_journal"
SET "removal_submission_id" = "confirmed_submission_matches"."submission_id"
FROM "confirmed_submission_matches"
WHERE "application_journal"."id" = "confirmed_submission_matches"."application_journal_id";--> statement-breakpoint
-- Creating rows and confirmed rows without one trustworthy observed Removal
-- identity are reconstructible from their stable supplier references. Remove
-- only those unmappable rows; mapped confirmed rows retain external_application_id.
DELETE FROM "certifier_biochar_applications"
WHERE "removal_submission_id" IS NULL;--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ALTER COLUMN "removal_submission_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD CONSTRAINT "certifier_bca_removal_submission_org_fk" FOREIGN KEY ("removal_submission_id","organization_id") REFERENCES "public"."certification_submissions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certifier_biochar_applications_removal_submission_id_idx" ON "certifier_biochar_applications" USING btree ("removal_submission_id");--> statement-breakpoint
ALTER TABLE "certifier_biochar_applications" ADD CONSTRAINT "certifier_biochar_applications_provider_application_batch_submission_unique" UNIQUE("provider","application_id","credit_batch_id","removal_submission_id");
