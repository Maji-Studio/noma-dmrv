import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BiocharApplicationRegistryInput } from "@/data-access/certifier-biochar-applications";
import type { OrgContext } from "@/lib/auth/server";

const mocks = vi.hoisted(() => ({
  getInputs: vi.fn(),
}));

vi.mock("@/data-access/certifier-biochar-applications", () => ({
  getBiocharApplicationRegistryInputs: mocks.getInputs,
}));

import {
  buildBiocharApplicationRequestFromIntent,
  compileBiocharApplicationIntents,
} from "./biochar-application-intents";

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
  memberBatches = [
    { creditBatchId: CREDIT_BATCH_ID, applicationIds: [APPLICATION_ID] },
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
    await expect(compile()).rejects.toThrow(/after unloading.*exceeds/i);
  });

  it("fails closed when an Application spans multiple credit batches", async () => {
    await expect(
      compile([
        { creditBatchId: CREDIT_BATCH_ID, applicationIds: [APPLICATION_ID] },
        {
          creditBatchId: "44444444-4444-4444-8444-444444444444",
          applicationIds: [APPLICATION_ID],
        },
      ]),
    ).rejects.toThrow(/spans 2 credit batches/i);
  });

  it("validates chronology after resolving the truck masses", async () => {
    mocks.getInputs.mockResolvedValue([
      input({ truckMassOnArrivalKg: 2_000, truckMassOnDepartureKg: 2_001 }),
    ]);
    await expect(compile()).rejects.toThrow(/after unloading.*exceeds/i);
  });

  it("blocks production instead of silently skipping registry resources", async () => {
    await expect(
      compileBiocharApplicationIntents({
        orgCtx,
        memberBatches: [
          { creditBatchId: CREDIT_BATCH_ID, applicationIds: [APPLICATION_ID] },
        ],
        environment: "production",
      }),
    ).rejects.toThrow(/not enabled for production/i);
    expect(mocks.getInputs).not.toHaveBeenCalled();
  });
});
