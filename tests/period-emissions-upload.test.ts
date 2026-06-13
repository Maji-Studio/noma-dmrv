import { describe, expect, it } from "vitest";
import { createProjectEmissionSourceUploadConfig } from "@/components/admin/period-emission-source-upload";

describe("period emission source document upload", () => {
  it("attaches LCA PDFs as facility documents", () => {
    const config = createProjectEmissionSourceUploadConfig(
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );

    expect(config).toEqual({
      accept: "application/pdf,.pdf",
      documentType: "pdf",
      entityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      entityType: "facility",
      maxSizeMb: 50,
      multiple: false,
    });
  });
});
