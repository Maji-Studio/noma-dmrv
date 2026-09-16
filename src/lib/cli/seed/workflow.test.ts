import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const calls = vi.hoisted(() => ({ inputs: new Map<string, unknown[]>(), sequence: [] as string[] }));

// Mock the action transport, retaining the exact production Zod boundaries.
// This verifies the dataset without connecting to a database or registry.
async function action<T>(name: string, input: unknown, schema: { parse(input: unknown): T }) {
  const data = schema.parse(input);
  calls.inputs.set(name, [...(calls.inputs.get(name) ?? []), data]);
  calls.sequence.push(name);
  return { success: true as const, data: { ...data, id: randomUUID() } };
}
vi.mock("@/fn/facilities", async () => {
  const s = await import("@/schemas/facilities");
  return { createFacilityFn: (x: unknown) => action("facility", x, s.createFacilitySchema), updateFacilityFn: (x: unknown) => action("facility-code", x, s.updateFacilitySchema) };
});
vi.mock("@/fn/reactors", async () => {
  const s = await import("@/schemas/reactors");
  return { createReactorFn: (x: unknown) => action("reactor", x, s.createReactorSchema) };
});
vi.mock("@/fn/suppliers", async () => {
  const s = await import("@/schemas/suppliers");
  return { createSupplierWithLocationsFn: (x: unknown) => action("supplier", x, s.createSupplierWithLocationsSchema) };
});
vi.mock("@/fn/customers", async () => {
  const s = await import("@/schemas/customers");
  return { createCustomerFn: (x: unknown) => action("customer", x, s.createCustomerSchema), createCustomerLocationFn: (x: unknown) => action("customer-location", x, s.createCustomerLocationSchema) };
});
vi.mock("@/fn/feedstock-types", async () => {
  const s = await import("@/schemas/feedstock-types");
  return { createFeedstockTypeFn: (x: unknown) => action("feedstock-type", x, s.createFeedstockTypeSchema), importIsometricFeedstockTypeFn: vi.fn() };
});
vi.mock("@/fn/formulations", async () => {
  const s = await import("@/schemas/formulations");
  return { createFormulationFn: async (x: unknown) => {
    const result = await action("formulation", x, s.createFormulationSchema);
    return { ...result, data: { ...result.data, ingredients: result.data.ingredients?.map(ingredient => ({ ...ingredient, id: randomUUID() })) } };
  } };
});
vi.mock("@/fn/storage-locations", async () => {
  const s = await import("@/schemas/storage-locations");
  return { createStorageLocationFn: (x: unknown) => action("bin", x, s.createStorageLocationSchema) };
});
vi.mock("@/fn/quick-add", async () => {
  const s = await import("@/schemas/quick-add");
  return { createDriverFn: (x: unknown) => action("driver", x, s.driverQuickAddSchema), createOperatorFn: (x: unknown) => action("operator", x, s.operatorQuickAddSchema), createVehicleFn: (x: unknown) => action("vehicle", x, s.vehicleQuickAddSchema) };
});
vi.mock("@/fn/feedstocks", async () => {
  const s = await import("@/schemas/feedstocks");
  return { createFeedstockFn: (x: unknown) => action("feedstock", x, s.createFeedstockSchema) };
});
vi.mock("@/fn/production-runs", async () => {
  const s = await import("@/schemas/production-runs");
  return { createProductionRunFn: (x: unknown) => action("run", x, s.createProductionRunSchema) };
});
vi.mock("@/fn/credit-batches", async () => {
  const s = await import("@/schemas/credit-batches");
  return { createCreditBatchFn: (x: unknown) => action("batch", x, s.createCreditBatchSchema) };
});
vi.mock("@/fn/samples", async () => {
  const s = await import("@/schemas/samples");
  return { createSampleFn: (x: unknown) => action("sample", x, s.createSampleSchema) };
});
vi.mock("@/fn/biochar-products", async () => {
  const s = await import("@/schemas/biochar-products");
  return { createBiocharProductFn: (x: unknown) => action("product", x, s.createBiocharProductSchema) };
});
vi.mock("@/fn/orders", async () => {
  const s = await import("@/schemas/orders");
  return { createOrderFn: (x: unknown) => action("order", x, s.createOrderSchema) };
});
vi.mock("@/fn/deliveries", async () => {
  const s = await import("@/schemas/deliveries");
  return { createDeliveryFn: (x: Record<string, unknown>) => action("delivery", { ...x, code: x.code || "DL-0001" }, s.createDeliverySchema) };
});
vi.mock("@/fn/product-stock-preview", () => ({ previewProductStockFn: vi.fn(async (input: unknown) => {
  calls.inputs.set("product-preview", [...(calls.inputs.get("product-preview") ?? []), input]);
  return { success: true, data: [{ basisFingerprint: "live-product-basis" }] };
}) }));
vi.mock("@/fn/output-stock", () => ({ previewOutputStockFn: vi.fn(async () => ({ success: true, data: { basisFingerprint: "live-delivery-basis" } })) }));
vi.mock("@/fn/certifier-credentials", () => ({ setOrgCertifierCredentialsFn: vi.fn() }));
vi.mock("@/fn/certification/facility-mapping", () => ({ saveFacilityCertifierMapping: vi.fn(), loadFacilityCertifierMapping: vi.fn() }));
vi.mock("@/fn/certification/feedstock-types", () => ({ loadIsometricFeedstockTypes: vi.fn() }));
vi.mock("@/fn/documents", async () => {
  const s = await import("@/schemas/documents");
  return {
    requestUpload: async (input: unknown) => {
      await action("request-upload", input, s.requestUploadSchema);
      return { success: true, data: { documentId: randomUUID(), storageKey: "org/test/readings.csv" } };
    },
    confirmUpload: (input: unknown) => action("confirm-upload", input, s.confirmUploadSchema),
  };
});
vi.mock("@/lib/storage", () => ({ getStorageProvider: () => ({ name: "local-fs", putObject: vi.fn(async () => { calls.sequence.push("upload-bytes"); }) }) }));
vi.mock("@/fn/production-run-reading-imports", () => ({ importProductionRunReadingsFromDocumentFn: vi.fn(async () => {
  calls.sequence.push("import-readings");
  return { success: true, data: { insertedRows: 96 } };
}) }));

