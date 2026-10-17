vi.mock("@/data-access/emission-entries", () => ({ listEmissionEntries: vi.fn() }));
vi.mock("@/data-access/emission-line-comments", () => ({ listEmissionLineComments: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: () => true }));
vi.mock("@/data-access/emission-automatic-masses", () => ({ getEmissionAutomaticMasses: vi.fn() }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: vi.fn(), requireOrgScope: vi.fn() }));
import { beforeEach, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import { makeTestOrgContext } from "../../../tests/helpers/test-org";

vi.mock("@/data-access/credit-batches", () => ({ getCreditBatchById: vi.fn() }));
vi.mock("@/data-access/credit-batch-accounting", () => ({ loadCreditBatchRollups: vi.fn() }));
vi.mock("@/data-access/production-runs", () => ({ getProductionRunsForCertification: vi.fn() }));
vi.mock("@/data-access/credit-batch-samples", () => ({ getSamplesByCreditBatchIds: vi.fn() }));
vi.mock("@/data-access/transport-legs", () => ({ getTransportLegsForEntities: vi.fn() }));
vi.mock("@/data-access/biochar-delivery-transport", () => ({ loadBiocharDeliveryTransportLegs: vi.fn() }));
vi.mock("@/data-access/removal-template-observations", () => ({
  getLatestTemplateObservation: vi.fn(),
  getTemplateObservationById: vi.fn(),
}));

import { getCreditBatchById } from "@/data-access/credit-batches";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { listEmissionEntries } from "@/data-access/emission-entries";
import { listEmissionLineComments } from "@/data-access/emission-line-comments";
import { getEmissionAutomaticMasses } from "@/data-access/emission-automatic-masses";
import { getTemplateObservationById } from "@/data-access/removal-template-observations";
import { getLatestTemplateObservation } from "@/data-access/removal-template-observations";
import { loadBatchEmissionLines } from "./batch-emission-lines";
import fixture from "../../../tests/fixtures/isometric/sandbox-template-2026-10-15.json";
import { normalizeTemplateDefinition, resolveLineSources, type GhgEntryTemplate } from "@/lib/isometric/template-observations";
import { withTemplateOrder } from "@/lib/isometric/template-observations/template-order";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listEmissionLineComments).mockResolvedValue([]);
  vi.mocked(getCreditBatchById).mockResolvedValue({
    removalTemplateId: "template",
    facilityId: "facility",
  } as never);
  vi.mocked(getLatestTemplateObservation).mockResolvedValue({} as never);
  vi.mocked(getProductionRunsForCertification).mockResolvedValue([]);
  vi.mocked(getSamplesByCreditBatchIds).mockResolvedValue([]);
});

it("loads saved template order and group names without registry access", async () => {
  const definition = normalizeTemplateDefinition(fixture as GhgEntryTemplate);
  vi.mocked(getLatestTemplateObservation).mockResolvedValue({ externalTemplateId: "template", definition,
    enrichment: {}, lineSources: withTemplateOrder(fixture as GhgEntryTemplate, resolveLineSources({ definition })),
  } as never);
  vi.mocked(listEmissionEntries).mockResolvedValue([]);
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({ batch: { lineageFacts: { runs: [], runForwards: {} } } } as never);
  vi.mocked(getTransportLegsForEntities).mockResolvedValue([]);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([]);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {}, legs: {} });
  const lines = await loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch");
  expect(lines.map(({ componentId, groupName, groupPosition, position }) => ({ componentId, groupName, groupPosition, position })))
    .toEqual(fixture.groups.flatMap((group, groupPosition) => group.components.map((component, position) => ({
      componentId: component.id, groupName: group.display_name, groupPosition, position,
    }))));
});

it("names the first delivery without load mass before requesting any transport legs", async () => {
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
                { id: "also-missing", code: "DL-3", wetMassKg: null },
              ],
            },
          ],
        },
      },
    },
  } as never);
  await expect(loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch")).rejects.toThrowError(
    new SafeError("Delivery DL-2 has no load mass. Add it before submitting."),
  );
  expect(getTransportLegsForEntities).not.toHaveBeenCalled();
  expect(loadBiocharDeliveryTransportLegs).not.toHaveBeenCalled();
});

it("refuses a batch from another facility before loading accounting", async () => {
  vi.mocked(getCreditBatchById).mockResolvedValue({
    facilityId: "other",
    removalTemplateId: "template",
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
  vi.mocked(getLatestTemplateObservation).mockResolvedValue(current as never);
  vi.mocked(getTemplateObservationById).mockResolvedValue(current as never);
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({
    batch: { lineageFacts: { runs: [], runForwards: {} } },
  } as never);
  vi.mocked(getTransportLegsForEntities).mockResolvedValue([]);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([]);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {}, legs: {} });
  vi.mocked(listEmissionEntries).mockResolvedValue([
    {
      id: "entry",
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
  const comment = { id: "comment", componentId: "line", body: "Line context", version: 2, updatedAt: new Date(), updatedBy: "user-id" };
  vi.mocked(listEmissionLineComments).mockResolvedValue([comment] as never);
  const [line] = await loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch");
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
  vi.mocked(getLatestTemplateObservation).mockResolvedValue({
    ...current,
    definition: { groups: [] },
    lineSources: {},
    enrichment: {},
  } as never);
  const [removed] = await loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch");
  expect(removed).toMatchObject({
    label: "Lab electricity",
    entries: [{ id: "entry", counts: false, canConfirm: false }],
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
  vi.mocked(getLatestTemplateObservation).mockResolvedValue(current as never);
  const previous = structuredClone(current);
  previous.enrichment.changed.electricity_use.unit = "kWh";
  vi.mocked(getTemplateObservationById).mockResolvedValue(previous as never);
  vi.mocked(loadCreditBatchRollups).mockResolvedValue({
    batch: { lineageFacts: { runs: [], runForwards: {} } },
  } as never);
  vi.mocked(getTransportLegsForEntities).mockResolvedValue([]);
  vi.mocked(loadBiocharDeliveryTransportLegs).mockResolvedValue([]);
  vi.mocked(getEmissionAutomaticMasses).mockResolvedValue({ runs: {}, legs: {} });
  vi.mocked(listEmissionEntries).mockResolvedValue(
    ["changed", "healthy"].map((componentId) => ({
      id: componentId,
      componentId,
      kind: "value",
      observationId: "confirmed",
      documentCount: 1,
      values: [{ inputKey: "electricity_use", magnitude: "1", unit: "kWh" }],
    })) as never,
  );
  const lines = await loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch");
  expect(lines[0]).toMatchObject({ state: "needsReview", total: null, blocker: { code: "lineNeedsReview", message: "Enter the values again for the current template line." }, entries: [expect.objectContaining({ counts: false, canConfirm: false })] });
  expect(lines[1]).toMatchObject({ state: "filled", total: { magnitude: "1", unit: "kWh" } });
  expect(lines.every((line) => line.comment === null)).toBe(true);
  vi.mocked(listEmissionLineComments).mockResolvedValue([
    { id: "comment", componentId: "healthy", body: "Context", version: 1, updatedAt: new Date(), updatedBy: "user-id" },
    { id: "orphan", componentId: "removed", body: "Old context", version: 1 },
  ] as never);
  const withComments = await loadBatchEmissionLines(makeTestOrgContext(), "facility", "batch");
  expect(withComments[0].comment).toBeNull();
  expect(withComments[1].comment).toMatchObject({ id: "comment", body: "Context" });
  expect(withComments.map((line) => ({ ...line, comment: null }))).toEqual(lines);
});
