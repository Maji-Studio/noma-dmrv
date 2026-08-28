import { describe, expect, it } from "vitest";
import { resolveSupportingEvidenceDocumentType } from "./application-supporting-evidence";

describe("Application supporting-evidence classification", () => {
  it.each([
    ["application.jpg", "", "photo"],
    ["application.png", "application/octet-stream", "photo"],
    ["application.webp", "image/webp", "photo"],
    ["application.pdf", "", "pdf"],
  ])("classifies %s from MIME and extension", (name, type, expected) => {
    expect(resolveSupportingEvidenceDocumentType({ name, type })).toBe(
      expected,
    );
  });
});
