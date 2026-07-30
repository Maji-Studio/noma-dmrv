import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const supplierFormSource = readFileSync(
  new URL("./suppliers/supplier-form.tsx", import.meta.url),
  "utf8",
);
const customerFormSource = readFileSync(
  new URL("./customers/customer-form.tsx", import.meta.url),
  "utf8",
);
const supplierLocationFormSource = readFileSync(
  new URL("./suppliers/supplier-location-form.tsx", import.meta.url),
  "utf8",
);
const customerLocationFormSource = readFileSync(
  new URL("./customers/customer-location-form.tsx", import.meta.url),
  "utf8",
);

describe.each([
  ["supplier", supplierFormSource, "SupplierLocationDialog"],
  ["customer", customerFormSource, "CustomerLocationDialog"],
])("%s location management", (_entity, source, dialogName) => {
  it("offers an edit action for each persisted location", () => {
    expect(source).toContain("setEditingLocation(loc)");
    expect(source).toContain("aria-label={`Edit ${");
  });

  it("opens the shared location form with the selected location", () => {
    expect(source).toContain(`<${dialogName}`);
    expect(source).toContain("location={editingLocation ?? undefined}");
  });
});

describe.each([
  ["supplier", supplierLocationFormSource],
  ["customer", customerLocationFormSource],
])("%s location dialog submission", (_entity, source) => {
  it("does not submit the surrounding party edit form", () => {
    expect(source).toContain("event.stopPropagation()");
  });
});
