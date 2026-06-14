import { describe, expect, it } from "vitest";
import { resolveUploadContentType } from "@/lib/documents/content-type";

describe("resolveUploadContentType", () => {
  it("keeps a specific browser-provided content type", () => {
    expect(
      resolveUploadContentType({
        fileName: "report.pdf",
        contentType: "application/pdf",
      }),
    ).toBe("application/pdf");
  });

  it("infers text/csv when the browser omits the CSV content type", () => {
    expect(
      resolveUploadContentType({
        fileName: "TZ001B 2026-04-02 Data Evaluation.csv",
        contentType: "",
      }),
    ).toBe("text/csv");
  });

  it("replaces generic binary content type using the filename extension", () => {
    expect(
      resolveUploadContentType({
        fileName: "readings.csv",
        contentType: "application/octet-stream",
      }),
    ).toBe("text/csv");
  });
});
