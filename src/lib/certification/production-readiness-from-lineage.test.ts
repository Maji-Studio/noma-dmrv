import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { productionReadinessGapForScope } from "./production-readiness-from-lineage";

function lineage(args: {
  applicationCode: string;
  linkedRunId: string;
  productionRunId: string | null;
}): ChainOfCustodyData {
  return {
    application: { code: args.applicationCode },
    biocharProduct: { code: "BP-1", linkedProductionRunId: args.linkedRunId },
    productionRun: args.productionRunId
      ? { id: args.productionRunId }
      : null,
  } as ChainOfCustodyData;
}

describe("productionReadinessGapForScope", () => {
  it("blocks a grouped removal when one completed member run lacks an application", () => {
    expect(
      productionReadinessGapForScope({
        lineages: [
          lineage({
            applicationCode: "APP-1",
            linkedRunId: "pr-applied",
            productionRunId: "pr-applied",
          }),
        ],
        completedMemberProductionRunIds: ["pr-applied", "pr-unapplied"],
        scope: "removal",
      }),
    ).toMatchObject({
      kind: "noApplications",
      fixTarget: "applications",
    });
  });

  it("preserves a more specific broken-lineage gap", () => {
    expect(
      productionReadinessGapForScope({
        lineages: [
          lineage({
            applicationCode: "APP-1",
            linkedRunId: "pr-missing",
            productionRunId: null,
          }),
        ],
        completedMemberProductionRunIds: ["pr-unapplied"],
        scope: "removal",
      }),
    ).toMatchObject({
      kind: "productionRunMissing",
      fixTarget: "biocharProducts",
    });
  });
});
