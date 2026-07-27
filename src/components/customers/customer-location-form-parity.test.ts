import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const customerFormSource = readFileSync(
  new URL("./customer-form.tsx", import.meta.url),
  "utf8",
);
const customerLocationFormSource = readFileSync(
  new URL("./customer-location-form.tsx", import.meta.url),
  "utf8",
);

describe("customer location form parity", () => {
  it("uses the shared location fields in both the customer sheet and location dialog", () => {
    expect(customerFormSource).toContain("<CustomerLocationFields");
    expect(customerLocationFormSource).toContain("<CustomerLocationFields");
  });
});
