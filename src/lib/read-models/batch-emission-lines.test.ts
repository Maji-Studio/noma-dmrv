import { loadBatchEmissionEntryCarry } from "@/data-access/emission-entry-carry";
vi.mock("@/data-access/emission-entry-carry", () => ({ loadBatchEmissionEntryCarry: vi.fn() }));
import { legacyTransportObservation } from "../../../tests/helpers/legacy-transport-observation";
vi.mock("@/data-access/emission-entries", () => ({ listEmissionEntriesForBatches: vi.fn() }));
vi.mock("@/data-access/emission-line-comments", () => ({ listEmissionLineCommentsForBatches: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/data-access/emission-automatic-masses", () => ({ getEmissionAutomaticMasses: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn(), requireOrgScope: vi.fn() }));
import { assert, beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";

vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/credit-batch-accounting", () => ({ loadCreditBatchRollups: vi.fn() }));
vi.mock("@/data-access/production-runs", () => ({ getProductionRunsForCertification: vi.fn() }));
vi.mock("@/data-access/credit-batch-samples", () => ({ getSamplesByCreditBatchIds: vi.fn() }));
vi.mock("@/data-access/transport-legs", () => ({ getTransportLegsForEntities: vi.fn() }));
vi.mock("@/data-access/biochar-delivery-transport", () => ({ loadBiocharDeliveryTransportLegs: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({
  getLatestTemplateObservations: vi.fn(),
  getTemplateObservationsByIds: vi.fn(),
}));

import { requireOrgFacility } from "@/data-access/utils";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { listEmissionEntriesForBatches } from "@/data-access/emission-entries";
import { listEmissionLineCommentsForBatches } from "@/data-access/emission-line-comments";
import { getEmissionAutomaticMasses } from "@/data-access/emission-automatic-masses";
import { getTemplateObservationsByIds } from "@/data-access/removal-template-observations";
import { getLatestTemplateObservations } from "@/data-access/removal-template-observations";
import { loadBatchEmissionLines } from "./batch-emission-lines";
import { buildBatchEmissionLines } from "./batches-emission-lines";
import { SafeError } from "@/lib/errors";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { normalizeTemplateDefinition, resolveLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { withTemplateOrder } from "@/lib/isometric/template-observations/template-order";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadBatchEmissionEntryCarry).mockResolvedValue([]);
  vi.mocked(listEmissionLineCommentsForBatches).mockResolvedValue([]);
  vi.mocked(getCreditBatchById).mockResolvedValue({
    id: "batch", removalTemplateId: "template",
    facilityId: "facility",
  } as never);
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([]);
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([]);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([]);
  vi.mocked(getProductionRunsForCertification).mockResolvedValue([]);
  vi.mocked(getSamplesByCreditBatchIds).mockResolvedValue([]);
});

async function loadReadyLines() {
  const result = await loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch");
  expect(result).toEqual({ status: "ready", lines: expect.any(Array), storedEntries: expect.any(Array) });
  assert(result.status === "ready");
  return result.lines;
}

it("returns an unpinned template blocker before loading accounting", async () => {
  vi.mocked(getCreditBatchById).mockResolvedValue({
    id: "batch", facilityId: "facility", removalTemplateId: null,
  } as never);
  await expect(loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch")).resolves.toEqual({
    status: "blocked", blocker: "unpinnedTemplate", storedEntries: [],
  });
  expect(getLatestTemplateObservations).toHaveBeenCalledWith(expect.anything(), "isometric", []);
  expect(loadCreditBatchRollups).not.toHaveBeenCalled();
});

it("returns a missing observation as a templateNotFullyRead blocker", async () => {
  await expect(loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch")).resolves.toEqual({
    status: "blocked", blocker: "templateNotFullyRead", storedEntries: [],
  });
  expect(loadCreditBatchRollups).not.toHaveBeenCalled();
});

it("authorizes and delegates with comments enabled", async () => {
  const ctx = makeTestOrgContext();
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([{
    id: "current", externalTemplateId: "template", definition: { groups: [] }, enrichment: {}, lineSources: {},
  }] as never);
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ batch: { lineageFacts: { runs: [], runForwards: {} } } } as never);
  vi.mocked(getTransportLegsForEntities).mockResolvedValue([]);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([]);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {}, legs: {} });
  await loadBatchEmissionLines(ctx, "facility", "batch");
  expect(requireOrgFacility).toHaveBeenCalledExactlyOnceWith(ctx, "facility");
  expect(getCreditBatchById).toHaveBeenCalledExactlyOnceWith(ctx, "batch", { skipPreview: true });
  expect(listEmissionLineCommentsForBatches).toHaveBeenCalledExactlyOnceWith(ctx, ["batch"]);
});

