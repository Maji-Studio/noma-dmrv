import { describe, expect, it } from "vitest";
import { classifyRegistryObservation } from "./registry-observation";

describe("classifyRegistryObservation", () => {
  it.each([
    {
      input: { hasExternalId: false, readFailed: false, complete: false },
      expected: "pending",
    },
    {
      input: { hasExternalId: true, readFailed: true, complete: false },
      expected: "unavailable",
    },
    {
      input: { hasExternalId: true, readFailed: false, complete: false },
      expected: "pending",
    },
    {
      input: { hasExternalId: true, readFailed: false, complete: true },
      expected: "available",
    },
  ] as const)("returns $expected for $input", ({ input, expected }) => {
    expect(classifyRegistryObservation(input)).toBe(expected);
  });
});
