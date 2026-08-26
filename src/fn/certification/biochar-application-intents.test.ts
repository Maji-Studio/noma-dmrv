import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BiocharApplicationRegistryInput } from "@/data-access/certifier-biochar-applications";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({ getInputs: vi.fn() }));

vi.mock("@/data-access/certifier-biochar-applications", () => ({
  getBiocharApplicationRegistryInputs: mocks.getInputs,
}));

import { compileBiocharApplicationIntents } from "./biochar-application-intents";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_APPLICATION_ID = "44444444-4444-4444-8444-444444444444";
const CREDIT_BATCH_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_BATCH_ID = "55555555-5555-4555-8555-555555555555";
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

function batch(
  applicationId = APPLICATION_ID,
  allocatedWetMassKg = 12_000,
  creditBatchId = CREDIT_BATCH_ID,
) {
  return {
    creditBatchId,
    applicationIds: [applicationId],
    applicationSlices: [
      { applicationId, allocatedWetMassKg, allocatedDryMassKg: 10_000 },
    ],
  };
}

function compile(
  memberBatches: Parameters<typeof compileBiocharApplicationIntents>[0]["memberBatches"] = [
    batch(),
  ],
  environment: "sandbox" | "production" = "sandbox",
) {
  return compileBiocharApplicationIntents({ orgCtx, memberBatches, environment });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getInputs.mockResolvedValue([input()]);
});

describe("compileBiocharApplicationIntents", () => {
  it("snapshots the immutable application slice without delivery truck observations", async () => {
    await expect(compile()).resolves.toEqual([
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        creditBatchId: CREDIT_BATCH_ID,
        applicationDate: "2026-04-05",
        allocatedWetMassKg: 12_000,
        fieldSizeHa: 4,
        sourceIds: [],
        storageLocationPayload: expect.objectContaining({
          project_id: "prj-test",
          name: "North Field",
        }),
      }),
    ]);
  });

  it("compiles the same application facts in sandbox and production", async () => {
    const sandbox = await compile([batch()], "sandbox");
    const production = await compile([batch()], "production");

    expect(production).toEqual([
      expect.objectContaining({
        ...sandbox[0],
        supplierReference: expect.stringContaining("-production-bca-"),
      }),
    ]);
    expect(mocks.getInputs).toHaveBeenCalledTimes(2);
  });

  it("partitions a commingled Application into one intent per credit-batch slice", async () => {
    const intents = await compile([
      batch(APPLICATION_ID, 7_000, CREDIT_BATCH_ID),
      batch(APPLICATION_ID, 5_000, SECOND_BATCH_ID),
    ]);

    expect(intents.map((intent) => intent.allocatedWetMassKg)).toEqual([
      7_000,
      5_000,
    ]);
    expect(
      intents.reduce((total, intent) => total + intent.allocatedWetMassKg, 0),
    ).toBe(12_000);
  });

  it("allows multiple Applications to share one Delivery", async () => {
    mocks.getInputs.mockResolvedValue([
      input({ appliedTonnes: 7 }),
      input({
        applicationId: SECOND_APPLICATION_ID,
        applicationCode: "APP-002",
        appliedTonnes: 5,
      }),
    ]);

    await expect(
      compile([
        batch(APPLICATION_ID, 7_000),
        batch(SECOND_APPLICATION_ID, 5_000),
      ]),
    ).resolves.toHaveLength(2);
  });

  it("fails closed for missing genuine site and allocation facts", async () => {
    mocks.getInputs.mockResolvedValue([input({ fieldSizeHa: null })]);
    await expect(compile()).rejects.toThrow(/field size greater than 0 ha/i);

    mocks.getInputs.mockResolvedValue([input({ customerLocationId: null })]);
    await expect(compile()).rejects.toThrow(/no customer location/i);

    mocks.getInputs.mockResolvedValue([input()]);
    await expect(
      compile([{ creditBatchId: CREDIT_BATCH_ID, applicationIds: [APPLICATION_ID] }]),
    ).rejects.toThrow(/one immutable allocation/i);
  });

  it("rejects an immutable slice total that differs from the physical Application", async () => {
    await expect(compile([batch(APPLICATION_ID, 11_999)])).rejects.toThrow(
      /immutable allocations total.*persisted applied mass/i,
    );
  });
});
