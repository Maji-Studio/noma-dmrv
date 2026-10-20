import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  applications, certificationSubmissions, certifierProjects, certifierRemovals,
  creditBatchApplications, creditBatchProductionRuns, feedstocks,
  productionRunFeedstockDraws, productionRunFeedstocks, productionRuns,
  reactors, storageLocations,
} from "@/db/schema";
import { getCreditBatchUndeletableRemovalCodes } from "@/data-access/credit-batch-removal-holders";
import { getProductionBatchRegistryInputs } from "@/data-access/certifier-production-batches";
import { getRecordLock } from "@/data-access/certification-lineage-guards";
import { assertCreditBatchSlicesAreUnassigned } from "@/data-access/credit-batch-certification-lock";
import { createProductionRun, updateProductionRun } from "@/data-access/production-runs";
import { evaluateRemovalBlockers } from "@/fn/certification/removal-blockers-gate";
import { ensureProductionBatchesForCreditBatches } from "@/fn/certification/production-batches";
import type { RemovalSubmissionContext } from "@/fn/certification/certify-context-types";
import { getCreditBatchProductionSpanIssue } from "@/lib/credit-batch-production-span";
import { logger } from "@/lib/log";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import { feedstockFixtureValues } from "./helpers/feedstock-fixture";
import { createProductionRunOutputBin } from "./helpers/production-run-output-bin";
import { insertOutputApplicationFixture, deleteOutputApplicationFixtures } from "./helpers/output-contract-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { makeTemplate } from "./fixtures/submit-removal-templates";
import { reviewedTemplateSources } from "./helpers/template-line-sources";

// Only the registry boundary is faked. Holder reads, lineage, membership and
// production-run writes use the real database and their normal guards.
const remote = vi.hoisted(() => ({
  status: "FAILED_VERIFICATION",
  submitted_at: "2026-07-02T12:00:00Z",
  ghg_entry_ids: ["entry-span-returned"],
}));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: async () => remote }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: vi.fn(async () => ({})) }));

const ctx = makeTestOrgContext();
const SPAN_START = "2026-05-31T08:00:00.000Z";
const WITHIN_SPAN_END = "2026-06-01T08:00:00.000Z";
const MONTH_BOUNDARY = "2026-06-30T08:00:00.000Z";
const RUN_WET_KG = 30;
const RUN_MOISTURE_PERCENT = 20;
const DRAW_WET_KG = 100;
const DRAW_DRY_KG = 80;
const KG_PER_TONNE = 1_000;
const FIELD_SIZE_HA = 1;
const SLICE_WET_KG = 10;
const SLICE_DRY_KG = 8;
const FIRST_VERSION = 1;
const RETRY_VERSION = 2;
const FOREIGN_ORG_ID = "span-holder-foreign-org";

beforeAll(() => ensureTestOrg());

