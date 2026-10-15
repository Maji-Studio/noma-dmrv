import { expect, it } from "vitest";
import { inspectUploadBytes } from "./inspection";
const declaration = { entityType: "sample", documentType: "pdf" as const, fileName: "report.pdf", contentType: "application/pdf", sizeBytes: 8 };
const bytes = Buffer.from("%PDF-1.7");
const object = { bytes, contentType: "application/pdf", sizeBytes: 8, sha256: "a".repeat(64) };
it("accepts matching bytes and refuses size, magic bytes and declared checksum", () => {
  expect(inspectUploadBytes(declaration, object)).toBeNull();
  expect(inspectUploadBytes({ ...declaration, sizeBytes: 9 }, object)).toBe("size");
  expect(inspectUploadBytes(declaration, { ...object, bytes: Buffer.from("not pdf!") })).toBe("type");
  expect(inspectUploadBytes({ ...declaration, sha256: "b".repeat(64) }, object)).toBe("checksum");
});
it("keeps the readings CSV rule and empty GIS MIME allowance", () => {
  expect(inspectUploadBytes({ ...declaration, entityType: "production_run", documentType: "sensor_data", contentType: "text/csv" }, { ...object, contentType: "text/csv" })).toBe("format");
  expect(inspectUploadBytes({ ...declaration, documentType: "gis_boundary", contentType: "" }, { ...object, contentType: "" })).toBeNull();
});
it("accepts a storage binary default only for an allowed empty declaration", () => {
  expect(inspectUploadBytes({ ...declaration, documentType: "gis_boundary", contentType: "" }, { ...object, contentType: "application/octet-stream" })).toBeNull();
  expect(inspectUploadBytes({ ...declaration, contentType: "" }, { ...object, contentType: "application/octet-stream" })).toBe("type");
});
it.each([
  ["image/png", "89504e470d0a1a0a"], ["image/jpeg", "ffd8ff"], ["image/gif", "474946383961"], ["image/webp", "524946460000000057454250"],
])("recognizes %s and refuses a forged signature", (contentType, hex) => {
  const bytes = Buffer.from(hex, "hex");
  const declared = { ...declaration, documentType: "photo" as const, contentType, sizeBytes: bytes.length };
  expect(inspectUploadBytes(declared, { ...object, contentType, bytes, sizeBytes: bytes.length })).toBeNull();
  expect(inspectUploadBytes(declared, { ...object, contentType, bytes: Buffer.alloc(bytes.length), sizeBytes: bytes.length })).toBe("type");
});
