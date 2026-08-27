import { describe, expect, it, vi } from "vitest";
import type { IsometricClient } from "./client";
import {
  BIOCHAR_APPLICATION_DEPARTURE_MASS_KG,
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
  applicationWetMassKg: 12_000,
  fieldSizeHa: 4,
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
  it("uses slice wet mass as arrival and zero as departure", () => {
    expect(buildCreateBiocharApplicationRequest(BASE)).toEqual({
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
        magnitude: BASE.applicationWetMassKg,
        unit: BIOCHAR_APPLICATION_TRUCK_MASS_UNIT,
      },
      truck_mass_on_departure: {
        magnitude: BIOCHAR_APPLICATION_DEPARTURE_MASS_KG,
        unit: BIOCHAR_APPLICATION_TRUCK_MASS_UNIT,
      },
    });
  });

  it("rejects non-positive application mass and field size", () => {
    expect(() =>
      buildCreateBiocharApplicationRequest({ ...BASE, applicationWetMassKg: 0 }),
    ).toThrow(/positive applied biochar mass/i);
    expect(() =>
      buildCreateBiocharApplicationRequest({ ...BASE, fieldSizeHa: 0 }),
    ).toThrow(/field size/i);
  });

  it("builds an environment-scoped stable reference", () => {
    const sandbox = buildBiocharApplicationReference({
      applicationId: "app-1",
      creditBatchId: "batch-1",
      environment: "sandbox",
    });
    const production = buildBiocharApplicationReference({
      applicationId: "app-1",
      creditBatchId: "batch-1",
      environment: "production",
    });
    expect(sandbox).toContain("-sandbox-bca-");
    expect(production).toContain("-production-bca-");
    expect(sandbox).not.toBe(production);
  });

  it("detects payload-critical remote drift", () => {
    expect(
      biocharApplicationMismatchMessage(
        remote({ truck_mass_on_arrival: { magnitude: 11_000, unit: "kg" } }),
        buildCreateBiocharApplicationRequest(BASE),
      ),
    ).toContain("does not match");
  });

  it("accepts Isometric's canonical application-rate and mass units", () => {
    expect(
      biocharApplicationMismatchMessage(
        remote({
          average_application_rate: {
            magnitude: 3,
            unit: "metric_ton / hectare",
          },
          truck_mass_on_arrival: {
            magnitude: 12_000,
            unit: "kilogram",
          },
          truck_mass_on_departure: {
            magnitude: 0,
            unit: "kilogram",
          },
        }),
        buildCreateBiocharApplicationRequest(BASE),
      ),
    ).toBeNull();
  });

  it("rejects an unapproved quantity unit instead of converting it", () => {
    expect(
      biocharApplicationMismatchMessage(
        remote({
          truck_mass_on_arrival: { magnitude: 12_000, unit: "gram" },
        }),
        buildCreateBiocharApplicationRequest(BASE),
      ),
    ).toContain("does not match");
  });

  it("does not accept a verified alias on the wrong quantity field", () => {
    const expected = buildCreateBiocharApplicationRequest(BASE);
    expect(
      biocharApplicationMismatchMessage(
        remote({
          average_application_rate: { magnitude: 3, unit: "kilogram" },
        }),
        expected,
      ),
    ).toContain("does not match");
    expect(
      biocharApplicationMismatchMessage(
        remote({
          truck_mass_on_arrival: {
            magnitude: 12_000,
            unit: "metric_ton / hectare",
          },
        }),
        expected,
      ),
    ).toContain("does not match");
  });
});

describe("Biochar Application reconciliation", () => {
  it("paginates to the exact supplier reference", async () => {
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

    await expect(
      findBiocharApplicationBySupplierReference(
        { get } as unknown as IsometricClient,
        BASE.supplierReferenceId,
      ),
    ).resolves.toMatchObject({ id: "bse-test" });
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
      findBiocharApplicationBySupplierReference(client, BASE.supplierReferenceId),
    ).rejects.toThrow(/Multiple Isometric Biochar Applications/i);
  });
});
