import { describe, expect, it } from "vitest";
import {
  deriveTransportEvidenceCertStatus,
  hasCompleteTransportEvidence,
} from "./transport-evidence";

describe("transport evidence readiness", () => {
  it.each([
    { count: 0, expected: false },
    { count: undefined, expected: false },
    { count: 1, expected: true },
  ])("depends only on accepted evidence count", ({ count, expected }) => {
    expect(hasCompleteTransportEvidence(count)).toBe(expected);
  });

  it("keeps create and loading states neutral", () => {
    expect(
      deriveTransportEvidenceCertStatus({
        persisted: false,
        documentsLoaded: true,
        acceptedDocumentCount: 1,
      }),
    ).toBe("neutral");
    expect(
      deriveTransportEvidenceCertStatus({
        persisted: true,
        documentsLoaded: false,
        acceptedDocumentCount: undefined,
      }),
    ).toBe("neutral");
  });

  it.each([
    { count: 0, expected: "missing" },
    { count: 1, expected: "satisfied" },
  ])("resolves persisted status from accepted documents", ({ count, expected }) => {
    expect(
      deriveTransportEvidenceCertStatus({
        persisted: true,
        documentsLoaded: true,
        acceptedDocumentCount: count,
      }),
    ).toBe(expected);
  });
});
