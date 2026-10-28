import { BIOCHAR_PRODUCT_REPRESENTATION_REVISION } from "@/config/api-rest";
import { expect, it } from "vitest";
import { driverEtag, facilityEtag, feedstockEtag, feedstockTypeEtag, storageLocationEtag, supplierEtag, vehicleEtag, productionRunEtag, biocharProductEtag, formulationEtag, labSampleEtag, creditBatchEtag, customerEtag, orderEtag, deliveryEtag, documentEtag } from "./representation-etags";

it("builds strong ETags from row version and representation revision", () => {
  for (const etag of [driverEtag, feedstockTypeEtag, vehicleEtag, labSampleEtag, creditBatchEtag, orderEtag, documentEtag]) {
    expect(etag({ version: 7 })).toBe('"7.1"');
  }
});

it("uses revision 2 for formulations with description and archive state", () => {
  expect(formulationEtag({ version: 7 })).toBe('"7.2"');
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

it("keeps upload request and confirm tags on the document read revision", () => {
  expect(documentEtag({ version: 1 })).toBe('"1.1"');
  expect(documentEtag({ version: 2 })).toBe('"2.1"');
});

it("uses the current biochar product representation revision", () => {
  expect(biocharProductEtag({ version: 7 })).toBe(`"7.${BIOCHAR_PRODUCT_REPRESENTATION_REVISION}"`);
});

it("uses revision 3 for feedstocks with persisted distance overrides", () => {
  expect(feedstockEtag({ version: 7 })).toBe('"7.3"');
});

it("uses revision 2 for party metadata and archive state", () => {
  expect(supplierEtag({ version: 7 })).toBe('"7.2"');
  expect(customerEtag({ version: 7 })).toBe('"7.2"');
});
