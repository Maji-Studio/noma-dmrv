import { describe, expect, it } from "vitest";
import { applicationDeepLinkHref } from "./application-links";
import { deliveryDeepLinkHref } from "./delivery-links";
import { orderDeepLinkHref } from "./order-links";

describe("record deep links", () => {
  it("opens a delivery's sheet on its facility", () => {
    expect(deliveryDeepLinkHref("d-1", "f-1")).toBe("/deliveries?facility=f-1&delivery=d-1");
    expect(deliveryDeepLinkHref("d-1")).toBe("/deliveries?delivery=d-1");
  });

  it("opens an order's sheet on its facility", () => {
    expect(orderDeepLinkHref("o-1", "f-1")).toBe("/orders?facility=f-1&order=o-1");
    expect(orderDeepLinkHref("o-1")).toBe("/orders?order=o-1");
  });

  it("opens an application's sheet on its facility", () => {
    expect(applicationDeepLinkHref("a-1", "f-1")).toBe("/applications?facility=f-1&application=a-1");
  });
});
