import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("stock availability query topology", () => {
  it("loads the delivery order once and reuses its quantity and product", () => {
    const source = readFileSync(
      join(process.cwd(), "src/data-access/stock-availability.ts"),
      "utf8",
    );

    expect(source.match(/\.from\(orders\)/g)).toHaveLength(1);
    expect(source).toContain("deriveDeliveryOrderAvailableKg(ctx, db");
    expect(source).not.toContain("getDeliveryOrderAvailableKg");
  });
});
