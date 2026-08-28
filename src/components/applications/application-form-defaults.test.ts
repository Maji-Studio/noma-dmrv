import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Application form organization defaults", () => {
  it("uses the selectable organization evidence default for new records", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/applications/application-form.tsx"),
      "utf8",
    );

    expect(source).toContain("useOrganizationDefaultValues");
    expect(source).toContain("organizationDefaults.defaultEvidenceMethod");
    expect(source).toContain("isSelectableApplicationEvidenceMethod");
  });
});
