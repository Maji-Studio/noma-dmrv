import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import type { EntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { EntityCertifyReadinessBadge } from "./entity-certify-readiness-badge";

const READY: EntityCertifyReadiness = {
  state: "ready",
  gaps: [],
  warnings: [],
};
const INCOMPLETE: EntityCertifyReadiness = {
  state: "incomplete",
  gaps: [
    {
      kind: "field",
      key: "organicCarbonPercent",
      label: "Organic carbon",
      fields: ["organicCarbonPercent"],
      detail: "Organic carbon is required",
    },
  ],
  warnings: [],
};

describe("EntityCertifyReadinessBadge scoped copy", () => {
  it("can describe sample chemistry without claiming certification readiness", () => {
    const badge = EntityCertifyReadinessBadge({
      readiness: READY,
      readyLabel: "Chemistry complete",
      readinessNoun: "sample chemistry",
    }) as ReactElement<{
      "aria-label": string;
      children: ReactElement<{ label?: string }>;
    }>;

    expect(badge.props["aria-label"]).toBe("Chemistry complete");
    expect(badge.props.children.props.label).toBe("Chemistry complete");
  });

  it("scopes incomplete accessibility copy to sample chemistry", () => {
    const tooltip = EntityCertifyReadinessBadge({
      readiness: INCOMPLETE,
      readyLabel: "Chemistry complete",
      readinessNoun: "sample chemistry",
    }) as ReactElement<{ children: ReactElement<{ "aria-label": string }> }>;

    expect(tooltip.props.children.props["aria-label"]).toMatch(
      /Incomplete sample chemistry with 1 gap/,
    );
  });

  it("preserves the default certification accessibility copy", () => {
    const tooltip = EntityCertifyReadinessBadge({
      readiness: INCOMPLETE,
    }) as ReactElement<{ children: ReactElement<{ "aria-label": string }> }>;

    expect(tooltip.props.children.props["aria-label"]).toMatch(
      /Incomplete for certification with 1 gap/,
    );
  });

  it("surfaces advisory warnings without marking readiness incomplete", () => {
    const tooltip = EntityCertifyReadinessBadge({
      readiness: {
        state: "ready",
        gaps: [],
        warnings: [
          {
            key: "transportEvidence",
            label: "Transport evidence",
            fields: ["transportEvidenceDocumentCount"],
            detail: "Transport evidence is still required for verification",
          },
        ],
      },
    }) as ReactElement<{
      children: ReactElement<{ "aria-label": string }>;
    }>;

    expect(tooltip.props.children.props["aria-label"]).toMatch(
      /Ready for certification with 1 warning/,
    );
  });
});
