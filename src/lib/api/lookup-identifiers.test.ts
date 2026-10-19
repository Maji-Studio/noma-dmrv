import { beforeEach, expect, it, vi } from "vitest";
import type { ApiContext } from "@/lib/auth/api-context";
import { readFacility } from "./facilities-queries";
import { readSupplier } from "./suppliers-queries";
import { readFeedstockType } from "./feedstock-types-queries";
import { readStorageLocation } from "./storage-locations-queries";
import { readDriver } from "./drivers-queries";
import { readVehicle } from "./vehicles-queries";
import { readFeedstock } from "./feedstock-queries";
import { readSupplierLocationList } from "./supplier-locations-queries";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/read-models/api-facilities", () => ({ readApiFacility: read }));
vi.mock("@/lib/read-models/api-suppliers", () => ({ readApiSupplier: read }));
vi.mock("@/lib/read-models/api-feedstock-types", () => ({ readApiFeedstockType: read }));
vi.mock("@/lib/read-models/api-storage-locations", () => ({ readApiStorageLocation: read }));
vi.mock("@/lib/read-models/api-drivers", () => ({ readApiDriver: read }));
vi.mock("@/lib/read-models/api-vehicles", () => ({ readApiVehicle: read }));
vi.mock("@/lib/read-models/api-feedstocks", () => ({ readApiFeedstock: read }));
vi.mock("@/lib/read-models/api-supplier-locations", () => ({ readApiSupplierLocationList: read }));

const ctx = { organizationId: "org-a" } as ApiContext;
const request = new Request("https://example.test/api/v1/facilities");
const readers = [readFacility, readSupplier, readFeedstockType, readStorageLocation, readDriver, readVehicle, readSupplierLocationList];
beforeEach(() => vi.resetAllMocks());

it.each(["\u0000", "\t", "\n", "\r", "\u001f", "\u007f", "\u0085", "\u009f"])("every by-id read rejects control %j without querying", async (control) => {
  for (const reader of readers) {
    await expect(reader(request, ctx, `FUZZ-${control}`)).rejects.toMatchObject({ code: "not_found" });
  }
  await expect(readFeedstock(ctx, `FUZZ-${control}`)).rejects.toMatchObject({ code: "not_found" });
  expect(read).not.toHaveBeenCalled();
});
