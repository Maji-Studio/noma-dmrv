import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("Next development logging", () => {
  it("does not serialize Server Function arguments", () => {
    expect(nextConfig.logging).toMatchObject({ serverFunctions: false });
  });
});
