import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProductSourceAllocations, creditBatchApplications, creditBatchProductionRuns, creditBatches, deliveries,
  emissionEntries, emissionEntryValues, removalTemplateObservations,
  outputStockAllocations, outputStockRunAllocations, productionRunFeedstockDraws,
  productionRunFeedstocks, productionRuns, transportLegs,
} from "@/db/schema";
import sandbox from "./fixtures/isometric/sandbox-template-2026-10-15.json";
import { normalizeTemplateDefinition, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { buildBatchEmissionLines } from "@/lib/read-models/batches-emission-lines";
import { deriveEmissionEntryFacts } from "@/lib/certification/emission-entry-facts";
import { getEmissionAllocation } from "@/data-access/emission-allocation";
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import type { EmissionAllocation, GroupKey } from "@/types/emission-allocation";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { aggregateBiocharTransportMassDistance } from "@/lib/isometric/utils/aggregation";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
import { NOT_YET } from "@/types/emission-allocation";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import { insertOutputApplicationFixture } from "./helpers/output-contract-fixtures";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const DISTANCE_KM = 10;
const FEEDSTOCK_KG = 1_000;
const FIRST_DRAW_KG = 600;
const SECOND_DRAW_KG = 400;
const HALF_LOAD_WET_KG = 150;
const DRAFT_APPLIED_KG = 200;
const DRAFT_DELIVERY_KG = 300;
const HALF_LOAD_DRY_KG = 142.5;
const EXPECTED_FEEDSTOCK_TONNE_KM = 20;
const EXPECTED_DELIVERY_PART_TONNE_KM = 3;
const ROLLBACK = new Error("rollback allocation parity fixture");
const ctx = makeTestOrgContext();

beforeAll(() => ensureTestOrg());

function batchTransport(allocation: EmissionAllocation, creditBatchId: string, group: GroupKey) {
  return allocation.records.filter(record => record.group === group).reduce((total, record) => {
    const fraction = record.parts.filter(part => part.key === creditBatchId).reduce((sum, part) => sum + part.fraction, 0);
    if (!fraction) return total;
    const quantity = record.quantities.find(quantity => quantity.unit === "t·km");
    expect(quantity?.value).not.toBeNull();
    return total + fraction * quantity!.value!;
  }, 0);
}

describe("allocation transport parity with the Emissions tab (real database)", () => {
  it("counts the first batch's whole feedstock leg and splits a shared delivery across both batches", async () => {
    await withLineageFixture(async fixture => {
      await expect(db.transaction(async tx => {
        const org = { organizationId: TEST_ORG_ID };
        const site = { ...org, facilityId: fixture.facilityId };
        await tx.update(productionRuns).set({ status: "complete", outputPostedAt: new Date("2026-06-13T12:00:00Z"), endTime: new Date("2026-06-13T12:00:00Z") })
          .where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, fixture.productionRunId)));
        await tx.update(productionRunFeedstocks).set({ wetMassUsedKg: FIRST_DRAW_KG })
          .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), eq(productionRunFeedstocks.productionRunId, fixture.productionRunId)));
        await tx.update(productionRunFeedstockDraws).set({ wetMassKg: FIRST_DRAW_KG })
          .where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), eq(productionRunFeedstockDraws.productionRunId, fixture.productionRunId)));
        const [laterRun] = await tx.insert(productionRuns).values({ ...site, reactorId: fixture.reactorId,
          code: `E2E-ALLOC-PR-${crypto.randomUUID()}`, startTime: new Date("2026-06-14T08:00:00Z"), endTime: new Date("2026-06-14T12:00:00Z"),
          status: "complete", outputPostedAt: new Date("2026-06-14T12:00:00Z"), feedstockWetMassKg: SECOND_DRAW_KG, feedstockMassDryKg: SECOND_DRAW_KG,
          biocharStorageLocationId: fixture.biocharBinId, biocharOutputKg: HALF_LOAD_WET_KG,
          biocharMoisturePercent: 5, biocharDryMassKg: HALF_LOAD_DRY_KG }).returning();
        const [laterBatch] = await tx.insert(creditBatches).values({ ...site, code: `E2E-ALLOC-CB-${crypto.randomUUID()}`,
          feedstockTypeId: fixture.feedstockTypeId, productionProcessId: fixture.productionProcessId,
          startDate: "2026-06-01", endDate: "2026-06-30" }).returning();
        await tx.insert(creditBatchProductionRuns).values({ ...org, creditBatchId: laterBatch.id, productionRunId: laterRun.id });
        await tx.insert(productionRunFeedstocks).values({ ...org, productionRunId: laterRun.id, feedstockId: fixture.feedstockId, wetMassUsedKg: SECOND_DRAW_KG });
        await tx.insert(productionRunFeedstockDraws).values({ ...org, productionRunId: laterRun.id, storageLocationId: fixture.feedstockBinId, wetMassKg: SECOND_DRAW_KG });
        await tx.insert(transportLegs).values({ ...org, entityType: "feedstock", entityId: fixture.feedstockId,
          distanceKm: DISTANCE_KM, loadMassKg: FEEDSTOCK_KG, transportMethodType: "road" });
        await tx.update(deliveries).set({ recordedDistanceKm: DISTANCE_KM, recordedDistanceSource: "manual" })
          .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, fixture.deliveryId)));
        // Keep both the product's saved source weights and the shipped layer's
        // frozen source shares balanced; no allocator or automatic figure is mocked.
        await tx.insert(biocharProductSourceAllocations).values([fixture.productionRunId, laterRun.id].map(productionRunId => ({
          ...org, biocharProductId: fixture.productId, productionRunId, sourceStorageLocationId: fixture.biocharBinId,
          allocatedWetMassKg: HALF_LOAD_WET_KG, allocatedDryMassKg: HALF_LOAD_DRY_KG,
        }))).onConflictDoUpdate({ target: [biocharProductSourceAllocations.biocharProductId, biocharProductSourceAllocations.productionRunId],
          set: { allocatedWetMassKg: HALF_LOAD_WET_KG, allocatedDryMassKg: HALF_LOAD_DRY_KG } });
        const [layer] = await tx.select().from(outputStockAllocations).where(and(
          eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.deliveryId, fixture.deliveryId)));
        await tx.update(outputStockRunAllocations).set({ dryMassKg: String(HALF_LOAD_DRY_KG) }).where(and(
          eq(outputStockRunAllocations.organizationId, ctx.organizationId), eq(outputStockRunAllocations.allocationId, layer.id)));
        await tx.insert(outputStockRunAllocations).values({ ...org, allocationId: layer.id, productionRunId: laterRun.id, dryMassKg: String(HALF_LOAD_DRY_KG) });

        const batchIds = [fixture.batchId, laterBatch.id];
        const allocation = await getEmissionAllocation(ctx, { creditBatchId: fixture.batchId }, tx);
        const automatic = await loadBatchesEmissionAutomaticFacts(ctx, batchIds, {}, tx);
        expect(allocation.batches.map(batch => batch.id).sort()).toEqual([...batchIds].sort());
        expect(allocation.records.filter(record => record.group === "deliveryTransport")).toHaveLength(1);
        expect(allocation.records.find(record => record.id === fixture.feedstockId)?.feedstock?.used)
          .toEqual(expect.arrayContaining([expect.objectContaining({ creditBatchId: laterBatch.id, kg: SECOND_DRAW_KG })]));
        for (const [index, batchId] of batchIds.entries()) {
          for (const [group, source] of [["feedstockTransport", "feedstock-transport"], ["deliveryTransport", "delivery-transport"]] as const) {
            const figure = automatic[batchId].automaticFigures[source];
            expect(figure).not.toBeNull();
            expect(batchTransport(allocation, batchId, group)).toBeCloseTo(Number(figure!.magnitude));
          }
          expect(batchTransport(allocation, batchId, "feedstockTransport")).toBe(index === 0 ? EXPECTED_FEEDSTOCK_TONNE_KM : 0);
          expect(batchTransport(allocation, batchId, "deliveryTransport")).toBe(EXPECTED_DELIVERY_PART_TONNE_KM);
        }
        expect(await getEmissionAllocation(ctx, { removalId: fixture.removalId }, tx)).toEqual(allocation);
        await expect(getEmissionAllocation({ ...ctx, organizationId: `foreign-${crypto.randomUUID()}` }, { creditBatchId: fixture.batchId }, tx))
          .rejects.toThrow("Credit batch or Removal was not found.");
        throw ROLLBACK;
      })).rejects.toBe(ROLLBACK);
    }, "none");
  });
});

