import { afterEach, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { certifierDocumentUploads, productionRuns } from "@/db/schema";
import { attachEmissionLineFile } from "@/data-access/emission-line-files";
import { confirmDocumentUploadInTransaction, uploadFactsFor } from "@/data-access/document-writes";
import { insertOrGetDocumentUpload } from "@/data-access/certifier-document-uploads";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { loadRemovalSourceContext } from "@/lib/certification/emission-entry-source-context";
import { collectCandidateSourceDocumentsForRemoval, resolveSourceBindingCandidates } from "@/lib/certification/source-candidates";
import { buildRemovalSourceBindingPlan } from "@/lib/certification/removal-source-bindings";
import { resolveTemplateInputs } from "@/lib/certification/removal-template-inputs";
import { deriveRemovalEmissionLines } from "@/lib/certification/removal-emission-lines";
import { aggregateProductionRuns, enrichWithTransportLegs } from "@/lib/isometric/utils/aggregation";
import type { IsometricComponentBlueprint } from "@/lib/isometric";
import { createEmissionLineFileFixture, cleanupEmissionLineFileFixture, COMPONENT_ID, FILE_UPLOAD, FILE_STORAGE,
  type EmissionLineFileFixture } from "./helpers/emission-line-file-fixture";
import { lineFileEvidenceFacts } from "./helpers/line-file-evidence-facts";

const ELECTRICITY_KWH = 0.5;
const SHA256_LENGTH = 64;
let fixture: EmissionLineFileFixture | undefined;
afterEach(async () => {
  if (!fixture) return;
  await db.delete(certifierDocumentUploads).where(eq(certifierDocumentUploads.organizationId, fixture.ctx.organizationId));
  await cleanupEmissionLineFileFixture(fixture);
  fixture = undefined;
});

it("builds the run electricity Datapoint with its uploaded credit batch file Source", async () => {
  const f = fixture = await createEmissionLineFileFixture();
  await db.update(productionRuns).set({ electricityKwh: ELECTRICITY_KWH }).where(and(
    eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, f.run.id),
  ));
  const pending = await attachEmissionLineFile(f.ctx, { creditBatchId: f.batch.id, componentId: COMPONENT_ID, upload: FILE_UPLOAD }, FILE_STORAGE);
  expect((await loadRemovalSourceContext(f.ctx, f.removal.id))?.lineFileEvidence).toEqual([]);
  const confirmed = await db.transaction(tx => confirmDocumentUploadInTransaction(f.ctx, tx, { ...uploadFactsFor(pending),
    finalKey: `confirmed/${pending.id}`, inspectedSizeBytes: FILE_UPLOAD.sizeBytes, inspectedContentType: FILE_UPLOAD.contentType,
    inspectedSha256: "a".repeat(SHA256_LENGTH),
  }));
  expect(confirmed.kind).toBe("uploaded");
  const sourceId = `source-${pending.id}`;
  await insertOrGetDocumentUpload(f.ctx, { documentId: pending.id, provider: "isometric", externalDocumentId: sourceId,
    metadata: { mirroredBy: f.ctx.userId, supplierRefId: pending.id, contentLength: FILE_UPLOAD.sizeBytes,
      contentType: FILE_UPLOAD.contentType, isPublic: false },
  });
  const context = (await loadRemovalSourceContext(f.ctx, f.removal.id))!;
  expect(context.batchFacts[f.batch.id].automaticFigures["run-electricity"]).toEqual({ magnitude: "0.5", unit: "kWh" });
  expect(context.lineFileEvidence).toMatchObject([{ creditBatchId: f.batch.id, componentId: COMPONENT_ID, documentId: pending.id }]);
  const candidates = await collectCandidateSourceDocumentsForRemoval(f.ctx, { removalId: f.removal.id, lineages: [],
    entryContributions: context.contributions, lineFileEvidence: context.lineFileEvidence });
  const resolved = await resolveSourceBindingCandidates(f.ctx, { candidates });
  const { template } = lineFileEvidenceFacts();
  template.id = f.observation.externalTemplateId;
  template.groups[0].components[0].id = COMPONENT_ID;
  const sourceBindingPlan = buildRemovalSourceBindingPlan({ template, lineSources: f.observation.lineSources,
    lineFileEvidence: context.lineFileEvidence, candidates: resolved.filter(candidate => candidate.binding !== null)
      .map(candidate => ({ ...candidate, binding: candidate.binding! })), applicationIdsByCreditBatchId: new Map() });
  const runs = await getProductionRunsForCertification(f.ctx, [f.run.id]);
  const agg = { ...enrichWithTransportLegs(aggregateProductionRuns(runs), { feedstock: [], biochar: [], sample: [] }),
    weightedOrganicCarbonPercent: null, weightedHToCorgRatio: null, weightedOToCorgRatio: null };
  const definition = { groups: f.observation.definition.groups.map(group => ({ ...group,
    components: group.components.filter(component => component.id === COMPONENT_ID) })) };
  const emissionLines = deriveRemovalEmissionLines({ [f.batch.id]: { ...context.batchFacts[f.batch.id], definition,
    lineSources: f.observation.lineSources, enrichmentComplete: true, problems: [],
  } }, context.contributions).emissionLinesByBatchId[f.batch.id];
  const built = resolveTemplateInputs({ template, lineSources: f.observation.lineSources, emissionLines,
    entryContributions: context.contributions, blueprintsByKey: new Map([["grid_electricity_use", {
      key: "grid_electricity_use", inputs: [{ input_key: "electricity_use", quantity_kind: "energy", compatible_unit: "kWh", data_shape: "SCALAR" }],
    } as IsometricComponentBlueprint]]), agg, externalProjectId: "project", sourceIds: [sourceId], sourceBindingPlan, omitProductionComponents: false });
  expect(built.monitored).toMatchObject([{ inputKey: "electricity_use", quantity: { magnitude: ELECTRICITY_KWH, unit: "kWh" } }]);
  expect([...built.datapointBodyByKey.values()]).toEqual([expect.objectContaining({ source_ids: [sourceId] })]);
});
