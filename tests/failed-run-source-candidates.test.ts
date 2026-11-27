import { and, eq } from "drizzle-orm";
import { beforeAll, expect, it, vi } from "vitest";
import { db } from "@/db";
import { documents, feedstocks, productionRunFeedstocks } from "@/db/schema";
import { loadProductionClaimFeedstockScope } from "@/data-access/production-source-manifest";
import { resolveScopeForRemoval } from "@/lib/certification/removal-scope";
import { loadEvidenceMirrorSummaryForScope } from "@/lib/certification/evidence-mirror-summary";
import { loadCandidateDocumentsForRemovalForUser } from "@/lib/certification/source-candidates";
import { withFailedRunLineage } from "./helpers/failed-run-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

vi.mock("@/lib/storage", () => ({ getStorageProvider: () => ({ headObject: async () => ({ size: 1 }) }) }));
beforeAll(() => ensureTestOrg());

it("lists and authorises a failed-only intake bill in the Removal Sources reader", async () => {
  const ctx = makeTestOrgContext();
  await withFailedRunLineage(async (fixture, run) => {
    const [existing] = await db.select().from(feedstocks).where(and(
      eq(feedstocks.organizationId, TEST_ORG_ID), eq(feedstocks.id, fixture.feedstockId),
    ));
    const [exclusive] = await db.insert(feedstocks).values({ ...existing, id: undefined,
      code: `FR-EVIDENCE-${crypto.randomUUID()}` }).returning();
    try {
      await db.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID,
        productionRunId: run.id, feedstockId: exclusive.id, wetMassUsedKg: 1 });
      const [document] = await db.insert(documents).values({ organizationId: TEST_ORG_ID,
        entityType: "feedstock", entityId: exclusive.id, documentType: "bill_of_lading",
        fileName: "failed-intake.pdf", mimeType: "application/pdf", fileSizeBytes: 1, uploadStatus: "uploaded",
        storageProvider: "local-fs", storageBucket: "test", storageKey: `test/${crypto.randomUUID()}`,
      }).returning();
      const scope = await resolveScopeForRemoval(ctx, fixture.removalId);
      const counted = await loadProductionClaimFeedstockScope(ctx, scope.memberBatches, fixture.removalId);
      expect(counted.feedstockIds).toContain(exclusive.id);
      expect(await loadEvidenceMirrorSummaryForScope(ctx, { ...scope, transportFeedstockIds: counted.feedstockIds }))
        .toEqual({ total: 1, mirrored: 0 });
      const result = await loadCandidateDocumentsForRemovalForUser(ctx, fixture.removalId);
      expect(result.candidates.filter(candidate => candidate.document.id === document.id)).toMatchObject([{
        lineageEntity: { entityType: "feedstock", entityId: exclusive.id },
        binding: { nomaRole: "feedstock_bill_of_lading" },
      }]);
    } finally {
      await db.delete(documents).where(and(eq(documents.organizationId, TEST_ORG_ID), eq(documents.entityId, exclusive.id)));
      await db.delete(productionRunFeedstocks).where(and(eq(productionRunFeedstocks.organizationId, TEST_ORG_ID), eq(productionRunFeedstocks.feedstockId, exclusive.id)));
      await db.delete(feedstocks).where(and(eq(feedstocks.organizationId, TEST_ORG_ID), eq(feedstocks.id, exclusive.id)));
    }
  }, "none");
});