import { setOrgCertifierCredentialsFn } from "@/fn/certifier-credentials";
import { loadFacilityCertifierMapping, saveFacilityCertifierMapping } from "@/fn/certification/facility-mapping";
import { loadIsometricFeedstockTypes } from "@/fn/certification/feedstock-types";
import { importIsometricFeedstockTypeFn } from "@/fn/feedstock-types";
import { registryEnvironment, seedRegistryAndTypes } from "./registry";
import { saveMappingSchema } from "@/schemas/certification";
import { importProductionRunReadingsFromDocumentFn } from "@/fn/production-run-reading-imports";
import { seedReadings } from "./readings";
import { SeedCounts, describeSeedFailure, unwrap } from "./actions";
import { seedInfrastructure } from "./infrastructure";
import { seedProduction } from "./production";
import { seedDistribution } from "./distribution";
import { buildReadingsCsv, READINGS_PER_RUN } from "./readings-csv";
import { parseReadingsCsv } from "@/lib/production-readings/readings-csv";

describe("Mafinga operator-action seed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T20:00:00Z"));
    vi.stubEnv("ISOMETRIC_ACCESS_TOKEN", "");
    vi.stubEnv("ISOMETRIC_CLIENT_SECRET", "");
    calls.inputs.clear(); calls.sequence.length = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.mocked(saveFacilityCertifierMapping).mockReset(); });

  it("validates the entire local chain and passes fresh basis fingerprints with UI mass semantics", async () => {
    const counts = new SeedCounts();
    const infra = await seedInfrastructure(counts);
    await seedProduction(infra, counts);
    await seedDistribution(infra, counts);
    for (const [name, count] of Object.entries({ facility: 1, reactor: 1, supplier: 2, customer: 1, "customer-location": 1, "feedstock-type": 2, formulation: 1, bin: 4, feedstock: 3, run: 3, batch: 1, sample: 3, product: 2, order: 1, delivery: 1, "request-upload": 3, "confirm-upload": 3 })) {
      expect(calls.inputs.get(name), name).toHaveLength(count);
    }
    expect(calls.inputs.get("product-preview")?.[0]).toMatchObject({ massKg: 300 });
    expect(calls.inputs.get("product")?.[0]).toMatchObject({ massKg: 600, status: "testing", basisFingerprint: "live-product-basis", placedAt: "2026-09-15" });
    expect(calls.inputs.get("delivery")?.[0]).toMatchObject({ basisFingerprint: "live-delivery-basis", deliveredWetMassKg: 1000 });
    expect(calls.inputs.get("run")?.[0]).toMatchObject({ status: "complete", startTime: new Date("2026-09-08T05:00:00Z"), endTime: new Date("2026-09-08T13:00:00Z") });
    expect(calls.sequence.filter(name => ["request-upload", "upload-bytes", "confirm-upload", "import-readings"].includes(name))).toEqual(Array(3).fill(["request-upload", "upload-bytes", "confirm-upload", "import-readings"]).flat());
  });

  it("creates exactly 96 valid five-minute readings inside each eight-hour window", () => {
    const start = new Date("2026-09-08T05:00:00Z");
    const parsed = parseReadingsCsv({ csvText: buildReadingsCsv(start).toString(), runWindowStart: start, runWindowEnd: new Date("2026-09-08T13:00:00Z") });
    expect(parsed.inWindowRows).toBe(READINGS_PER_RUN);
    expect(parsed.invalidRequiredRows).toBe(0);
    expect(parsed.droppedRows).toBe(0);
    expect(parsed.readings.at(-1)?.timestamp).toEqual(new Date("2026-09-08T12:55:00Z"));
  });

  const PROJECTS = [{ id: "prj_demo", name: "Tanzania biochar" }];
  function stubCredentialedRegistry(projects = PROJECTS, isProduction = false) {
    vi.stubEnv("ISOMETRIC_ACCESS_TOKEN", "test-token");
    vi.stubEnv("ISOMETRIC_CLIENT_SECRET", "test-secret");
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "test-key");
    vi.mocked(setOrgCertifierCredentialsFn).mockImplementationOnce(async () => {
      calls.sequence.push("credentials");
      return { success: true, data: { verification: { ok: true, message: "Connected" }, status: {} } } as Awaited<ReturnType<typeof setOrgCertifierCredentialsFn>>;
    });
    vi.mocked(loadFacilityCertifierMapping).mockResolvedValueOnce({ success: true, data: { availableProjects: projects, isProduction } } as Awaited<ReturnType<typeof loadFacilityCertifierMapping>>);
    vi.mocked(loadIsometricFeedstockTypes).mockResolvedValueOnce({ success: true, data: [{ id: "ftt_forest", name: "Forestry residues", supplier_reference_id: null }] });
    vi.mocked(importIsometricFeedstockTypeFn).mockImplementationOnce(async input => {
      expect(input).toEqual({ isometricFeedstockTypeId: "ftt_forest", category: "forestry" });
      calls.sequence.push("import-type");
      return { success: true, data: { id: randomUUID() } } as Awaited<ReturnType<typeof importIsometricFeedstockTypeFn>>;
    });
  }

  it("rejects a malformed registry facility ID before any write", () => {
    vi.stubEnv("ISOMETRIC_ACCESS_TOKEN", "test-token");
    vi.stubEnv("ISOMETRIC_CLIENT_SECRET", "test-secret");
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "test-key");
    vi.stubEnv("ISOMETRIC_DEMO_FACILITY_ID", "prj_wrong");
    expect(() => registryEnvironment()).toThrow("fcl_");
  });

  it("stores credentials and skips the mapping when no registry facility ID is set", async () => {
    stubCredentialedRegistry();
    vi.stubEnv("ISOMETRIC_DEMO_FACILITY_ID", "");
    const result = await seedRegistryAndTypes(randomUUID(), new SeedCounts());
    expect(saveFacilityCertifierMapping).not.toHaveBeenCalled();
    expect(calls.sequence.slice(0, 2)).toEqual(["credentials", "import-type"]);
    expect(result.registryStatus).toContain("facility mapping skipped");
    expect(result.registryStatus).toContain("prj_demo");
  });

  it("refuses to guess when the credentials see several projects", async () => {
    stubCredentialedRegistry([...PROJECTS, { id: "prj_other", name: "Other" }]);
    vi.stubEnv("ISOMETRIC_DEMO_PROJECT_ID", "");
    await expect(seedRegistryAndTypes(randomUUID(), new SeedCounts())).rejects.toThrow("ISOMETRIC_DEMO_PROJECT_ID");
  });

  it("saves credentials and maps the discovered project before importing the registry forestry type", async () => {
    stubCredentialedRegistry();
    vi.stubEnv("ISOMETRIC_DEMO_FACILITY_ID", "fcl_demo");
    vi.mocked(saveFacilityCertifierMapping).mockImplementationOnce(async (input) => {
      expect(saveMappingSchema.parse(input)).toMatchObject({ externalProjectId: "prj_demo", externalFacilityId: "fcl_demo" });
      calls.sequence.push("mapping");
      return { success: true, data: {} } as Awaited<ReturnType<typeof saveFacilityCertifierMapping>>;
    });
    const result = await seedRegistryAndTypes(randomUUID(), new SeedCounts());
    expect(calls.sequence.slice(0, 3)).toEqual(["credentials", "mapping", "import-type"]);
    expect(result.registryStatus).toBe("credentials stored + facility mapped to prj_demo");
  });

  it("refuses to map the demo facility against a production registry", async () => {
    stubCredentialedRegistry(PROJECTS, true);
    vi.stubEnv("ISOMETRIC_DEMO_FACILITY_ID", "fcl_demo");
    await expect(seedRegistryAndTypes(randomUUID(), new SeedCounts())).rejects.toThrow("production Isometric registry");
    expect(saveFacilityCertifierMapping).not.toHaveBeenCalled();
  });

  it("never confirms the production prompt on the operator's behalf", async () => {
    stubCredentialedRegistry();
    vi.stubEnv("ISOMETRIC_DEMO_FACILITY_ID", "fcl_demo");
    vi.mocked(saveFacilityCertifierMapping).mockImplementationOnce(async (input) => {
      expect(input.confirmProduction).toBe(false);
      return { success: true, data: {} } as Awaited<ReturnType<typeof saveFacilityCertifierMapping>>;
    });
    await seedRegistryAndTypes(randomUUID(), new SeedCounts());
    expect(saveFacilityCertifierMapping).toHaveBeenCalledTimes(1);
  });

  it("rejects incomplete readings imports instead of claiming success", async () => {
    vi.mocked(importProductionRunReadingsFromDocumentFn).mockResolvedValueOnce({ success: true, data: { insertedRows: 0 } } as Awaited<ReturnType<typeof importProductionRunReadingsFromDocumentFn>>);
    await expect(seedReadings(randomUUID(), new Date("2026-09-08T05:00:00Z"), new SeedCounts())).rejects.toThrow("expected 96 inserted rows, got 0");
  });

  it("summarizes an unexpected failure without leaking values or SQL", () => {
    let zodError: unknown;
    try {
      z.object({ NEXT_PUBLIC_APP_URL: z.string().url() }).parse({ NEXT_PUBLIC_APP_URL: "not-a-url" });
    } catch (error) {
      zodError = error;
    }
    const summary = describeSeedFailure(zodError);
    expect(summary).toContain("NEXT_PUBLIC_APP_URL");
    expect(summary).not.toContain("not-a-url");
    const databaseError = Object.assign(new Error("duplicate key value violates constraint"), { name: "DatabaseError", code: "23505" });
    expect(describeSeedFailure(databaseError)).toBe("DatabaseError. Check application diagnostics.");
    expect(describeSeedFailure(new Error("Registry unreachable"))).toBe("Error: Registry unreachable");
  });

  it("stops on action failure with the step and error", async () => {
    await expect(unwrap("create product", Promise.resolve({ success: false, error: "Insufficient stock" }))).rejects.toThrow("create product: Insufficient stock");
  });
});
