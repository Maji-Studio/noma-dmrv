import { describe, expect, it } from "vitest";
import { readRemovalSourceBindingPlan } from "./removal-snapshot-readers";

describe("readRemovalSourceBindingPlan", () => {
  it("reads the immutable Source binding plan from a claimed snapshot", () => {
    const plan = [
      {
        documentId: "document-1",
        sourceId: "source-1",
        nomaRole: "inventory",
        lineage: {
          entityType: "application",
          entityId: "application-1",
          entityLabel: "Application APP-001",
        },
        intendedTarget: {
          kind: "sequestration",
          groupKey: "co2-stored",
          componentId: "component-1",
          componentBlueprintKey: "biochar_sequestration_1000_year",
          inputKey: "product_mass",
          creditBatchIds: ["credit-batch-1"],
        },
        mappingRevision: "revision-1",
      },
    ];

    expect(
      readRemovalSourceBindingPlan({
        payloadSnapshot: { sourceBindingPlan: plan },
      } as never),
    ).toEqual(plan);
  });

  it("fails closed for a pre-plan stale draft", () => {
    expect(() =>
      readRemovalSourceBindingPlan({
        payloadSnapshot: {},
      } as never),
    ).toThrow(/saved submission uses an older supporting-file plan/i);
  });

  it("fails closed when a stored sequestration target has no credit-batch scope", () => {
    expect(() =>
      readRemovalSourceBindingPlan({
        payloadSnapshot: {
          sourceBindingPlan: [
            {
              documentId: "document-1",
              sourceId: "source-1",
              nomaRole: "inventory",
              lineage: {
                entityType: "application",
                entityId: "application-1",
                entityLabel: "Application APP-001",
              },
              intendedTarget: {
                kind: "sequestration",
                groupKey: "co2-stored",
                componentId: "component-1",
                componentBlueprintKey:
                  "biochar_sequestration_1000_year",
                inputKey: "product_mass",
              },
              mappingRevision: "revision-1",
            },
          ],
        },
      } as never),
    ).toThrow(/saved submission uses an older supporting-file plan/i);
  });
});
