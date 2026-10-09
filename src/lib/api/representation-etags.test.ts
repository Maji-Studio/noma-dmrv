import { expect, it } from "vitest";
import { driverEtag, facilityEtag, feedstockEtag, feedstockTypeEtag, storageLocationEtag, supplierEtag, vehicleEtag } from "./representation-etags";

it("builds strong ETags from row version and representation revision", () => {
  for (const etag of [driverEtag, facilityEtag, feedstockEtag, feedstockTypeEtag, storageLocationEtag, supplierEtag, vehicleEtag]) {
    expect(etag({ version: 7 })).toBe('"7.1"');
  }
});
