import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@/lib/log";
import type {
  CreateMeasurementSampleRequest,
  IsometricMeasurementSample,
} from "@/lib/isometric/measurement-samples";
import type { PerformRegistryCreateArgs } from "./registry-create";

const mocks = vi.hoisted(() => ({
  appendSubmissionJournal: vi.fn(),
  client: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    paginate: vi.fn(),
  },
}));

vi.mock("@/data-access/certification", () => ({
  appendSubmissionJournal: mocks.appendSubmissionJournal,
}));

vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/isometric/client")>();
  return {
    ...actual,
    getIsometricClientForOrg: vi.fn(async () => mocks.client),
  };
});

vi.mock("./registry-create", () => ({
  supplierRefLookup: (
    result: { found: true; externalId: string } | { found: false },
  ) =>
    result.found
      ? { found: "single" as const, externalId: result.externalId }
      : { found: "none" as const },
  performRegistryCreate: vi.fn(async (args: PerformRegistryCreateArgs) => {
    if (args.resumed) {
      const reconciled = await args.reconcile();
      if (reconciled.found === "single") {
        await args.onConfirmed?.(reconciled.externalId);
        return {
          externalId: reconciled.externalId,
          source: "reconciliation" as const,
        };
      }
    }
    const externalId = await args.create();
    await args.onConfirmed?.(externalId);
    return { externalId, source: "create" as const };
  }),
}));

import { submitDurabilityMeasurementSamples } from "./durability-measurement-samples";

const SUPPLIER_REF = "nm-mts-removal-pb-batch-v1";
const SAMPLE_ID = "mts-sampled-1000";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

const body: CreateMeasurementSampleRequest = {
  feedstock_batch_id: null,
  measured_at: "2026-07-27T00:00:00.000Z",
  measurement_location_id: null,
  measurement_type: "biochar_production_batch",
  production_batch_id: null,
  project_id: "prj-1",
  storage_location_id: null,
  supplier_reference_id: SUPPLIER_REF,
  values: [
    {
      measurement_property: { quantity_kind: "mass", qualifier: null },
      value: { magnitude: 1_000, standard_deviation: null, unit: "kg" },
    },
  ],
};

function registrySample(
  id = SAMPLE_ID,
  supplierReferenceId = SUPPLIER_REF,
): IsometricMeasurementSample {
  return {
    id,
    measured_at: body.measured_at,
    measurement_location_id: null,
    production_batch_id: null,
    supplier_reference_id: supplierReferenceId,
    values: body.values.map((value, index) => ({
      ...value,
      datapoint_id: `dtp-${id}-${index}`,
    })) as IsometricMeasurementSample["values"],
  };
}

