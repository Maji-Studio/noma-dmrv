import { describe, expect, it } from "vitest";
import { applicationDeepLinkHref } from "./application-links";
import { deliveryDeepLinkHref } from "./delivery-links";
import { orderDeepLinkHref } from "./order-links";
import { feedstockDeepLinkHref } from "./feedstock-links";
import { biocharProductDeepLinkHref } from "./biochar-product-links";
import { ghgStatementDeepLinkHref } from "./ghg-statement-links";

describe("record deep links", () => {
  it("opens a delivery's sheet on its facility", () => {
    expect(deliveryDeepLinkHref("d-1", "f-1")).toBe("/deliveries?facility=f-1&delivery=d-1");
    expect(deliveryDeepLinkHref("d-1")).toBe("/deliveries?delivery=d-1");
  });

  it("opens an order's sheet on its facility", () => {
    expect(orderDeepLinkHref("o-1", "f-1")).toBe("/orders?facility=f-1&order=o-1");
    expect(orderDeepLinkHref("o-1")).toBe("/orders?order=o-1");
  });

  it("opens feedstock, biochar product and GHG Statement sheets on their facility", () => {
    expect(feedstockDeepLinkHref("fs-1", "f-1")).toBe("/feedstocks?facility=f-1&feedstock=fs-1");
    expect(biocharProductDeepLinkHref("p-1", "f-1")).toBe("/biochar-products?facility=f-1&biocharProduct=p-1");
    expect(ghgStatementDeepLinkHref("g-1", "f-1")).toBe("/certification/ghg-statements?facility=f-1&statement=g-1");
    expect(ghgStatementDeepLinkHref("g-1")).toBe("/certification/ghg-statements?statement=g-1");
  });

  it("opens an application's sheet on its facility", () => {
    expect(applicationDeepLinkHref("a-1", "f-1")).toBe("/applications?facility=f-1&application=a-1");
  });
});
