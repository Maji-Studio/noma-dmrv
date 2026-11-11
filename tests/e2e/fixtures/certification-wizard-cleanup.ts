import { and, desc, eq, inArray, notInArray, or } from "drizzle-orm";
import * as schema from "../../../src/db/schema";
import { createDbConnection } from "./db";
import { fixtureOrgId } from "./fixture-org";

/**
 * Tear down the removal the New-Removal wizard creates at "Confirm"
 * (deferred-create groups the batch into a fresh `certifier_removals` row and,
 * on a live submit, writes a `certification_submissions` row). The seed's own
 * `cleanup()` only knows the batch + chain, so the spec calls this BEFORE that
 * cleanup: it releases the batch's application slices, drops any submission
 * rows, then the Removal. A no-op when "Confirm" never ran. Live callers pass
 * their exact seed-owned document IDs to retire Source mappings as well.
 * Returns deleted generated-document keys for live callers to remove from storage.
 */
export async function teardownWizardRemovalForBatch(
  creditBatchId: string,
  seededDocumentIds: readonly string[] = [],
): Promise<string[]> {
  const { db, pool } = createDbConnection();
  const organizationId = fixtureOrgId();
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ removalId: schema.creditBatchApplications.removalId })
        .from(schema.creditBatchApplications)
        .innerJoin(
          schema.certifierRemovals,
          eq(
            schema.certifierRemovals.id,
            schema.creditBatchApplications.removalId,
          ),
        )
        .where(and(
          eq(schema.creditBatchApplications.organizationId, organizationId),
          eq(schema.certifierRemovals.organizationId, organizationId),
          eq(schema.creditBatchApplications.creditBatchId, creditBatchId),
        ))
        .orderBy(
          desc(schema.certifierRemovals.createdAt),
          desc(schema.certifierRemovals.id),
        );
      const removalId = row?.removalId;
      if (!removalId) return [];

      const members = await tx.select({ id: schema.creditBatchApplications.creditBatchId })
        .from(schema.creditBatchApplications).where(and(
          eq(schema.creditBatchApplications.organizationId, organizationId),
          eq(schema.creditBatchApplications.removalId, removalId),
        ));
      const batchIds = [...new Set([creditBatchId, ...members.map((member) => member.id)])];
      const submissions = tx.select({ id: schema.certificationSubmissions.id })
        .from(schema.certificationSubmissions).where(and(
          eq(schema.certificationSubmissions.organizationId, organizationId),
          eq(schema.certificationSubmissions.localEntityId, removalId),
        ));

      // confirmedForRemovalId cannot be nulled on zeros: the zero-owner CHECK
      // requires it. Delete the fixture-owned zeros, including dependent values.
      const zeros = tx.select({ id: schema.emissionEntries.id }).from(schema.emissionEntries).where(and(
        eq(schema.emissionEntries.organizationId, organizationId),
        eq(schema.emissionEntries.confirmedForRemovalId, removalId),
      ));
      await tx.delete(schema.emissionEntryValues).where(and(
        eq(schema.emissionEntryValues.organizationId, organizationId),
        inArray(schema.emissionEntryValues.entryId, zeros),
      ));
      await tx.update(schema.emissionEntries).set({ replacesEntryId: null }).where(and(
        eq(schema.emissionEntries.organizationId, organizationId),
        inArray(schema.emissionEntries.replacesEntryId, zeros),
      ));
      await tx.delete(schema.emissionEntries).where(and(
        eq(schema.emissionEntries.organizationId, organizationId),
        eq(schema.emissionEntries.confirmedForRemovalId, removalId),
      ));
      await tx.update(schema.emissionEntries).set({ sentByRemovalId: null }).where(and(
        eq(schema.emissionEntries.organizationId, organizationId),
        eq(schema.emissionEntries.sentByRemovalId, removalId),
      ));
      await tx.update(schema.emissionEntries).set({ sendReservedBySubmissionId: null }).where(and(
        eq(schema.emissionEntries.organizationId, organizationId),
        inArray(schema.emissionEntries.sendReservedBySubmissionId, submissions),
      ));

      // Application journals FK both the submission and Production Batch. Their
      // site registrations FK the fixture's customer location/project mapping.
      const applicationJournals = and(
        eq(schema.certifierBiocharApplications.organizationId, organizationId),
        or(inArray(schema.certifierBiocharApplications.removalSubmissionId, submissions),
          inArray(schema.certifierBiocharApplications.creditBatchId, batchIds)),
      );
      const sites = await tx.select({ id: schema.certifierBiocharApplications.storageLocationRegistrationId })
        .from(schema.certifierBiocharApplications).where(applicationJournals);
      // Registration can succeed before its application journal is written.
      const fixtureProjects = tx.select({ id: schema.certifierProjects.id })
        .from(schema.certifierProjects).innerJoin(schema.creditBatches,
          eq(schema.creditBatches.facilityId, schema.certifierProjects.facilityId))
        .where(and(
          eq(schema.certifierProjects.organizationId, organizationId),
          eq(schema.creditBatches.organizationId, organizationId),
          eq(schema.creditBatches.id, creditBatchId),
        ));
      await tx.delete(schema.certifierBiocharApplications).where(applicationJournals);
      // Retain site registrations still referenced by another application journal.
      await tx.delete(schema.certifierStorageLocations).where(and(
        eq(schema.certifierStorageLocations.organizationId, organizationId),
        or(
          inArray(schema.certifierStorageLocations.certifierProjectId, fixtureProjects),
          sites.length ? inArray(schema.certifierStorageLocations.id, sites.map((site) => site.id)) : undefined,
        ),
        notInArray(schema.certifierStorageLocations.id, tx.select({ id: schema.certifierBiocharApplications.storageLocationRegistrationId })
          .from(schema.certifierBiocharApplications).where(eq(schema.certifierBiocharApplications.organizationId, organizationId))),
      ));
      await tx.delete(schema.certifierProductionBatches).where(and(
        eq(schema.certifierProductionBatches.organizationId, organizationId),
        inArray(schema.certifierProductionBatches.creditBatchId, batchIds),
      ));

      // Source mappings block seed document deletion. Submit-generated ledgers
      // attach to member credit batches and also need their mappings retired.
      const generatedDocuments = and(
        eq(schema.documents.entityType, "credit_batch"),
        inArray(schema.documents.entityId, batchIds),
      );
      const documents = tx.select({ id: schema.documents.id }).from(schema.documents).where(and(
        eq(schema.documents.organizationId, organizationId),
        or(generatedDocuments, seededDocumentIds.length ? inArray(schema.documents.id, [...seededDocumentIds]) : undefined),
      ));
      await tx.delete(schema.certifierDocumentUploads).where(and(
        eq(schema.certifierDocumentUploads.organizationId, organizationId),
        inArray(schema.certifierDocumentUploads.documentId, documents),
      ));
      const deletedDocuments = await tx.delete(schema.documents)
        .where(and(eq(schema.documents.organizationId, organizationId), generatedDocuments))
        .returning({ storageKey: schema.documents.storageKey });

      await tx
        .update(schema.creditBatchApplications)
        .set({ removalId: null })
        .where(
          and(
            eq(schema.creditBatchApplications.organizationId, organizationId),
            eq(schema.creditBatchApplications.removalId, removalId),
          ),
        );
      // A LIVE submit also stamps the batch's front-loaded production-emissions
      // claim (credit_batches.production_emissions_claimed_by_removal_id); the
      // removal row cannot be deleted while any batch still claims through it.
      await tx
        .update(schema.creditBatches)
        .set({ productionEmissionsClaimedByRemovalId: null })
        .where(
          and(eq(schema.creditBatches.organizationId, organizationId), eq(
            schema.creditBatches.productionEmissionsClaimedByRemovalId,
            removalId,
          )),
        );
      await tx.update(schema.creditBatches).set({ productionEmissionsClaimReservedBySubmissionId: null }).where(and(
        eq(schema.creditBatches.organizationId, organizationId),
        inArray(schema.creditBatches.productionEmissionsClaimReservedBySubmissionId, submissions),
      ));
      await tx
        .delete(schema.certificationSubmissions)
        .where(and(eq(schema.certificationSubmissions.organizationId, organizationId), eq(schema.certificationSubmissions.localEntityId, removalId)));
      await tx
        .delete(schema.certifierRemovals)
        .where(and(eq(schema.certifierRemovals.organizationId, organizationId), eq(schema.certifierRemovals.id, removalId)));
      return deletedDocuments.flatMap(({ storageKey }) => storageKey ? [storageKey] : []);
    });
  } finally {
    await pool.end();
  }
}
