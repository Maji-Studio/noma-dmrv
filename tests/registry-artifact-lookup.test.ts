/**
 * Supplier-reference reconciliation for the three Certify artifacts a Removal
 * registers first, run against the fake registry: the create and finder
 * functions are real, and so is the client's pagination. No database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/isometric/client")>();
  const { createFakeClientModule } = await import("./fixtures/fake-registry");
  return createFakeClientModule(actual);
});

import {
  getIsometricClientFromEnv,
  IsometricApiError,
  IsometricPageLimitError,
} from "@/lib/isometric/client";
import {
  createBiocharApplication,
  findBiocharApplicationBySupplierReference,
  getBiocharApplication,
  type CreateBiocharApplicationRequest,
} from "@/lib/isometric/biochar-applications";
import {
  createProductionBatch,
  findProductionBatchBySupplierRef,
  getProductionBatch,
  type CreateProductionBatchRequest,
} from "@/lib/isometric/production-batches";
import {
  createStorageLocation,
  findStorageLocationBySupplierReference,
  getStorageLocation,
  type CreateStorageLocationRequest,
} from "@/lib/isometric/storage-locations";
import {
  installFakeRegistry,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";

const PROJECT_ID = "prj_fake";
const OTHER_PROJECT_ID = "prj_other";
// More than one fake page (50), so every lookup crosses a cursor.
const FILLER_RECORDS = 60;

let registry: FakeIsometricRegistry;
const client = () => getIsometricClientFromEnv();

beforeEach(() => {
  registry = installFakeRegistry();
});

/** The registry kept the record; only the response was lost. */
async function expectDroppedCreate(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(IsometricApiError);
  expect(error).toMatchObject({ code: "network" });
}

describe("Production Batch reconciliation through the fake registry", () => {
  const body = (ref: string) =>
    ({ supplier_reference_id: ref }) as unknown as CreateProductionBatchRequest;

  it("finds a batch whose create response was lost, past the first page", async () => {
    for (let index = 0; index < FILLER_RECORDS; index += 1) {
      await createProductionBatch(client(), body(`filler-${index}`));
    }
    registry.failNext("POST /production_batches", "drop-after-commit");
    await expectDroppedCreate(createProductionBatch(client(), body("nm-pb-lost")));

    const found = await findProductionBatchBySupplierRef(client(), "nm-pb-lost");
    expect(found?.supplier_reference_id).toBe("nm-pb-lost");
    await expect(getProductionBatch(client(), found!.id)).resolves.toMatchObject({
      id: found!.id,
    });
    expect(registry.requestCount("GET", "/production_batches")).toBe(2);
  });
});

describe("Biochar Application reconciliation through the fake registry", () => {
  const body = (ref: string) =>
    ({ supplier_reference_id: ref }) as unknown as CreateBiocharApplicationRequest;

  it("finds an application whose create response was lost, past the first page", async () => {
    for (let index = 0; index < FILLER_RECORDS; index += 1) {
      await createBiocharApplication(client(), body(`filler-${index}`));
    }
    registry.failNext("POST /biochar_applications", "drop-after-commit");
    await expectDroppedCreate(createBiocharApplication(client(), body("nm-bse-lost")));

    const found = await findBiocharApplicationBySupplierReference(
      client(),
      "nm-bse-lost",
    );
    expect(found?.supplier_reference_id).toBe("nm-bse-lost");
    await expect(getBiocharApplication(client(), found!.id)).resolves.toMatchObject({
      id: found!.id,
    });
  });

  it("refuses the lookup once the page cap is reached", async () => {
    for (let index = 0; index < FILLER_RECORDS; index += 1) {
      await createBiocharApplication(client(), body(`filler-${index}`));
    }
    await expect(
      findBiocharApplicationBySupplierReference(client(), "nm-bse-missing", {
        maxPages: 1,
      }),
    ).rejects.toBeInstanceOf(IsometricPageLimitError);
  });
});

describe("Storage Location reconciliation through the fake registry", () => {
  const body = (ref: string) =>
    ({ supplier_reference_id: ref }) as unknown as CreateStorageLocationRequest;

  it("finds a location whose create response was lost, within its project only", async () => {
    for (let index = 0; index < FILLER_RECORDS; index += 1) {
      await createStorageLocation(client(), PROJECT_ID, body(`filler-${index}`));
    }
    await createStorageLocation(client(), OTHER_PROJECT_ID, body("nm-slc-lost"));
    registry.failNext(
      `POST /projects/${PROJECT_ID}/storage_locations`,
      "drop-after-commit",
    );
    await expectDroppedCreate(
      createStorageLocation(client(), PROJECT_ID, body("nm-slc-lost")),
    );

    const found = await findStorageLocationBySupplierReference(
      client(),
      PROJECT_ID,
      "nm-slc-lost",
    );
    expect(found).toMatchObject({ project_id: PROJECT_ID });
    expect(
      registry.requestCount("GET", `/projects/${PROJECT_ID}/storage_locations`),
    ).toBe(2);
    await expect(
      getStorageLocation(client(), PROJECT_ID, found!.id),
    ).resolves.toMatchObject({ id: found!.id });
    await expect(
      getStorageLocation(client(), OTHER_PROJECT_ID, found!.id),
    ).rejects.toMatchObject({ status: 404 });
  });
});
