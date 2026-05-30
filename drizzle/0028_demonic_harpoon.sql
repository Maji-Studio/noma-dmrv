ALTER TABLE "certifier_project_emissions" DROP CONSTRAINT "certifier_project_emissions_source_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "certifier_project_emissions" ADD CONSTRAINT "certifier_project_emissions_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;