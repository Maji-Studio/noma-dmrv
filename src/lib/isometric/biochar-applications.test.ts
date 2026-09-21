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

  it("includes deduplicated supporting Source IDs", () => {
    expect(
      buildCreateBiocharApplicationRequest({
        ...BASE,
        sourceIds: ["src-photo", "src-logbook", "src-photo"],
      }).source_ids,
    ).toEqual(["src-logbook", "src-photo"]);
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

  it("preserves the first-submission reference and versions superseding Removals", () => {
    const first = buildBiocharApplicationReference({
      applicationId: "app-1",
      creditBatchId: "batch-1",
      environment: "sandbox",
      removalSubmissionVersion: 1,
    });
    const second = buildBiocharApplicationReference({
      applicationId: "app-1",
      creditBatchId: "batch-1",
      environment: "sandbox",
      removalSubmissionVersion: 2,
    });

    expect(first).toBe(
      buildBiocharApplicationReference({
        applicationId: "app-1",
        creditBatchId: "batch-1",
        environment: "sandbox",
      }),
    );
    expect(second).toContain("-s2-v1");
    expect(second).not.toBe(first);
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

describe("Biochar Application evidence reconciliation", () => {
  it("accepts a readback that omits Source links when Sources were requested", () => {
    // Certify's documented Biochar Application response carries no
    // `source_ids`; the accepted create request is the attachment contract.
    const expected = buildCreateBiocharApplicationRequest({ ...BASE, sourceIds: ["src-proof"] });
    expect(biocharApplicationMismatchMessage(remote(), expected)).toBeNull();
  });

  it("still reports non-Source drift when the readback omits Source links", () => {
    const expected = buildCreateBiocharApplicationRequest({ ...BASE, sourceIds: ["src-proof"] });
    expect(
      biocharApplicationMismatchMessage(remote({ application_date: "1999-01-01" }), expected),
    ).toContain("does not match this application");
  });

  it("treats a null Source set like an omitted one", () => {
    // Optional fields may serialize as JSON null; nothing to verify either way.
    const expected = buildCreateBiocharApplicationRequest({ ...BASE, sourceIds: ["src-proof"] });
    expect(biocharApplicationMismatchMessage(remote({ source_ids: null }), expected)).toBeNull();
    expect(
      biocharApplicationMismatchMessage(remote({ source_ids: null }), buildCreateBiocharApplicationRequest(BASE)),
    ).toBeNull();
  });

  it("rejects a present but non-array Source set instead of trusting the request", () => {
    const expected = buildCreateBiocharApplicationRequest({ ...BASE, sourceIds: ["src-proof"] });
    expect(biocharApplicationMismatchMessage(remote({ source_ids: "src-proof" }), expected)).toContain("Source");
    expect(biocharApplicationMismatchMessage(remote({ source_ids: { id: "src-proof" } }), expected)).toContain("Source");
  });

  it("refuses a readback that exposes Source links but lost a requested Source", () => {
    const expected = buildCreateBiocharApplicationRequest({ ...BASE, sourceIds: ["src-proof"] });
    expect(biocharApplicationMismatchMessage(remote({ source_ids: [] }), expected)).toContain("Source");
  });

  it("verifies all requested Sources independent of order", () => {
    const expected = buildCreateBiocharApplicationRequest({ ...BASE, sourceIds: ["src-a", "src-b"] });
    expect(biocharApplicationMismatchMessage(remote({ source_ids: ["src-b", "src-a"] }), expected)).toBeNull();
    expect(biocharApplicationMismatchMessage(remote({ source_ids: ["src-a"] }), expected)).toContain("Source");
  });

  it("rejects unexpected remote Sources even when every expected Source exists", () => {
    const expected = buildCreateBiocharApplicationRequest({ ...BASE, sourceIds: ["src-a"] });
    expect(biocharApplicationMismatchMessage(remote({ source_ids: ["src-a", "src-extra"] }), expected)).toContain("Source");
    expect(biocharApplicationMismatchMessage(remote({ source_ids: ["src-extra"] }), buildCreateBiocharApplicationRequest(BASE))).toContain("Source");
  });
});
