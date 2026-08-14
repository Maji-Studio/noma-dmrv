import { describe, expect, it, vi } from "vitest";
import type { IsometricClient } from "./client";
import {
  buildCreateStorageLocationRequest,
  buildStorageLocationReference,
  createStorageLocation,
  findStorageLocationBySupplierReference,
  getStorageLocation,
  type IsometricStorageLocation,
} from "./storage-locations";

function client(overrides: Partial<IsometricClient> = {}): IsometricClient {
  return {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    paginate: vi.fn(),
    paginateAll: vi.fn(),
    ...overrides,
  } as IsometricClient;
}

function location(
  id: string,
  supplierReferenceId: string | null,
): IsometricStorageLocation {
  return {
    id,
    latitude: -3.25,
    longitude: 37.42,
    name: "North Field",
    project_id: "prj_test",
    storage_method: "biochar_field",
    supplier_id: "spl_test",
    supplier_reference_id: supplierReferenceId,
  };
}

function page(
  nodes: IsometricStorageLocation[],
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return {
    nodes,
    page_info: {
      end_cursor: endCursor,
      has_next_page: hasNextPage,
      has_previous_page: false,
      start_cursor: null,
    },
    total_count: nodes.length,
  };
}

describe("Storage Location contract", () => {
  it("builds the biochar-field payload from canonical site facts", () => {
    expect(
      buildCreateStorageLocationRequest({
        externalProjectId: "prj_test",
        name: " North Field ",
        latitude: -3.25,
        longitude: 37.42,
        supplierReferenceId: "nm-slc-stable",
      }),
    ).toEqual({
      description: { __typename: "Undefined" },
      latitude: -3.25,
      longitude: 37.42,
      name: "North Field",
      project_id: "prj_test",
      storage_method: "biochar_field",
      supplier_reference_id: "nm-slc-stable",
    });
  });

  it.each([
    [null, 37.42, /latitude/],
    [-3.25, undefined, /longitude/],
    [-90.01, 37.42, /latitude/],
    [90.01, 37.42, /latitude/],
    [-3.25, -180.01, /longitude/],
    [-3.25, 180.01, /longitude/],
    [Number.NaN, 37.42, /latitude/],
  ])("rejects missing or out-of-range coordinates", (latitude, longitude, message) => {
    expect(() =>
      buildCreateStorageLocationRequest({
        externalProjectId: "prj_test",
        name: "North Field",
        latitude,
        longitude,
        supplierReferenceId: "nm-slc-stable",
      }),
    ).toThrow(message);
  });

  it("derives a stable reference from the project and customer-location identity", () => {
    const first = buildStorageLocationReference({
      customerLocationId: "11111111-1111-4111-8111-111111111111",
      externalProjectId: "prj_test",
    });
    const afterMutableSiteDrift = buildStorageLocationReference({
      customerLocationId: "11111111-1111-4111-8111-111111111111",
      externalProjectId: "prj_test",
    });
    expect(first).toBe(afterMutableSiteDrift);
    expect(first).toMatch(/^nm-slc-[a-f0-9]{16}$/);
    expect(
      buildStorageLocationReference({
        customerLocationId: "11111111-1111-4111-8111-111111111111",
        externalProjectId: "prj_other",
      }),
    ).not.toBe(first);
  });

  it("paginates until it finds one matching supplier reference", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(page([location("slc_other", "other")], true, "cursor-1"))
      .mockResolvedValueOnce(page([location("slc_match", "nm-slc-stable")]));
    const result = await findStorageLocationBySupplierReference(
      client({ get }),
      "prj_test",
      "nm-slc-stable",
    );
    expect(result?.id).toBe("slc_match");
    expect(get).toHaveBeenNthCalledWith(
      2,
      "/projects/prj_test/storage_locations",
      { query: { first: 50, after: "cursor-1" } },
    );
  });

  it("fails loudly when duplicate supplier references exist", async () => {
    const get = vi.fn().mockResolvedValue(
      page([
        location("slc_first", "nm-slc-stable"),
        location("slc_second", "nm-slc-stable"),
      ]),
    );
    await expect(
      findStorageLocationBySupplierReference(
        client({ get }),
        "prj_test",
        "nm-slc-stable",
      ),
    ).rejects.toThrow(/Multiple Isometric Storage Locations/);
  });

  it("fails closed when the bounded scan still has another page", async () => {
    const get = vi.fn().mockResolvedValue(page([], true, "another"));
    await expect(
      findStorageLocationBySupplierReference(
        client({ get }),
        "prj_test",
        "nm-slc-stable",
        { maxPages: 1 },
      ),
    ).rejects.toThrow(/safety limit/);
  });

  it("rejects a page size above the API maximum", async () => {
    const get = vi.fn();
    await expect(
      findStorageLocationBySupplierReference(
        client({ get }),
        "prj_test",
        "nm-slc-stable",
        { pageSize: 51 },
      ),
    ).rejects.toThrow(/between 1 and 50/);
    expect(get).not.toHaveBeenCalled();
  });

  it("propagates HTTP helper errors unchanged", async () => {
    const error = new Error("registry unavailable");
    const api = client({
      get: vi.fn().mockRejectedValue(error),
      post: vi.fn().mockRejectedValue(error),
      patch: vi.fn().mockRejectedValue(error),
    });
    const body = buildCreateStorageLocationRequest({
      externalProjectId: "prj_test",
      name: "North Field",
      latitude: -3.25,
      longitude: 37.42,
      supplierReferenceId: "nm-slc-stable",
    });
    await expect(createStorageLocation(api, "prj_test", body)).rejects.toBe(error);
    await expect(getStorageLocation(api, "prj_test", "slc_test")).rejects.toBe(error);
    await expect(
      findStorageLocationBySupplierReference(api, "prj_test", "nm-slc-stable"),
    ).rejects.toBe(error);
  });
});
