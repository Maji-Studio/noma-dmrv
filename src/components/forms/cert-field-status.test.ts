import { describe, expect, it } from "vitest";
import {
  makeCertFieldStatus,
  resolveCertFieldStatus,
} from "./cert-field-status";

describe("CERT field status", () => {
  it("keeps create and unknown saved state neutral", () => {
    expect(makeCertFieldStatus(undefined)("distanceKm")).toBe("neutral");
    expect(resolveCertFieldStatus(undefined, false)).toBe("neutral");
  });

  it("marks persisted missing values orange and present values green", () => {
    const status = makeCertFieldStatus({
      absent: null,
      empty: "",
      whitespace: "   ",
      invalidNumber: Number.POSITIVE_INFINITY,
      zero: 0,
      present: "document",
    });

    expect(status("absent")).toBe("missing");
    expect(status("empty")).toBe("missing");
    expect(status("whitespace")).toBe("missing");
    expect(status("invalidNumber")).toBe("missing");
    expect(status("zero")).toBe("satisfied");
    expect(status("present")).toBe("satisfied");
  });

  it("supports composite saved requirements without inspecting a field value", () => {
    expect(resolveCertFieldStatus(true, false)).toBe("missing");
    expect(resolveCertFieldStatus(true, true)).toBe("satisfied");
  });
});