it("keeps a missing batch as a real failure", async () => {
  vi.mocked(getCreditBatchById).mockResolvedValue(null);
  await expect(loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch")).rejects.toThrow(
    new SafeError("Credit batch was not found."),
  );
  expect(loadCreditBatchRollups).not.toHaveBeenCalled();
});

it("propagates observation read failures", async () => {
  const error = new Error("Observation read failed.");
  vi.mocked(getLatestTemplateObservations).mockRejectedValue(error);
  await expect(loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch")).rejects.toBe(error);
  expect(loadCreditBatchRollups).not.toHaveBeenCalled();
});

it("loads saved template order and group names without registry access", async () => {
  const definition = normalizeTemplateDefinition(fixture as GhgEntryTemplate);
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([{ externalTemplateId: "template", definition,
    enrichment: {}, lineSources: withTemplateOrder(fixture as GhgEntryTemplate, resolveLineSources({ definition })),
  }] as never);
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([]);
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ batch: { lineageFacts: { runs: [], runForwards: {} } } } as never);
  vi.mocked(getTransportLegsForEntities).mockResolvedValue([]);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([]);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {}, legs: {} });
  const lines = await loadReadyLines();
  expect(lines.map(({ componentId, groupName, groupPosition, position }) => ({ componentId, groupName, groupPosition, position })))
    .toEqual(fixture.groups.flatMap((group, groupPosition) => group.components.map((component, position) => ({
      componentId: component.id, groupName: group.display_name, groupPosition, position,
    }))));
});

it("shows the lines when a delivery has no load mass, leaving delivery transport unrecorded", async () => {
  const definition = normalizeTemplateDefinition(fixture as GhgEntryTemplate);
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([{ externalTemplateId: "template", definition,
    enrichment: {}, lineSources: withTemplateOrder(fixture as GhgEntryTemplate, resolveLineSources({ definition })),
  }] as never);
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([]);
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({
    batch: {
      lineageFacts: {
        runs: [],
        runForwards: {
          run: [
            {
              deliveries: [
                { id: "complete", code: "DL-1", wetMassKg: 10 },
                { id: "missing", code: "DL-2", wetMassKg: null },
              ],
            },
          ],
        },
      },
    },
  } as never);
  vi.mocked(getTransportLegsForEntities).mockResolvedValue([]);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([]);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {}, legs: {} });
  const lines = await loadReadyLines();
  expect(lines.length).toBeGreaterThan(0);
  expect(loadBiocharDeliveryTransportLegs).toHaveBeenCalledWith(expect.anything(), [{ deliveryId: "complete", loadMassKg: 10 }], expect.anything());
  const delivery = lines.filter((line) => line.contract?.automaticSource === "delivery-transport");
  expect(delivery.length).toBeGreaterThan(0);
  for (const line of delivery) expect(line.automaticFigure).toBeNull();
});

it("refuses a batch from another facility before loading accounting", async () => {
  vi.mocked(getCreditBatchById).mockResolvedValue({
    facilityId: "other",
    id: "batch", removalTemplateId: "template",
  } as never);
  await expect(loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch")).rejects.toThrow(
    "Credit batch was not found.",
  );
  expect(loadCreditBatchRollups).not.toHaveBeenCalled();
});

