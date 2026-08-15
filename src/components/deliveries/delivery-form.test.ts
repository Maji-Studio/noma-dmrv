import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./delivery-form.tsx", import.meta.url), "utf8");

describe("DeliveryForm truck-mass clearing", () => {
  it("submits cleared truck observations as explicit nulls", () => {
    expect(source.match(/setValueAs: nullableNumericValue/g)).toHaveLength(2);
  });
});