describe("manual allocation names (real database)", () => {
  it("matches the Emissions line name, retains removed names and falls back for missing definitions", async () => {
    await withLineageFixture(async fixture => {
      await expect(db.transaction(async tx => {
        const org = { organizationId: ctx.organizationId };
        const template = structuredClone(sandbox) as GhgEntryTemplate;
        const definition = normalizeTemplateDefinition(template);
        const component = definition.groups.flatMap(group => group.components).find(component =>
          component.inputs.some(input => input.key === "volume_of_fuel"))!;
        const input = component.inputs.find(input => input.key === "volume_of_fuel")!;
        const templateId = `allocation-template-${crypto.randomUUID()}`;
        const [previous] = await tx.insert(removalTemplateObservations).values({ ...org, provider: "isometric",
          externalProjectId: "allocation-project", externalTemplateId: templateId,
          semanticFingerprint: "previous", fullFingerprint: "previous", definition, enrichment: {}, lineSources: {},
          lastObservedAt: new Date("2026-06-01T00:00:00Z") }).returning();
        const currentDefinition = structuredClone(definition);
        const currentComponent = currentDefinition.groups.flatMap(group => group.components).find(line => line.id === component.id)!;
        currentComponent.displayName = "Loader diesel usage";
        const removed = structuredClone(component);
        removed.id = "retired-diesel";
        // The old observation retains this component for the Emissions review line.
        definition.groups[0].components.push(removed);
        await tx.update(removalTemplateObservations).set({ definition }).where(and(
          eq(removalTemplateObservations.organizationId, ctx.organizationId), eq(removalTemplateObservations.id, previous.id)));
        const [current] = await tx.insert(removalTemplateObservations).values({ ...org, provider: "isometric",
          externalProjectId: "allocation-project", externalTemplateId: templateId,
          semanticFingerprint: "current", fullFingerprint: "current", definition: currentDefinition, enrichment: {}, lineSources: {},
          lastObservedAt: new Date("2026-06-02T00:00:00Z") }).returning();
        await tx.update(creditBatches).set({ removalTemplateId: templateId }).where(and(
          eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, fixture.batchId)));
        const entries = await tx.insert(emissionEntries).values([component.id, removed.id, "missing-component"].map(componentId => ({
          ...org, creditBatchId: fixture.batchId, removalTemplateId: templateId, observationId: previous.id,
          componentId, inputShape: [input], lineRule: "additive" as const, kind: "value" as const, occurredOn: "2026-06-13",
        }))).returning();
        await tx.insert(emissionEntryValues).values(entries.map(entry => ({ ...org, entryId: entry.id,
          inputKey: input.key, magnitude: "46", unit: "L" })));
        const allocation = await getEmissionAllocation(ctx, { creditBatchId: fixture.batchId }, tx);
        const observations = new Map([[previous.id, { ...previous, definition }], [current.id, current]]);
        const stored = await listEmissionEntriesForBatches(ctx, [fixture.batchId], tx);
        const lines = buildBatchEmissionLines(current, deriveEmissionEntryFacts(stored, current, observations),
          observations, { automaticFigures: {} });
        for (const entry of entries) {
          const record = allocation.records.find(record => record.id === entry.id)!;
          const line = lines.find(line => line.componentId === entry.componentId);
          expect(record.code).toBe(entry.componentId);
          expect(record.detail).toMatchObject({ kind: "manual", componentName: line?.label ?? entry.componentId });
          expect(record.quantities).toEqual([{ value: 46, unit: "L", label: "Diesel" }]);
        }
        expect(allocation.records.find(record => record.id === entries[0].id)?.detail)
          .toMatchObject({ componentName: "Loader diesel usage" });
        throw ROLLBACK;
      })).rejects.toBe(ROLLBACK);
    }, "none");
  });
});


