import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BiocharApplicationRegistryInput } from "@/data-access/certifier-biochar-applications";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({
  getInputs: vi.fn(),
}));

vi.mock("@/data-access/certifier-biochar-applications", () => ({
  getBiocharApplicationRegistryInputs: mocks.getInputs,
}));

import { compileBiocharApplicationIntents } from "./biochar-application-intents";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const CREDIT_BATCH_ID = "22222222-2222-4222-8222-222222222222";
const orgCtx: OrgContext = {
  organizationId: "org-test",
  userId: "user-test",
  orgRole: "admin",
  isPlatformAdmin: false,
};

function input(
  patch: Partial<BiocharApplicationRegistryInput> = {},
): BiocharApplicationRegistryInput {
  return {
    applicationId: APPLICATION_ID,
    applicationCode: "APP-001",
    applicationDate: new Date("2026-04-05T12:00:00Z"),
    appliedTonnes: 12,
    fieldSizeHa: 4,
    deliveryId: "delivery-1",
    deliveryCode: "DEL-001",
    deliveredWetMassKg: 12_000,
    truckMassOnArrivalKg: 15_000,
    truckMassOnDepartureKg: 3_000,
    facilityId: "facility-1",
    certifierProjectId: "mapping-1",
    externalProjectId: "prj-test",
    customerLocationId: "33333333-3333-4333-8333-333333333333",
    customerLocationName: "North Field",
    latitude: 46.948,
    longitude: 7.447,
    ...patch,
  };
}