describe("credit batch span refusal with undeletable Removal holders", () => {
  it.each(["submitted", "accepted", "superseded", "statement"] as const)(
    "names a %s holder in readiness and the registration gate",
    async (state) => {
      await withLineageFixture(async f => {
        const [holder] = await db.select().from(certifierRemovals).where(eq(certifierRemovals.id, f.removalId));
        if (state !== "statement") {
          await db.update(certificationSubmissions).set({ status: state }).where(and(
            eq(certificationSubmissions.organizationId, TEST_ORG_ID),
            eq(certificationSubmissions.localEntityId, holder.id),
          ));
          // A later unsuccessful attempt must not hide finalized history.
          await db.insert(certificationSubmissions).values({
            organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
            localEntityType: "removal", localEntityId: holder.id,
            version: RETRY_VERSION, status: "rejected",
          });
        }
        // Legacy data can already have an overlong span at this boundary.
        await db.update(productionRuns).set({ startTime: new Date(SPAN_START), endTime: new Date(MONTH_BOUNDARY) })
          .where(eq(productionRuns.id, f.productionRunId));
        const [draft] = await insertRemovalFixture(db, { organizationId: TEST_ORG_ID, facilityId: f.facilityId });
        const [application] = await insertOutputApplicationFixture(db, {
          organizationId: TEST_ORG_ID, deliveryId: f.deliveryId, code: `AP-SPAN-${draft.id}`,
          applicationDate: new Date("2026-07-01T00:00:00Z"),
          biocharAppliedTons: SLICE_WET_KG / KG_PER_TONNE,
          biocharAppliedDryTons: SLICE_DRY_KG / KG_PER_TONNE, fieldSizeHa: FIELD_SIZE_HA,
        }, row => ({ id: row.id }));
        const [mapping] = await db.insert(certifierProjects).values({
          organizationId: TEST_ORG_ID, facilityId: f.facilityId, provider: "isometric",
          externalProjectId: `prj_${draft.id}`, externalFacilityId: `fcl_${draft.id}`,
        }).returning();
        try {
          await db.insert(creditBatchApplications).values({
            organizationId: TEST_ORG_ID, creditBatchId: f.batchId, applicationId: application.id,
            removalId: draft.id, allocatedWetMassKg: SLICE_WET_KG, allocatedDryMassKg: SLICE_DRY_KG,
          });
          const codes = await getCreditBatchUndeletableRemovalCodes(ctx, [f.batchId], draft.id);
          expect(codes.get(f.batchId)).toEqual([holder.code]);
          expect(await getCreditBatchUndeletableRemovalCodes(ctx, [f.batchId], holder.id)).toEqual(new Map());
          expect(await getCreditBatchUndeletableRemovalCodes(
            { ...ctx, organizationId: FOREIGN_ORG_ID }, [f.batchId], draft.id,
          )).toEqual(new Map());

          const [input] = await getProductionBatchRegistryInputs(ctx, [f.batchId]);
          const expected = getCreditBatchProductionSpanIssue({ ...input, undeletableRemovalCodes: [holder.code] });
          expect(expected).toContain(`Removal ${holder.code} was sent to Isometric and cannot be deleted`);
          expect(expected).not.toContain("Discard or delete");
          expect(expected).not.toContain(draft.code);
          const template = makeTemplate();
          // The gate consumes these prepared context fields before its span
          // check. Registry/template loading is outside this DB contract.
          const readinessContext = {
            mapping, hasOrgCredentials: true, removalTemplate: template,
            lineSources: reviewedTemplateSources(template), templateBlockers: [],
            unresolvedBlueprintKeys: [], blueprintsForTemplate: [],
            feedstockTypeMappingGaps: [], entityReadinessGaps: [],
            memberBatches: [{ id: f.batchId }],
            batchesWithSamples: [{ durabilityOption: "1000_year" }],
          } as unknown as RemovalSubmissionContext;
          expect(await evaluateRemovalBlockers({ orgCtx: ctx, removalId: draft.id, ctx: readinessContext }))
            .toEqual([expect.objectContaining({ message: expected, fixTarget: "batchDetails" })]);
          await expect(ensureProductionBatchesForCreditBatches({
            orgCtx: ctx, removalId: draft.id, submissionRow: { id: crypto.randomUUID() },
            creditBatchIds: [f.batchId], log: logger,
          })).rejects.toThrow(expected!);
        } finally {
          await db.delete(creditBatchApplications).where(eq(creditBatchApplications.removalId, draft.id));
          await deleteOutputApplicationFixtures(db, eq(applications.id, application.id));
          await db.delete(certifierRemovals).where(eq(certifierRemovals.id, draft.id));
          await db.delete(certifierProjects).where(eq(certifierProjects.id, mapping.id));
        }
      }, state === "statement" ? "ghgStatement" : "removal");
    },
  );

  it("allows a cohort-only run end edit across the month boundary after return, while batch dates stay locked", async () => {
    await withLineageFixture(async f => {
      await db.insert(certificationSubmissions).values({
        organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
        localEntityType: "removal", localEntityId: f.removalId, externalId: remote.ghg_entry_ids[0],
        version: FIRST_VERSION, status: "submitted", submittedAt: new Date("2026-06-17T00:00:00Z"),
      });
      await db.update(certificationSubmissions).set({
        metadata: { remoteStatus: remote.status, submittedToVerifierAt: remote.submitted_at, removalIds: remote.ghg_entry_ids },
      }).where(eq(certificationSubmissions.localEntityId, f.ghgStatementId!));
      const outputBinId = await createProductionRunOutputBin(TEST_ORG_ID, f.facilityId);
      const [reactor] = await db.insert(reactors).values({
        organizationId: TEST_ORG_ID, facilityId: f.facilityId, code: `RE-SPAN-${f.batchId}`,
        identifier: "Span edit reactor", reactorType: "auger",
      }).returning();
      const [intake] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, {
        organizationId: TEST_ORG_ID, facilityId: f.facilityId, feedstockTypeId: f.feedstockTypeId,
        storageLocationId: f.feedstockBinId, code: `FS-SPAN-${f.batchId}`, status: "complete",
        massWetKg: DRAW_WET_KG, massDryKg: DRAW_DRY_KG, moistureContentPercent: RUN_MOISTURE_PERCENT,
      })).returning();
      let runId: string | undefined;
      try {
        // The existing run's output was consumed. This second batch member has
        // no product or stock consumer, the case in the issue's open question.
        const run = await createProductionRun(ctx, {
          code: `PR-SPAN-${f.batchId}`, facilityId: f.facilityId, reactorId: reactor.id,
          status: "complete", startTime: new Date(SPAN_START), endTime: new Date(WITHIN_SPAN_END),
          feedstockDraws: [{ storageLocationId: f.feedstockBinId, wetMassKg: DRAW_WET_KG }],
          feedstockMoisturePercent: RUN_MOISTURE_PERCENT,
          biocharStorageLocationId: outputBinId, biocharOutputKg: RUN_WET_KG,
          biocharMoisturePercent: RUN_MOISTURE_PERCENT,
        });
        runId = run.id;
        expect(await db.select({ creditBatchId: creditBatchProductionRuns.creditBatchId })
          .from(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.productionRunId, run.id)))
          .toEqual([{ creditBatchId: f.batchId }]);
        const lock = await db.transaction(tx => getRecordLock(ctx, tx, { entityType: "productionRun", entityId: run.id }));
        expect(lock.level).toBe("inUse");
        expect(lock.freeFields).toContain("endTime");
        expect(lock.returnedBy).toContainEqual(expect.objectContaining({ removalId: f.removalId }));
        const [before] = await getProductionBatchRegistryInputs(ctx, [f.batchId]);
        expect(getCreditBatchProductionSpanIssue(before)).toBeNull();

        const edited = await updateProductionRun(ctx, run.id, { expectedVersion: run.version, endTime: new Date(MONTH_BOUNDARY) });
        expect(edited.endTime).toEqual(new Date(MONTH_BOUNDARY));
        const [after] = await getProductionBatchRegistryInputs(ctx, [f.batchId]);
        expect(after.startedAt).toBe(SPAN_START);
        expect(after.endedAt).toBe(MONTH_BOUNDARY);
        expect(getCreditBatchProductionSpanIssue(after)).toContain("would cover one month or more");
        await expect(db.transaction(tx => assertCreditBatchSlicesAreUnassigned(ctx, tx, f.batchId)))
          .rejects.toMatchObject({ code: "certification_locked" });

        // Return does not remove numeric consumers from the original run.
        const [consumed] = await db.select().from(productionRuns).where(eq(productionRuns.id, f.productionRunId));
        await expect(updateProductionRun(ctx, consumed.id, { expectedVersion: consumed.version, endTime: new Date(MONTH_BOUNDARY) }))
          .rejects.toThrow(/Production stock is used by/);
      } finally {
        if (runId) {
          await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.productionRunId, runId));
          await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, runId));
          await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, runId));
          await db.delete(productionRuns).where(eq(productionRuns.id, runId));
        }
        await db.delete(feedstocks).where(eq(feedstocks.id, intake.id));
        await db.delete(storageLocations).where(eq(storageLocations.id, outputBinId));
        await db.delete(reactors).where(eq(reactors.id, reactor.id));
      }
    }, "ghgStatement");
  });
});
