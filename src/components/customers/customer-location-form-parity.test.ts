import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const customerFormSource = readFileSync(
  new URL("./customer-form.tsx", import.meta.url),
  "utf8",
);
const customerLocationFormSource = readFileSync(
  new URL("./customer-location-form.tsx", import.meta.url),
  "utf8",
);

describe("customer location form parity", () => {
  it("uses the shared location form in the create customer dialog", () => {
    expect(customerFormSource).toContain("<QuickAddDialogShell");
    expect(customerFormSource).toContain("<CustomerLocationForm");
    expect(customerFormSource).toContain('idPrefix="pending-loc"');
    expect(customerLocationFormSource).toContain("<CustomerLocationFields");
    expect(customerLocationFormSource).toContain("idPrefix={idPrefix}");
    expect(customerFormSource).not.toContain("InlineLocationForm");
    expect(customerFormSource).not.toContain("useOrganizationDefaultValues");
    expect(customerLocationFormSource).toContain("useOrganizationDefaultValues");
  });
});