function compile(
  memberBatches: Parameters<
    typeof compileBiocharApplicationIntents
  >[0]["memberBatches"] = [
    {
      creditBatchId: CREDIT_BATCH_ID,
      applicationIds: [APPLICATION_ID],
      applicationSlices: [{
        applicationId: APPLICATION_ID,
        allocatedWetMassKg: 12_000,
        allocatedDryMassKg: 10_000,
      }],
    },
  ],
) {
  return compileBiocharApplicationIntents({
    orgCtx,
    memberBatches,
    environment: "sandbox",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getInputs.mockResolvedValue([input()]);
});

describe("compileBiocharApplicationIntents", () => {
  it("deduplicates an Application and snapshots its actual operator facts", async () => {
    const intents = await compile([
      {
        creditBatchId: CREDIT_BATCH_ID,
        applicationIds: [APPLICATION_ID, APPLICATION_ID],
        applicationSlices: [{
          applicationId: APPLICATION_ID,
          allocatedWetMassKg: 12_000,
          allocatedDryMassKg: 10_000,
        }],
      },
    ]);

    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      applicationId: APPLICATION_ID,
      creditBatchId: CREDIT_BATCH_ID,
      applicationDate: "2026-04-05",
      appliedTonnes: 12,
      fieldSizeHa: 4,
      truckMassOnArrivalKg: 15_000,
      truckMassOnDepartureKg: 3_000,
      sourceIds: [],
      storageLocationPayload: {
        project_id: "prj-test",
        name: "North Field",
      },
    });
  });

  it("fails closed when field size is absent or non-positive", async () => {
    mocks.getInputs.mockResolvedValue([input({ fieldSizeHa: null })]);
    await expect(compile()).rejects.toThrow(/field size greater than 0 ha/i);

    mocks.getInputs.mockResolvedValue([input({ fieldSizeHa: 0 })]);
    await expect(compile()).rejects.toThrow(/field size greater than 0 ha/i);
  });

  it("fails closed when observed truck masses are absent", async () => {
    mocks.getInputs.mockResolvedValue([
      input({
        deliveredWetMassKg: 3_000,
        truckMassOnArrivalKg: null,
        truckMassOnDepartureKg: null,
      }),
    ]);

    await expect(compile()).rejects.toThrow(/observed truck masses before and after/i);
  });

  it("keeps explicit truck observations authoritative", async () => {
    mocks.getInputs.mockResolvedValue([
      input({
        deliveredWetMassKg: 12_000,
        truckMassOnArrivalKg: 9_000,
        truckMassOnDepartureKg: 2_000,
      }),
    ]);

    await expect(compile()).resolves.toEqual([
      expect.objectContaining({
        truckMassOnArrivalKg: 9_000,
        truckMassOnDepartureKg: 2_000,
      }),
    ]);
  });

  it("does not replace an explicit invalid arrival observation", async () => {
    mocks.getInputs.mockResolvedValue([
      input({ deliveredWetMassKg: 12_000, truckMassOnArrivalKg: 0 }),
    ]);
    await expect(compile()).rejects.toThrow(/before unloading.*exceeds/i);
  });

  it("compiles one immutable slice per credit batch for a commingled Application", async () => {
    await expect(
      compile([
        {
          creditBatchId: CREDIT_BATCH_ID,
          applicationIds: [APPLICATION_ID],
          applicationSlices: [{
            applicationId: APPLICATION_ID,
            allocatedWetMassKg: 7_000,
            allocatedDryMassKg: 5_600,
          }],
        },
        {
          creditBatchId: "44444444-4444-4444-8444-444444444444",
          applicationIds: [APPLICATION_ID],
          applicationSlices: [{
            applicationId: APPLICATION_ID,
            allocatedWetMassKg: 5_000,
            allocatedDryMassKg: 4_000,
          }],
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        creditBatchId: CREDIT_BATCH_ID,
        appliedTonnes: 7,
      }),
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        creditBatchId: "44444444-4444-4444-8444-444444444444",
        appliedTonnes: 5,
      }),
    ]);
  });

  it("compiles one partial Application slice for a 1000-year Removal", async () => {
    await expect(
      compile([
        {
          creditBatchId: CREDIT_BATCH_ID,
          durabilityOption: "1000_year",
          applicationIds: [APPLICATION_ID],
          applicationSlices: [
            {
              applicationId: APPLICATION_ID,
              allocatedWetMassKg: 7_000,
              allocatedDryMassKg: 5_600,
            },
          ],
        },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        creditBatchId: CREDIT_BATCH_ID,
        appliedTonnes: 7,
      }),
    ]);
  });

  it("rejects a missing immutable slice for a single-batch Application", async () => {
    await expect(
      compile([{ creditBatchId: CREDIT_BATCH_ID, applicationIds: [APPLICATION_ID] }]),
    ).rejects.toThrow(/one immutable allocation for every member credit batch/i);
  });

  it.each([
    [11_999, "under-allocated"],
    [12_001, "over-allocated"],
  ])("rejects %s kg as an %s immutable slice total", async (allocatedWetMassKg) => {
    await expect(
      compile([{
        creditBatchId: CREDIT_BATCH_ID,
        applicationIds: [APPLICATION_ID],
        applicationSlices: [{
          applicationId: APPLICATION_ID,
          allocatedWetMassKg,
          allocatedDryMassKg: 10_000,
        }],
      }]),
    ).rejects.toThrow(/immutable allocations total.*persisted applied mass/i);
  });

  it("fails closed when one delivery is split across multiple Applications", async () => {
    const secondApplicationId = "44444444-4444-4444-8444-444444444444";
    mocks.getInputs.mockResolvedValue([
      input(),
      input({ applicationId: secondApplicationId, applicationCode: "APP-002" }),
    ]);

    await expect(
      compile([
        {
          creditBatchId: CREDIT_BATCH_ID,
          applicationIds: [APPLICATION_ID, secondApplicationId],
          applicationSlices: [
            {
              applicationId: APPLICATION_ID,
              allocatedWetMassKg: 12_000,
              allocatedDryMassKg: 10_000,
            },
            {
              applicationId: secondApplicationId,
              allocatedWetMassKg: 12_000,
              allocatedDryMassKg: 10_000,
            },
          ],
        },
      ]),
    ).rejects.toThrow(/split across Applications APP-001, APP-002/i);
  });

  it("validates chronology after resolving the truck masses", async () => {
    mocks.getInputs.mockResolvedValue([
      input({ truckMassOnArrivalKg: 2_000, truckMassOnDepartureKg: 2_001 }),
    ]);
    await expect(compile()).rejects.toThrow(/before unloading.*exceeds/i);
  });

  it.each([
    [2_000, 2_000],
    [0, 0],
  ])(
    "rejects equal truck masses for a positive application (%d/%d)",
    async (truckMassOnArrivalKg, truckMassOnDepartureKg) => {
      mocks.getInputs.mockResolvedValue([
        input({ truckMassOnArrivalKg, truckMassOnDepartureKg }),
      ]);

      await expect(compile()).rejects.toThrow(/before unloading.*exceeds/i);
    },
  );

  it("leaves production Removal compilation available without application sync", async () => {
    await expect(
      compileBiocharApplicationIntents({
        orgCtx,
        memberBatches: [
          { creditBatchId: CREDIT_BATCH_ID, applicationIds: [APPLICATION_ID] },
        ],
        environment: "production",
      }),
    ).resolves.toEqual([]);
    expect(mocks.getInputs).not.toHaveBeenCalled();
  });
});
