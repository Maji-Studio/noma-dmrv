import { expect, it } from "vitest";
import { driverEtag, facilityEtag, feedstockEtag, feedstockTypeEtag, storageLocationEtag, supplierEtag, vehicleEtag, productionRunEtag } from "./representation-etags";

it("builds strong ETags from row version and representation revision", () => {
  for (const etag of [driverEtag, facilityEtag, feedstockEtag, feedstockTypeEtag, storageLocationEtag, supplierEtag, vehicleEtag]) {
    expect(etag({ version: 7 })).toBe('"7.1"');
  }
});

it("uses revision 2 for the production run representation with reference IDs", () => {
  expect(productionRunEtag({ version: 7 })).toBe('"7.2"');
});
