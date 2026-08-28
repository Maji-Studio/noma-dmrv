import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Application supporting evidence", () => {
  it("keeps uploaded GIS references visible so operators can delete stale files", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/components/applications/application-supporting-evidence-panel.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('doc.documentType === "gis_boundary"');
  });
});
