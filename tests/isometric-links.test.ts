import { describe, expect, it } from "vitest";
import {
  isometricRegistry,
  normalizeRegistryMinorVersion,
} from "@/lib/isometric/links";

describe("Isometric registry links", () => {
  it("normalizes common protocol version display text to registry minor versions", () => {
    expect(normalizeRegistryMinorVersion("1.2")).toBe("1.2");
    expect(normalizeRegistryMinorVersion("v1.2")).toBe("1.2");
    expect(normalizeRegistryMinorVersion("Biochar v1.2")).toBe("1.2");
    expect(normalizeRegistryMinorVersion("1.2.2")).toBe("1.2");
  });

  it("builds protocol URLs from canonical minor versions", () => {
    expect(isometricRegistry.protocol("biochar", "Biochar v1.2")).toBe(
      "https://registry.isometric.com/protocol/biochar/1.2",
    );
  });

  it("does not build protocol URLs when no registry minor version is present", () => {
    expect(isometricRegistry.protocol("biochar", "latest certified")).toBeNull();
  });
});