describe("Removal allocation parity with submission (real database)", () => {
  it("previews an unclaimed draft's production and its assigned delivery slice", async () => {
    await withLineageFixture(async fixture => {
      await expect(db.transaction(async tx => {
        const [batch] = await tx.select().from(creditBatches).where(and(
          eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, fixture.batchId)));
        expect(batch.productionEmissionsClaimedByRemovalId).toBeNull();
        expect(batch.productionEmissionsClaimReservedBySubmissionId).toBeNull();
        await tx.insert(transportLegs).values({ organizationId: ctx.organizationId, entityType: "feedstock",
          entityId: fixture.feedstockId, distanceKm: DISTANCE_KM, loadMassKg: FEEDSTOCK_KG, transportMethodType: "road" });
        await tx.update(productionRuns).set({ status: "complete", outputPostedAt: new Date("2026-06-13T12:00:00Z"), endTime: new Date("2026-06-13T12:00:00Z") })
          .where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, fixture.productionRunId)));
        const allocation = await getEmissionAllocation(ctx, { removalId: fixture.removalId }, tx);
        for (const id of [fixture.productionRunId, fixture.feedstockId]) {
          const record = allocation.records.find(record => record.id === id)!;
          expect(record.removalParts).toEqual([{ key: fixture.removalId, fraction: 1,
            basis: [{ kind: "wouldClaim", label: record.code, kg: null }] }]);
        }
        const delivery = allocation.records.find(record => record.id === fixture.deliveryId)!;
        expect(delivery.removalParts.find(part => part.key === fixture.removalId)).toMatchObject({
          fraction: DRAFT_APPLIED_KG / DRAFT_DELIVERY_KG, basis: [{ kind: "wouldClaim", kg: DRAFT_APPLIED_KG }],
        });
        for (const record of allocation.records) expect(record.removalParts.reduce((sum, part) => sum + part.fraction, 0)).toBe(1);
        await tx.update(creditBatchApplications).set({ removalId: null }).where(and(
          eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.creditBatchId, fixture.batchId)));
        const unassigned = await getEmissionAllocation(ctx, { removalId: fixture.removalId }, tx);
        expect(unassigned.records.find(record => record.id === fixture.deliveryId)!.removalParts)
          .toEqual([{ key: NOT_YET, fraction: 1, basis: [{ kind: "notYet", label: delivery.code, kg: DRAFT_DELIVERY_KG }] }]);
        throw ROLLBACK;
      })).rejects.toBe(ROLLBACK);
    }, "none");
  });

  it("claims production once and attributes one batch's delivery to two frozen Removal slices", async () => {
    await withLineageFixture(async fixture => {
      await expect(db.transaction(async tx => {
        const org = { organizationId: ctx.organizationId };
        const [followup] = await insertRemovalFixture(tx, { ...org, facilityId: fixture.facilityId });
        const FOLLOWUP_TONS = 0.05;
        const FOLLOWUP_DRY_TONS = 0.0475;
        const [application] = await insertOutputApplicationFixture(tx, { ...org,
          code: `E2E-ALLOC-AP-${crypto.randomUUID()}`, deliveryId: fixture.deliveryId,
          applicationDate: new Date("2026-06-17T00:00:00Z"), biocharAppliedTons: FOLLOWUP_TONS,
          biocharAppliedDryTons: FOLLOWUP_DRY_TONS, fieldSizeHa: 1,
        }, row => ({ id: row.id }), true);
        await tx.insert(creditBatchApplications).values({ ...org, creditBatchId: fixture.batchId,
          applicationId: application.id, removalId: followup.id,
          allocatedWetMassKg: tonnesToKg(FOLLOWUP_TONS), allocatedDryMassKg: tonnesToKg(FOLLOWUP_DRY_TONS) });
        await tx.update(creditBatches).set({ productionEmissionsClaimedByRemovalId: fixture.removalId })
          .where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, fixture.batchId)));
        await tx.update(deliveries).set({ recordedDistanceKm: DISTANCE_KM, recordedDistanceSource: "manual" })
          .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, fixture.deliveryId)));
        await tx.insert(transportLegs).values({ ...org, entityType: "feedstock", entityId: fixture.feedstockId,
          distanceKm: DISTANCE_KM, loadMassKg: FEEDSTOCK_KG, transportMethodType: "road" });
        await tx.update(productionRuns).set({ status: "complete", outputPostedAt: new Date("2026-06-13T12:00:00Z"), endTime: new Date("2026-06-13T12:00:00Z") })
          .where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, fixture.productionRunId)));
        const allocation = await getEmissionAllocation(ctx, { removalId: followup.id }, tx);
        const record = allocation.records.find(record => record.id === fixture.deliveryId)!;
        expect(record.group).toBe("deliveryTransport");
        expect(allocation.removals).toEqual(expect.arrayContaining([fixture.removalId, followup.id].map(id =>
          expect.objectContaining({ id, creditBatchIds: [fixture.batchId] }))));
        for (const removalId of [fixture.removalId, followup.id]) {
          // Exact submission path: Removal-filtered accounting application lineage ->
          // applied wet transport legs -> the production compiler's biochar aggregator.
          const rollups = await loadCreditBatchRollups(ctx, [fixture.batchId], { removalId }, tx);
          const slices = Object.values(rollups).flatMap(rollup => rollup.lineageFacts.applications.map(application => ({
            deliveryId: application.delivery.id, loadMassKg: tonnesToKg(application.biocharAppliedTons),
          })));
          const legs = await loadBiocharDeliveryTransportLegs(ctx, slices, tx);
          const submitted = aggregateBiocharTransportMassDistance(legs).massDistanceTonneKm;
          expect(submitted).not.toBeNull();
          const fraction = record.removalParts.find(part => part.key === removalId)!.fraction;
          expect(fraction * record.quantities[0].value!).toBeCloseTo(submitted!);
          expect(submitted).toBe(removalId === fixture.removalId ? 4 : 1);
        }
        expect(record.removalParts.find(part => part.key === NOT_YET)!.fraction * record.quantities[0].value!).toBeCloseTo(1);
        for (const source of allocation.records) {
          expect(source.removalParts.reduce((sum, part) => sum + part.fraction, 0)).toBe(1);
        }
        for (const id of [fixture.productionRunId, fixture.feedstockId]) {
          expect(allocation.records.find(record => record.id === id)!.removalParts)
            .toEqual([{ key: fixture.removalId, fraction: 1, basis: [{ kind: "claim",
              label: allocation.records.find(record => record.id === id)!.code, kg: null }] }]);
        }
        // Already-applied mass becomes unassigned when no Removal owns its slice.
        await tx.update(creditBatchApplications).set({ removalId: null }).where(and(
          eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.creditBatchId, fixture.batchId)));
        const unassigned = await getEmissionAllocation(ctx, { creditBatchId: fixture.batchId }, tx);
        expect(unassigned.records.find(record => record.id === fixture.deliveryId)!.removalParts)
          .toEqual([{ key: NOT_YET, fraction: 1, basis: [{ kind: "notYet", label: record.code, kg: 300 }] }]);
        throw ROLLBACK;
      })).rejects.toBe(ROLLBACK);
    }, "none");
  });
});
