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
const supplierDetailSource = readFileSync(
  new URL("./suppliers/supplier-detail.tsx", import.meta.url),
  "utf8",
);
const customerDetailSource = readFileSync(
  new URL("./customers/customer-detail.tsx", import.meta.url),
  "utf8",
);
const transportLegsEditorSource = readFileSync(
  new URL("./transport-legs/transport-legs-editor.tsx", import.meta.url),
  "utf8",
);
const transportLegFormSource = readFileSync(
  new URL("./transport-legs/transport-leg-form.tsx", import.meta.url),
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

describe.each([
  [
    "supplier",
    supplierDetailSource,
    "SupplierLocationDialog",
    "SupplierLocationForm",
    "useCreateSupplierLocation",
    "useUpdateSupplierLocation",
  ],
  [
    "customer",
    customerDetailSource,
    "CustomerLocationDialog",
    "CustomerLocationForm",
    "useCreateCustomerLocation",
    "useUpdateCustomerLocation",
  ],
])(
  "%s detail location management",
  (
    _entity,
    source,
    dialogName,
    formName,
    createMutationName,
    updateMutationName,
  ) => {
    it("opens the existing location dialog with the selected location", () => {
      expect(source).toContain(`<${dialogName}`);
      expect(source).toContain("location={editingLocation}");
      expect(source).toContain("setIsLocationDialogOpen(true)");
    });

    it("does not render or mutate the child location inline", () => {
      expect(source).not.toContain(`<${formName}`);
      expect(source).not.toContain(createMutationName);
      expect(source).not.toContain(updateMutationName);
    });
  },
);

describe("transport leg editor dialog", () => {
  it("renders the shared centered dialog around the transport leg form", () => {
    expect(transportLegsEditorSource).toContain("<QuickAddDialogShell");
    expect(transportLegsEditorSource).toContain(
      'title={dialog.leg ? "Edit transport leg" : "Add transport leg"}',
    );
    expect(transportLegsEditorSource).toContain("<TransportLegForm");
    expect(transportLegsEditorSource).not.toContain("Inline Add/Edit Form");
  });

  it("uses a real form for both persisted and deferred dialog submission", () => {
    expect(transportLegFormSource).toContain("<form");
    expect(transportLegFormSource).toContain("return submit(event)");
    expect(transportLegFormSource).not.toContain("embedded");
    expect(transportLegsEditorSource).not.toContain("embedded={deferred}");
  });
});
