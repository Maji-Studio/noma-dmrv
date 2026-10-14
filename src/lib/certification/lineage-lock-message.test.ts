import { describe, expect, it } from "vitest";
import { formatCertificationLineageLockMessage } from "./lineage-lock-message";

describe("formatCertificationLineageLockMessage", () => {
  it("offers an unlocked order when creating a delivery", () => {
    expect(formatCertificationLineageLockMessage({ mutation: "create", subjectEntityType: "delivery", lineageEntityType: "order" })).toBe(
      "Cannot create this delivery because the selected order is locked by a certification submission. Select an order that is not locked.",
    );
  });

  it.each([
    ["creditBatch", "a credit batch"], ["productionRun", "a production run"],
    ["sample", "a sample"], ["application", "an application"], ["delivery", "a delivery"],
    ["order", "an order"], ["biocharProduct", "a biochar product"], ["feedstock", "a feedstock"],
    ["transportLeg", "a transport leg"], ["vehicle", "a vehicle"],
  ] as const)("uses the correct article for a selected %s", (lineageEntityType, phrase) => {
    const subjectEntityType = lineageEntityType === "delivery" ? "application" : "delivery";
    expect(formatCertificationLineageLockMessage({ mutation: "create", subjectEntityType, lineageEntityType })).toContain(`Select ${phrase} that is not locked.`);
  });

  it("names an application and its selected locked delivery", () => {
    expect(
      formatCertificationLineageLockMessage({
        mutation: "create",
        subjectEntityType: "application",
        lineageEntityType: "delivery",
      }),
    ).toBe(
      "Cannot create this application because the selected delivery is locked by a certification submission. Select a delivery that is not locked.",
    );
  });

  it("names a biochar product and its selected locked production run", () => {
    expect(
      formatCertificationLineageLockMessage({
        mutation: "create",
        subjectEntityType: "biocharProduct",
        lineageEntityType: "productionRun",
      }),
    ).toBe(
      "Cannot create this biochar product because the selected production run is locked by a certification submission. Select a production run that is not locked.",
    );
  });

  it.each([
    ["feedstock", "feedstock"],
    ["biocharProduct", "biochar product"],
    ["sample", "sample"],
  ] as const)(
    "names a transport leg and its selected %s parent",
    (lineageEntityType, label) => {
      expect(
        formatCertificationLineageLockMessage({
          mutation: "create",
          subjectEntityType: "transportLeg",
          lineageEntityType,
          lineageRelationship: "linked",
        }),
      ).toBe(
        `Cannot create this transport leg because the linked ${label} is locked by a certification submission.`,
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
      "Cannot update this application because it is locked by a certification submission.",
    );
  });

  it("names the linked parent of an existing child record", () => {
    expect(
      formatCertificationLineageLockMessage({
        mutation: "update",
        subjectEntityType: "transportLeg",
        lineageEntityType: "feedstock",
      }),
    ).toBe(
      "Cannot update this transport leg because the linked feedstock is locked by a certification submission.",
    );
  });

  it("does not offer selection when a create uses a derived parent", () => {
    expect(
      formatCertificationLineageLockMessage({
        mutation: "create",
        subjectEntityType: "biocharProduct",
        lineageEntityType: "productionRun",
        lineageRelationship: "linked",
      }),
    ).toBe(
      "Cannot create this biochar product because the linked production run is locked by a certification submission.",
    );
  });

  it("names the selected parent for a re-parenting update", () => {
    expect(
      formatCertificationLineageLockMessage({
        mutation: "update",
        subjectEntityType: "application",
        lineageEntityType: "delivery",
        lineageRelationship: "selected",
      }),
    ).toBe(
      "Cannot update this application because the selected delivery is locked by a certification submission. Select a delivery that is not locked.",
    );
  });

  it("uses the shared lock explanation for credit-batch deletion", () => {
    expect(
      formatCertificationLineageLockMessage({
        mutation: "delete",
        subjectEntityType: "creditBatch",
        lineageEntityType: "creditBatch",
      }),
    ).toBe(
      "Cannot delete this credit batch because it is locked by a certification submission.",
    );
  });
});
