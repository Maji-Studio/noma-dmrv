import { describe, expect, it } from "vitest";
import { redirectPreservingQuery, withFacilityParam } from "./links";

describe("withFacilityParam", () => {
  it("appends the working facility, encoded", () => {
    expect(withFacilityParam("/settings/general", "fac 1")).toBe("/settings/general?facility=fac%201");
  });

  it("joins an existing query with &", () => {
    expect(withFacilityParam("/settings/x?a=1", "f")).toBe("/settings/x?a=1&facility=f");
  });

  it("leaves the href alone without a facility", () => {
    expect(withFacilityParam("/settings/general", null)).toBe("/settings/general");
    expect(withFacilityParam("/settings/general", undefined)).toBe("/settings/general");
  });
});

describe("redirectPreservingQuery", () => {
  it("carries every incoming parameter, repeated ones included", () => {
    expect(redirectPreservingQuery("/settings/members", { facility: "f", tag: ["a", "b"], gone: undefined })).toBe(
      "/settings/members?facility=f&tag=a&tag=b",
    );
  });

  it("answers the bare target without a query", () => {
    expect(redirectPreservingQuery("/settings/members")).toBe("/settings/members");
  });
});