function submission(
  payloadSnapshot: unknown,
  resumed: boolean,
) {
  return submitDurabilityMeasurementSamples({
    orgCtx: {
      organizationId: "org-1",
      userId: "user-1",
      orgRole: "admin",
      isPlatformAdmin: false,
    },
    removalId: "removal-1",
    submissionRow: {
      id: "submission-1",
      payloadSnapshot,
    },
    resumed,
    submissions: [
      {
        operationKey: "pb:batch-1",
        supplierRefId: SUPPLIER_REF,
        body,
        label: "production batch CB-1",
      },
    ],
    sourceBindingPlan: [
      {
        documentId: "document-1",
        sourceId: "source-1",
        nomaRole: "inventory",
        lineage: {
          entityType: "application",
          entityId: "application-1",
          entityLabel: "Application APP-1",
        },
        intendedTarget: {
          kind: "sequestration",
          groupKey: "co2-stored",
          componentId: "component-product-mass",
          componentBlueprintKey: "carbon_rich_substance_sequestration",
          inputKey: "product_mass",
          creditBatchIds: ["batch-1"],
        },
        mappingRevision: "source-binding-v1",
      },
    ],
    log,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.get.mockResolvedValue(registrySample());
  mocks.client.post.mockResolvedValue(registrySample());
  mocks.client.patch.mockImplementation(
    async (_path: string, request: { source_ids?: string[] }) => ({
      source_ids: request.source_ids ?? [],
    }),
  );
  mocks.client.paginate.mockImplementation(async function* () {});
});

describe("measurement-sample journal recovery", () => {
  it("journals a fresh successful supplier-reference mapping before returning", async () => {
    await submission({ journaled: {} }, false);

    expect(mocks.client.post).toHaveBeenCalledOnce();
    expect(mocks.client.patch).toHaveBeenCalledWith(
      `/datapoints/dtp-${SAMPLE_ID}-0`,
      expect.objectContaining({ source_ids: ["source-1"] }),
    );
    expect(mocks.appendSubmissionJournal).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1" }),
      "submission-1",
      {
        measurementSamples: [
          {
            supplierReferenceId: SUPPLIER_REF,
            measurementSampleId: SAMPLE_ID,
          },
        ],
      },
    );
  });

  it("uses a journaled remote ID directly and verifies its supplier reference", async () => {
    await submission(
      {
        journaled: {
          measurementSamples: [
            {
              supplierReferenceId: SUPPLIER_REF,
              measurementSampleId: SAMPLE_ID,
            },
          ],
        },
      },
      true,
    );

    expect(mocks.client.get).toHaveBeenCalledWith(
      `/measurement_samples/${SAMPLE_ID}`,
    );
    expect(mocks.client.paginate).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.appendSubmissionJournal).not.toHaveBeenCalled();
  });

  it("fails closed on a journaled ID whose supplier reference does not match", async () => {
    mocks.client.get.mockResolvedValue(
      registrySample(SAMPLE_ID, "unexpected-reference"),
    );

    await expect(
      submission(
        {
          journaled: {
            measurementSamples: [
              {
                supplierReferenceId: SUPPLIER_REF,
                measurementSampleId: SAMPLE_ID,
              },
            ],
          },
        },
        true,
      ),
    ).rejects.toThrow(/supplier reference mismatch/i);

    expect(mocks.client.paginate).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
  });

  it("does not scan or POST when a journaled ID cannot be read", async () => {
    mocks.client.get.mockRejectedValue(new Error("registry unavailable"));

    await expect(
      submission(
        {
          journaled: {
            measurementSamples: [
              {
                supplierReferenceId: SUPPLIER_REF,
                measurementSampleId: SAMPLE_ID,
              },
            ],
          },
        },
        true,
      ),
    ).rejects.toThrow(/registry unavailable/i);

    expect(mocks.client.paginate).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.appendSubmissionJournal).not.toHaveBeenCalled();
  });

  it("scans only when no journal mapping survived and journals the recovered ID", async () => {
    let yielded = 0;
    mocks.client.paginate.mockImplementation(async function* () {
      for (const sample of [
        registrySample("mts-before", "other-reference"),
        registrySample(),
        registrySample("mts-after", "after-reference"),
      ]) {
        yielded += 1;
        yield sample;
      }
    });

    await submission({ journaled: {} }, true);

    expect(yielded).toBe(2);
    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.appendSubmissionJournal).toHaveBeenCalledWith(
      expect.anything(),
      "submission-1",
      {
        measurementSamples: [
          {
            supplierReferenceId: SUPPLIER_REF,
            measurementSampleId: SAMPLE_ID,
          },
        ],
      },
    );
  });

  it("preserves earlier mappings when journaling another successful sample", async () => {
    await submission(
      {
        journaled: {
          measurementSamples: [
            {
              supplierReferenceId: "nm-mts-earlier",
              measurementSampleId: "mts-earlier",
            },
          ],
        },
      },
      false,
    );

    expect(mocks.appendSubmissionJournal).toHaveBeenCalledWith(
      expect.anything(),
      "submission-1",
      {
        measurementSamples: [
          {
            supplierReferenceId: "nm-mts-earlier",
            measurementSampleId: "mts-earlier",
          },
          {
            supplierReferenceId: SUPPLIER_REF,
            measurementSampleId: SAMPLE_ID,
          },
        ],
      },
    );
  });
});
