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
      if (reconciled.found === "refused") {
        throw new Error(reconciled.message);
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
      measurement_property: {
        quantity_kind: "mass_fraction_dry_basis",
        qualifier: "total_carbon",
      },
      value: { magnitude: 0.77, standard_deviation: null, unit: "dimensionless" },
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
  submissions = [
    {
      creditBatchId: "batch-1",
      sampleId: "sample-1",
      creditBatchProductMassKg: 1_000,
      operationKey: "pb:batch-1",
      supplierRefId: SUPPLIER_REF,
      body,
      label: "production batch CB-1",
    },
  ],
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
    submissions,
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
          inputKey: "total_carbon_contents",
          creditBatchIds: ["batch-1"],
        },
        mappingRevision: "source-binding-v1",
      },
    ],
    log,
  });
}

function threeSubmissions() {
  return [1, 2, 3].map((index) => {
    const supplierRefId = `nm-mts-removal-pb-batch-s-${index}-v1`;
    return {
      creditBatchId: "batch-1",
      sampleId: `sample-${index}`,
      creditBatchProductMassKg: 1_000,
      operationKey: `pb:batch-1:sample:sample-${index}`,
      supplierRefId,
      body: {
        ...body,
        measured_at: `2026-07-2${index}T00:00:00.000Z`,
        supplier_reference_id: supplierRefId,
      },
      label: `Sample sample-${index}`,
    };
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

  it("reconciles a journaled sample through the supported collection endpoint", async () => {
    mocks.client.paginate.mockImplementation(async function* () {
      yield registrySample();
    });

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

    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.paginate).toHaveBeenCalledWith(
      "/measurement_samples",
    );
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.appendSubmissionJournal).not.toHaveBeenCalled();
  });

  it("fails closed when a journaled supplier reference resolves to a different ID", async () => {
    mocks.client.paginate.mockImplementation(async function* () {
      yield registrySample("mts-unexpected");
    });

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
    ).rejects.toThrow(
      "Registry measurement mts-sampled-1000 does not match submission nm-mts-removal-pb-batch-v1. Ask support to check the registry record.",
    );

    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.appendSubmissionJournal).not.toHaveBeenCalled();
  });

  it("fails closed when a journaled sample is missing from the collection", async () => {
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
    ).rejects.toThrow(
      "Registry measurement mts-sampled-1000 cannot be found. Ask support to check the registry record before submitting again.",
    );

    expect(mocks.client.get).not.toHaveBeenCalled();
    expect(mocks.client.paginate).toHaveBeenCalledWith(
      "/measurement_samples",
    );
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

  it.each([1, 2])(
    "resumes after %i successful Sample creates without duplicating them",
    async (createdCount) => {
      const submissions = threeSubmissions();
      const created = submissions.slice(0, createdCount).map((item, index) =>
        registrySample(`mts-created-${index + 1}`, item.supplierRefId),
      );
      let postIndex = 0;
      mocks.client.post.mockImplementation(async () => {
        if (postIndex === createdCount) {
          throw new Error("simulated registry interruption");
        }
        const sample = created[postIndex];
        postIndex += 1;
        return sample;
      });

      await expect(
        submission({ journaled: {} }, false, submissions),
      ).rejects.toThrow(/simulated registry interruption/);

      const lastJournal = mocks.appendSubmissionJournal.mock.calls.at(-1)?.[2] as
        | { measurementSamples: Array<{ supplierReferenceId: string; measurementSampleId: string }> }
        | undefined;
      expect(lastJournal?.measurementSamples).toHaveLength(createdCount);

      mocks.client.post.mockClear();
      mocks.client.post.mockImplementation(
        async (_path: string, request: CreateMeasurementSampleRequest) =>
          registrySample(
            `mts-created-${request.supplier_reference_id}`,
            request.supplier_reference_id ?? "missing-supplier-reference",
          ),
      );
      mocks.client.paginate.mockImplementation(async function* () {
        yield* created;
      });

      await submission(
        { journaled: lastJournal },
        true,
        submissions,
      );

      expect(mocks.client.post).toHaveBeenCalledTimes(3 - createdCount);
      const postedReferences = mocks.client.post.mock.calls.map(
        (call) => (call[1] as CreateMeasurementSampleRequest).supplier_reference_id,
      );
      expect(postedReferences).toEqual(
        submissions.slice(createdCount).map((item) => item.supplierRefId),
      );
    },
  );

  it("reconciles all Samples after source patching fails without duplicate POSTs", async () => {
    const submissions = threeSubmissions();
    mocks.client.post.mockImplementation(
      async (_path: string, request: CreateMeasurementSampleRequest) =>
        registrySample(
          `mts-created-${request.supplier_reference_id}`,
          request.supplier_reference_id ?? "missing-supplier-reference",
        ),
    );
    mocks.client.patch.mockRejectedValueOnce(
      new Error("simulated source patch failure"),
    );

    await expect(
      submission({ journaled: {} }, false, submissions),
    ).rejects.toThrow(/simulated source patch failure/);
    expect(mocks.client.post).toHaveBeenCalledTimes(3);

    const lastJournal = mocks.appendSubmissionJournal.mock.calls.at(-1)?.[2] as {
      measurementSamples: Array<{
        supplierReferenceId: string;
        measurementSampleId: string;
      }>;
    };
    const remoteSamples = lastJournal.measurementSamples.map((entry) =>
      registrySample(entry.measurementSampleId, entry.supplierReferenceId),
    );
    mocks.client.post.mockClear();
    mocks.client.patch.mockImplementation(
      async (_path: string, request: { source_ids?: string[] }) => ({
        source_ids: request.source_ids ?? [],
      }),
    );
    mocks.client.paginate.mockImplementation(async function* () {
      yield* remoteSamples;
    });

    await submission({ journaled: lastJournal }, true, submissions);

    expect(mocks.client.post).not.toHaveBeenCalled();
    expect(mocks.client.patch).toHaveBeenCalled();
  });
});
