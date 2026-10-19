import { describe, expect, it } from "vitest";
import { formatRegistryRecord } from "./registry-record";

describe("formatRegistryRecord", () => {
  it("writes the registry id, a dot and the version", () => {
    expect(formatRegistryRecord("grm_01ABC", 3)).toBe("grm_01ABC · v3");
  });

  it("writes the id alone when the version is unknown", () => {
    expect(formatRegistryRecord("grm_01ABC", null)).toBe("grm_01ABC");
  });
});
