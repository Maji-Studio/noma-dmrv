import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const supplierFormSource = readFileSync(
  new URL("./supplier-form.tsx", import.meta.url),
  "utf8",
);
const supplierLocationFormSource = readFileSync(
  new URL("./supplier-location-form.tsx", import.meta.url),
  "utf8",
);

describe("supplier location form parity", () => {
  it("uses the shared location form in the create supplier dialog", () => {
    expect(supplierFormSource).toContain("<QuickAddDialogShell");
    expect(supplierFormSource).toContain("<SupplierLocationForm");
    expect(supplierFormSource).toContain('idPrefix="pending-loc"');
    expect(supplierFormSource).toContain("normalizePendingSupplierLocation");
    expect(supplierFormSource).not.toContain("InlineLocationForm");
    expect(supplierFormSource).not.toContain("useCreateSupplierLocation");
    expect(supplierLocationFormSource).toContain("useOrganizationDefaultValues");
    expect(supplierLocationFormSource).toContain("<PositionPicker");
    expect(supplierLocationFormSource).toContain("<DistanceCalcField");
    expect(supplierLocationFormSource).toContain('register("isDefault")');
  });

  it("prefixes every nested location control while preserving edit-mode IDs", () => {
    expect(supplierLocationFormSource).toContain("function fieldId(");
    expect(supplierLocationFormSource).toContain('fieldId(idPrefix, "name")');
    expect(supplierLocationFormSource).toContain('fieldId(idPrefix, "country")');
    expect(supplierLocationFormSource).toContain('fieldId(idPrefix, "state-region")');
    expect(supplierLocationFormSource).toContain('fieldId(idPrefix, "city")');
    expect(supplierLocationFormSource).toContain('fieldId(idPrefix, "address")');
    expect(supplierLocationFormSource).toContain('fieldId(idPrefix, "gps")');
    expect(supplierLocationFormSource).toContain('fieldId(idPrefix, "distance")');
    expect(supplierLocationFormSource).toContain('fieldId(idPrefix, "default")');
    expect(supplierLocationFormSource).toContain("idPrefix={positionIdPrefix}");
    expect(supplierLocationFormSource).toContain("id={distanceId}");
    expect(supplierLocationFormSource).toContain("htmlFor={defaultId}");
    expect(supplierLocationFormSource).toContain("id={defaultId}");
  });
});
