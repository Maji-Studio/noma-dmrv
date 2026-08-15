import { describe, expect, it, vi } from "vitest";
import type { IsometricClient } from "./client";
import {
  BIOCHAR_APPLICATION_RATE_UNIT,
  BIOCHAR_APPLICATION_TRUCK_MASS_UNIT,
  biocharApplicationMismatchMessage,
  buildBiocharApplicationReference,
  buildCreateBiocharApplicationRequest,
  findBiocharApplicationBySupplierReference,
  type IsometricBiocharApplication,
} from "./biochar-applications";

const BASE = {
  applicationCode: "APP-001",
  applicationDate: "2026-04-05",
  appliedTonnes: 12,
  fieldSizeHa: 4,
  truckMassOnArrivalKg: 15_000,
  truckMassOnDepartureKg: 3_000,
  externalProjectId: "prj-test",
  externalProductionBatchId: "ptb-test",
  externalStorageLocationId: "slc-test",
  supplierReferenceId: "nm-isometric-sandbox-bca-test-v1",
  sourceIds: [],
} as const;

function remote(
  overrides: Partial<IsometricBiocharApplication> = {},
): IsometricBiocharApplication {
  const body = buildCreateBiocharApplicationRequest(BASE);
  return {
    id: "bse-test",
    application_date: body.application_date,
    average_application_rate: body.average_application_rate,
    production_batch_id: body.production_batch_id,
    storage_location_id: body.storage_site_id,
    supplier_reference_id: body.supplier_reference_id,
    truck_mass_on_arrival: body.truck_mass_on_arrival,
    truck_mass_on_departure: body.truck_mass_on_departure,
    ghg_entry_id: "ghg-test",
    removal_id: null,
    uploaded_at: "2026-04-06T00:00:00Z",
    ...overrides,
  };
}

describe("Biochar Application request", () => {
  it("uses the API units, deterministic rate, and exact dependency IDs", () => {
    const body = buildCreateBiocharApplicationRequest(BASE);
    expect(body).toEqual({
      application_date: "2026-04-05",
      average_application_rate: {
        magnitude: 3,
        unit: BIOCHAR_APPLICATION_RATE_UNIT,
      },
      production_batch_id: "ptb-test",
      project_id: "prj-test",
      source_ids: [],
      storage_site_id: "slc-test",
      supplier_reference_id: BASE.supplierReferenceId,
      truck_mass_on_arrival: {
        magnitude: 15_000,
        unit: BIOCHAR_APPLICATION_TRUCK_MASS_UNIT,
      },
      truck_mass_on_departure: {
        magnitude: 3_000,
        unit: BIOCHAR_APPLICATION_TRUCK_MASS_UNIT,
      },
    });
  });

  it("builds a stable environment/provider-scoped reference under 100 chars", () => {
    const first = buildBiocharApplicationReference({
      applicationId: "app-1",
      creditBatchId: "batch-1",
      environment: "sandbox",
    });
    expect(first).toBe(
      buildBiocharApplicationReference({
        applicationId: "app-1",
        creditBatchId: "batch-1",
        environment: "sandbox",
      }),
    );
    expect(first).toMatch(/^nm-isometric-sandbox-bca-.+-v1$/);
    expect(first.length).toBeLessThanOrEqual(100);
  });

  it.each([
    ["field size", { fieldSizeHa: 0 }],
    ["before unloading", { truckMassOnArrivalKg: Number.NaN }],
    ["after unloading", { truckMassOnDepartureKg: -1 }],
    [
      "exceeds",
      { truckMassOnArrivalKg: 100, truckMassOnDepartureKg: 101 },
    ],
  ] as const)("fails closed for invalid magnitudes: %s", (message, overrides) => {
    expect(() =>
      buildCreateBiocharApplicationRequest({ ...BASE, ...overrides }),
    ).toThrow(message);
  });

  it("rejects payload-critical remote drift", () => {
    const body = buildCreateBiocharApplicationRequest(BASE);
    expect(
      biocharApplicationMismatchMessage(
        remote({ production_batch_id: "ptb-other" }),
        body,
      ),
    ).toContain("does not match");
  });
});

describe("Biochar Application reconciliation", () => {
  it("paginates until it finds the exact supplier reference", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        nodes: [remote({ supplier_reference_id: "other" })],
        page_info: { has_next_page: true, end_cursor: "cursor-1" },
        total_count: 2,
      })
      .mockResolvedValueOnce({
        nodes: [remote()],
        page_info: { has_next_page: false, end_cursor: null },
        total_count: 2,
      });
    const client = { get } as unknown as IsometricClient;

    await expect(
      findBiocharApplicationBySupplierReference(
        client,
        BASE.supplierReferenceId,
      ),
    ).resolves.toMatchObject({ id: "bse-test" });
    expect(get).toHaveBeenNthCalledWith(2, "/biochar_applications", {
      query: { first: 50, after: "cursor-1" },
    });
  });

  it("rejects duplicate exact references", async () => {
    const client = {
      get: vi.fn().mockResolvedValue({
        nodes: [remote({ id: "bse-1" }), remote({ id: "bse-2" })],
        page_info: { has_next_page: false, end_cursor: null },
        total_count: 2,
      }),
    } as unknown as IsometricClient;
    await expect(
      findBiocharApplicationBySupplierReference(
        client,
        BASE.supplierReferenceId,
      ),
    ).rejects.toThrow("Multiple Isometric Biochar Applications");
  });
});
