import { describe, expect, it } from "vitest";
import {
  CERT_REQUIREMENT_META,
  certCheckLabel,
  entityFieldUnmetLabel,
} from "./requirement-labels";

const DASHES = /[–—]/;

describe("certCheckLabel", () => {
  it("names the problem while a check is unmet and keeps the requirement otherwise", () => {
    const meta = CERT_REQUIREMENT_META.production;
    expect(certCheckLabel({ ...meta, status: "unmet" })).toBe("No production run linked");
    for (const status of ["met", "skipped", "warning"]) {
      expect(certCheckLabel({ ...meta, status })).toBe("Linked production data");
    }
  });

  it("wraps a per-field entity readiness label in its unmet form", () => {
    expect(entityFieldUnmetLabel("Proof of delivery")).toBe("Proof of delivery not complete");
  });

  it("gives every requirement a distinct problem label with no en or em dash", () => {
    for (const meta of Object.values(CERT_REQUIREMENT_META)) {
      expect(meta.unmetLabel).not.toBe(meta.requirementLabel);
      expect(meta.unmetLabel).not.toMatch(DASHES);
    }
  });
});
