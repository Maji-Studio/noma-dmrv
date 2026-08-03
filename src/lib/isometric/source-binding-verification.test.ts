import { describe, expect, it, vi } from "vitest";
import type { IsometricClient } from "./client";
import { verifyRemovalSourceBindings } from "./source-binding-verification";

const plan = [
  {
    documentId: "document-feedstock",
    sourceId: "source-feedstock",
    nomaRole: "feedstock_bill_of_lading",
    lineage: {
      entityType: "feedstock",
      entityId: "feedstock-1",
      entityLabel: "Feedstock FS-001",
    },
    intendedTarget: {
      kind: "ordinary",
      groupKey: "biomass-feedstock-transport",
      componentId: "template-component-feedstock",
      componentBlueprintKey: "mass_distance_based_ci_emissions",
      inputKey: "mass_distance",
    },
    mappingRevision: "revision-1",
  },
] as const;

function clientWithTarget(sourceIds: string[]): IsometricClient {
  return {
    paginateAll: vi.fn(async (path: string) => {
      if (path === "/ghg_entries/ghg-entry-1/component_attributions") {
        return [
          {
            component_group_key: "biomass-feedstock-transport",
            component_id: "component-feedstock",
            ghg_entry_template_component_id: "template-component-feedstock",
          },
        ];
      }
      throw new Error(`Unexpected paginate path ${path}`);
    }),
    get: vi.fn(async (path: string) => {
      if (path === "/components/component-feedstock") {
        return {
          id: "component-feedstock",
          inputs: [
            {
              __typename: "ComponentScalarInput",
              input_key: "mass_distance",
              datapoint_id: "datapoint-feedstock",
            },
          ],
        };
      }
      if (path === "/datapoints/datapoint-feedstock") {
        return {
          id: "datapoint-feedstock",
          source_ids: sourceIds,
        };
      }
      throw new Error(`Unexpected get path ${path}`);
    }),
  } as never;
}

describe("verifyRemovalSourceBindings", () => {
  it("verifies the Source through the attributed component's intended input", async () => {
    await expect(
      verifyRemovalSourceBindings(
        clientWithTarget(["source-feedstock"]),
        "ghg-entry-1",
        plan as never,
      ),
    ).resolves.toMatchObject({
      state: "verified",
      verifiedCount: 1,
      totalCount: 1,
    });
  });

  it("reports mismatch when the Source exists but is absent from the intended Datapoint", async () => {
    await expect(
      verifyRemovalSourceBindings(
        clientWithTarget(["some-other-source"]),
        "ghg-entry-1",
        plan as never,
      ),
    ).resolves.toMatchObject({
      state: "mismatch",
      verifiedCount: 0,
      totalCount: 1,
      mismatches: [
        expect.objectContaining({
          sourceId: "source-feedstock",
          reason: expect.stringMatching(/intended Datapoint/i),
        }),
      ],
    });
  });

  it("awaits sync while component attributions are not observable", async () => {
    const client = {
      paginateAll: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
    } as unknown as IsometricClient;

    await expect(
      verifyRemovalSourceBindings(client, "ghg-entry-1", plan as never),
    ).resolves.toMatchObject({
      state: "awaiting_sync",
      verifiedCount: 0,
      totalCount: 1,
    });
    expect(client.get).not.toHaveBeenCalled();
  });
});
