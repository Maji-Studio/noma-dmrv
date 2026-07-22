import { describe, expect, it } from "vitest";
import {
  deriveTransportEvidenceCertStatus,
  hasCompleteTransportEvidence,
} from "./transport-evidence";

describe("transport evidence composite readiness", () => {
  it.each([
    { source: "document" as const, count: 0, expected: false },
    { source: "manual" as const, count: 1, expected: false },
    { source: "document" as const, count: 1, expected: true },
  ])("requires provenance and a file", ({ source, count, expected }) => {
    expect(hasCompleteTransportEvidence(source, count)).toBe(expected);
  });

  it("keeps create and loading states neutral", () => {
    expect(
      deriveTransportEvidenceCertStatus({
        persisted: false,
        documentsLoaded: true,
        source: "document",
        acceptedDocumentCount: 1,
      }),
    ).toBe("neutral");
    expect(
      deriveTransportEvidenceCertStatus({
        persisted: true,
        documentsLoaded: false,
        source: "document",
        acceptedDocumentCount: undefined,
      }),
    ).toBe("neutral");
  });

  it.each([
    { source: "document" as const, count: 0, expected: "missing" },
    { source: "manual" as const, count: 1, expected: "missing" },
    { source: "document" as const, count: 1, expected: "satisfied" },
  ])("resolves persisted status", ({ source, count, expected }) => {
    expect(
      deriveTransportEvidenceCertStatus({
        persisted: true,
        documentsLoaded: true,
        source,
        acceptedDocumentCount: count,
      }),
    ).toBe(expected);
  });
});
