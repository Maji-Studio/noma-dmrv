import { describe, expect, it } from "vitest";
import { resolveSupportingEvidenceDocumentType } from "./application-supporting-evidence";

describe("Application supporting-evidence classification", () => {
  it.each([
    ["application.jpg", "image/jpeg", "photo"],
    ["application.webp", "image/webp", "photo"],
    ["application.png", "application/octet-stream", "pdf"],
    ["application.pdf", "", "pdf"],
  ])("classifies %s from its browser MIME type", (name, type, expected) => {
    expect(resolveSupportingEvidenceDocumentType({ name, type })).toBe(
      expected,
    );
  });
});
