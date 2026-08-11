import { describe, expect, it } from "vitest";
import { formatCertificationLineageLockMessage } from "./certification-lineage-lock-message";

describe("formatCertificationLineageLockMessage", () => {
  it("names an application and its locked delivery", () => {
    expect(
      formatCertificationLineageLockMessage({
        mutation: "create",
        subjectEntityType: "application",
        lineageEntityType: "delivery",
      }),
    ).toBe(
      "Cannot create this application because its delivery is part of a submitted Removal. Submitted Removal data is locked. Removal cancellation is not available yet.",
    );
  });

  it("names a biochar product and its locked production run", () => {
    expect(
      formatCertificationLineageLockMessage({
        mutation: "create",
        subjectEntityType: "biocharProduct",
        lineageEntityType: "productionRun",
      }),
    ).toBe(
      "Cannot create this biochar product because its production run is part of a submitted Removal. Submitted Removal data is locked. Removal cancellation is not available yet.",
    );
  });

  it.each([
    ["feedstock", "feedstock"],
    ["biocharProduct", "biochar product"],
    ["sample", "sample"],
  ] as const)(
    "names a transport leg and its %s parent",
    (lineageEntityType, label) => {
      expect(
        formatCertificationLineageLockMessage({
          mutation: "create",
          subjectEntityType: "transportLeg",
          lineageEntityType,
        }),
      ).toBe(
        `Cannot create this transport leg because its ${label} is part of a submitted Removal. Submitted Removal data is locked. Removal cancellation is not available yet.`,
      );
    },
  );

  it("uses it for a same-entity update", () => {
    expect(
      formatCertificationLineageLockMessage({
        mutation: "update",
        subjectEntityType: "application",
        lineageEntityType: "application",
      }),
    ).toBe(
      "Cannot update this application because it is part of a submitted Removal. Submitted Removal data is locked. Removal cancellation is not available yet.",
    );
  });

  it("uses the shared guidance for credit-batch deletion", () => {
    expect(
      formatCertificationLineageLockMessage({
        mutation: "delete",
        subjectEntityType: "creditBatch",
        lineageEntityType: "creditBatch",
      }),
    ).toBe(
      "Cannot delete this credit batch because it is part of a submitted Removal. Submitted Removal data is locked. Removal cancellation is not available yet.",
    );
  });
});
