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

describe("isometricRegistry.certifyProject — Certify project overview link", () => {
  it("builds the sandbox Certify overview URL", () => {
    expect(
      isometricRegistry.certifyProject({
        environment: "sandbox",
        externalProjectId: "prj_1K9YJ33RKSBX9FFF",
      }),
    ).toBe(
      "https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/overview",
    );
  });

  it("builds the production Certify overview URL", () => {
    expect(
      isometricRegistry.certifyProject({
        environment: "production",
        externalProjectId: "prj_1K5F2F6SN1S0ZKDQ",
      }),
    ).toBe(
      "https://registry.isometric.com/account/certify/project/prj_1K5F2F6SN1S0ZKDQ/overview",
    );
  });

  it("url-encodes the project id", () => {
    expect(
      isometricRegistry.certifyProject({
        environment: "sandbox",
        externalProjectId: "prj a/b",
      }),
    ).toContain("project/prj%20a%2Fb/overview");
  });
});

describe("isometricRegistry.productionBatch — facility-nested Certify link", () => {
  // The exact sandbox URL verified against a live Certify production batch on
  // 2026-08-05 (CB-26-002's registration). Drift guard for the /facilities
  // nesting and the "production-batches" segment.
  it("matches the verified sandbox URL exactly", () => {
    expect(
      isometricRegistry.productionBatch({
        environment: "sandbox",
        externalProjectId: "prj_1K9YJ33RKSBX9FFF",
        externalFacilityId: "fcl_1KST05ZW3SBXZCM7",
        externalProductionBatchId: "ptb_1KZ90J63TSBX9M2P",
      }),
    ).toBe(
      "https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/facilities/fcl_1KST05ZW3SBXZCM7/production-batches/ptb_1KZ90J63TSBX9M2P",
    );
  });

  it("uses the public registry host (no sandbox subdomain) in production", () => {
    expect(
      isometricRegistry.productionBatch({
        environment: "production",
        externalProjectId: "prj_1K9YJ33RKSBX9FFF",
        externalFacilityId: "fcl_1KST05ZW3SBXZCM7",
        externalProductionBatchId: "ptb_1KZ90J63TSBX9M2P",
      }),
    ).toBe(
      "https://registry.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/facilities/fcl_1KST05ZW3SBXZCM7/production-batches/ptb_1KZ90J63TSBX9M2P",
    );
  });

  it("url-encodes all three ids", () => {
    const url = isometricRegistry.productionBatch({
      environment: "sandbox",
      externalProjectId: "prj a/b",
      externalFacilityId: "fcl c?d",
      externalProductionBatchId: "ptb e/f",
    });
    expect(url).toContain("project/prj%20a%2Fb/");
    expect(url).toContain("facilities/fcl%20c%3Fd/");
    expect(url).toContain("production-batches/ptb%20e%2Ff");
  });
});

describe("isometricRegistry — public registry pages", () => {
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