it("returns typed entry details and retains removed lines for re-entry", async () => {
  const current = {
    externalTemplateId: "template",
    definition: {
      groups: [
        {
          id: "g",
          key: "pyrolysis",
          displayName: "G",
          description: "",
          components: [
            {
              id: "line",
              displayName: "Lab electricity",
              description: "Lab use",
              blueprintKey: "grid_electricity_use",
              inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
            },
          ],
        },
      ],
    },
    enrichment: { line: { electricity_use: { unit: "kWh" } } },
    lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
  };
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([current] as never);
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([{ ...current, id: "previous" }] as never);
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({
    batch: { lineageFacts: { runs: [], runForwards: {} } },
  } as never);
  vi.mocked(getTransportLegsForEntities).mockResolvedValue([]);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([]);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {}, legs: {} });
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue([
    {
      creditBatchId: "batch", id: "entry",
      componentId: "line",
      kind: "value",
      observationId: "previous",
      version: 2,
      occurredOn: "2026-10-15",
      note: null,
      documentCount: 0,
      values: [{ inputKey: "electricity_use", magnitude: "0.1", unit: "kWh", massDistanceDetail: null }],
    },
  ] as never);
  const comment = { creditBatchId: "batch", id: "comment", componentId: "line", body: "Line context", version: 2, updatedAt: new Date(), updatedBy: "user-id" };
  vi.mocked(listEmissionLineCommentsForBatches).mockResolvedValue([comment] as never);
  const [line] = await loadReadyLines();
  expect(line).toMatchObject({
    label: "Lab electricity",
    description: "Lab use",
    unit: "kWh",
    entryPolicy: "additive",
    state: "missingEvidence",
    blocker: { code: "entryMissingEvidence" },
    total: { magnitude: "0.1", unit: "kWh" },
    entries: [{ id: "entry", version: 2, counts: true, documentCount: 0 }],
    comment: { id: comment.id, body: comment.body, version: comment.version, updatedAt: comment.updatedAt, updatedBy: comment.updatedBy },
  });
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([{
    ...current,
    definition: { groups: [] },
    lineSources: {},
    enrichment: {},
  }] as never);
  const [removed] = await loadReadyLines();
  expect(removed).toMatchObject({
    label: "Lab electricity",
    entries: [{ id: "entry", counts: false, canConfirm: false }],
    removedFromTemplate: true,
    comment: null,
  });
});

it("shows re-entry for unit changes and keeps other lines healthy", async () => {
  const current = {
    externalTemplateId: "template",
    definition: {
      groups: [
        {
          id: "g",
          key: "pyrolysis",
          displayName: "G",
          description: "",
          components: ["changed", "healthy"].map((id) => ({
            id,
            displayName: id,
            description: null,
            blueprintKey: "grid_electricity_use",
            inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
          })),
        },
      ],
    },
    enrichment: {
      changed: { electricity_use: { unit: "Wh" } },
      healthy: { electricity_use: { unit: "kWh" } },
    },
    lineSources: Object.fromEntries(
      ["changed", "healthy"].map((id) => [
        id,
        { scope: "operating", entryPolicy: "additive", origin: "reviewed" },
      ]),
    ),
  };
  vi.mocked(getLatestTemplateObservations).mockResolvedValue([current] as never);
  const previous = structuredClone(current);
  previous.enrichment.changed.electricity_use.unit = "kWh";
  vi.mocked(getTemplateObservationsByIds).mockResolvedValue([{ ...previous, id: "confirmed" }] as never);
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({
    batch: { lineageFacts: { runs: [], runForwards: {} } },
  } as never);
  vi.mocked(getTransportLegsForEntities).mockResolvedValue([]);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([]);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {}, legs: {} });
  vi.mocked(listEmissionEntriesForBatches).mockResolvedValue(
    ["changed", "healthy"].map((componentId) => ({
      creditBatchId: "batch", id: componentId,
      componentId,
      kind: "value",
      observationId: "confirmed",
      documentCount: 1,
      values: [{ inputKey: "electricity_use", magnitude: "1", unit: "kWh" }],
    })) as never,
  );
  const lines = await loadReadyLines();
  expect(lines[0]).toMatchObject({ state: "needsReview", total: null, blocker: { code: "lineNeedsReview", message: "Enter the values again for the current template component." }, entries: [expect.objectContaining({ counts: false, canConfirm: false })] });
  expect(lines[1]).toMatchObject({ state: "filled", total: { magnitude: "1", unit: "kWh" }, removedFromTemplate: false });
  expect(lines.every((line) => line.comment === null)).toBe(true);
  vi.mocked(listEmissionLineCommentsForBatches).mockResolvedValue([
    { creditBatchId: "batch", id: "comment", componentId: "healthy", body: "Context", version: 1, updatedAt: new Date(), updatedBy: "user-id" },
    { creditBatchId: "batch", id: "orphan", componentId: "removed", body: "Old context", version: 1 },
  ] as never);
  const withComments = await loadReadyLines();
  expect(withComments[0].comment).toBeNull();
  expect(withComments[1].comment).toMatchObject({ id: "comment", body: "Context" });
  expect(withComments.map((line) => ({ ...line, comment: null }))).toEqual(lines);
});


it("marks a stored legacy pair for review", () => {
  const { observation } = legacyTransportObservation();
  const [line] = buildBatchEmissionLines(observation, [], new Map(), { automaticFigures: {} });
  expect(line.state).toBe("needsReview");
});
