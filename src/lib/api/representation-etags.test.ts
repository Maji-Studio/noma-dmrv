import { BIOCHAR_PRODUCT_REPRESENTATION_REVISION } from "@/config/api-rest";
import { expect, it } from "vitest";
import { driverEtag, facilityEtag, feedstockEtag, feedstockTypeEtag, storageLocationEtag, supplierEtag, vehicleEtag, productionRunEtag, biocharProductEtag, formulationEtag, labSampleEtag, creditBatchEtag, customerEtag, orderEtag, deliveryEtag } from "./representation-etags";

it("builds strong ETags from row version and representation revision", () => {
  for (const etag of [driverEtag, feedstockEtag, feedstockTypeEtag, supplierEtag, vehicleEtag, formulationEtag, labSampleEtag, creditBatchEtag, customerEtag, orderEtag]) {
    expect(etag({ version: 7 })).toBe('"7.1"');
  }
});

it("uses revision 2 for the facility representation that gained durabilityOption", () => {
  expect(facilityEtag({ version: 7 })).toBe('"7.2"');
});

it("uses revision 2 for the production run representation with reference IDs", () => {
  expect(productionRunEtag({ version: 7 })).toBe('"7.2"');
});

it("uses revision 3 for storage locations with a formulation claim", () => {
  expect(storageLocationEtag({ version: 7 })).toBe('"7.3"');
});

it("keeps order read and write tags on the same representation revision", () => {
  expect(orderEtag({ version: 1 })).toBe('"1.1"');
  expect(orderEtag({ version: 2 })).toBe('"2.1"');
});

it("keeps delivery read and write tags on the same representation revision", () => {
  expect(deliveryEtag({ version: 2 })).toBe('"2.2"');
  expect(deliveryEtag({ version: 3 })).toBe('"3.2"');
});

it("uses the current biochar product representation revision", () => {
  expect(biocharProductEtag({ version: 7 })).toBe(`"7.${BIOCHAR_PRODUCT_REPRESENTATION_REVISION}"`);
});
