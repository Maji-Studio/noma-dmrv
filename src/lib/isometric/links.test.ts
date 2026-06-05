import { describe, expect, it } from "vitest";
import { isometricRegistry, normalizeRegistryMinorVersion } from "./links";

describe("isometricRegistry.removal — Certify deep link (drift guard)", () => {
  // The exact sandbox URL verified against a live Certify removal on 2026-06-04
  // (see docs/open-questions.md). This assertion is the drift guard: if the
  // Certify host, the /account/certify path, the "ghg-entry" segment, the
  // project nesting, or the /edit suffix changes, this test fails loudly.
  it("matches the verified sandbox URL exactly", () => {
    expect(
      isometricRegistry.removal({
        environment: "sandbox",
        externalProjectId: "prj_1K9YJ33RKSBX9FFF",
        externalRemovalId: "rmv_1KT958C1JSBXF5F8",
      }),
    ).toBe(
      "https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/ghg-entry/rmv_1KT958C1JSBXF5F8/edit",
    );
  });

  it("uses the public registry host (no sandbox subdomain) in production", () => {
    expect(
      isometricRegistry.removal({
        environment: "production",
        externalProjectId: "prj_1K9YJ33RKSBX9FFF",
        externalRemovalId: "rmv_1KT958C1JSBXF5F8",
      }),
    ).toBe(
      "https://registry.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/ghg-entry/rmv_1KT958C1JSBXF5F8/edit",
    );
  });

  it("url-encodes both ids", () => {
    const url = isometricRegistry.removal({
      environment: "sandbox",
      externalProjectId: "prj a/b",
      externalRemovalId: "rmv c?d",
    });
    expect(url).toContain("project/prj%20a%2Fb/");
    expect(url).toContain("ghg-entry/rmv%20c%3Fd/edit");
  });
});

describe("isometricRegistry — public registry pages", () => {
  it("builds a public project page on the production host", () => {
    expect(isometricRegistry.project("prj_1K9YJ33RKSBX9FFF")).toBe(
      "https://registry.isometric.com/project/prj_1K9YJ33RKSBX9FFF",
    );
  });

  it("normalizes versions to minor for protocol/module pages", () => {
    expect(normalizeRegistryMinorVersion("1.2.3")).toBe("1.2");
    expect(isometricRegistry.protocol("biochar", "1.2.0")).toBe(
      "https://registry.isometric.com/protocol/biochar/1.2",
    );
    expect(isometricRegistry.module("ghg-accounting", "v2.1")).toBe(
      "https://registry.isometric.com/module/ghg-accounting/2.1",
    );
  });

  it("returns null for an unparseable version", () => {
    expect(isometricRegistry.protocol("biochar", "latest")).toBeNull();
  });
});
