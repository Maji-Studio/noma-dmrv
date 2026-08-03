import { describe, expect, it } from "vitest";
import { isAllowedMime } from "@/schemas/documents";
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

  // Browsers report an empty type for .geojson; before the extension entry
  // existed that resolved to the generic binary type and every real boundary
  // upload was rejected by the gis_boundary allow list.
  it("infers a geojson content type the boundary upload rule allows", () => {
    const resolved = resolveUploadContentType({
      fileName: "north-field.geojson",
      contentType: "",
    });

    expect(resolved).toBe("application/geo+json");
    expect(isAllowedMime("gis_boundary", resolved)).toBe(true);
  });

  it("infers a json content type the boundary upload rule allows", () => {
    const resolved = resolveUploadContentType({
      fileName: "north-field.json",
      contentType: "application/octet-stream",
    });

    expect(resolved).toBe("application/json");
    expect(isAllowedMime("gis_boundary", resolved)).toBe(true);
  });
});
