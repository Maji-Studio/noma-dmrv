import { describe, expect, it } from "vitest";
import {
  deriveRemovalReadiness,
  type RemovalReadinessFacts,
  type TransportCoverageFact,
} from "./readiness";

// A fully-ready removal: linked, template clean, runs present, all required
// transport covered. Individual tests override one axis at a time.
function ready(
  overrides: Partial<RemovalReadinessFacts> = {},
): RemovalReadinessFacts {
  return {
    local: null,
    lockInFlight: false,
    hasMapping: true,
    hasDefaultTemplate: true,
    missingDefaultTemplateId: null,
    unresolvedBlueprintKeys: [],
    hasSubmittableRuns: true,
    requiredTransport: [
      { category: "feedstock", count: 2, hasAggregationWarning: false },
      { category: "biochar", count: 1, hasAggregationWarning: false },
    ],
    ...overrides,
  };
}

describe("deriveRemovalReadiness — precedence", () => {
  it("reports inProgress above everything when a lock is live", () => {
    // Even with blockers present, the live lock wins.
    const r = deriveRemovalReadiness(
      ready({ lockInFlight: true, hasMapping: false }),
    );
    expect(r.state).toBe("inProgress");
    expect(r.reasons).toEqual([]);
  });

  it("reports submitted (terminal) for a submitted removal", () => {
    const r = deriveRemovalReadiness(ready({ local: "submitted" }));
    expect(r.state).toBe("submitted");
    expect(r.reasons).toEqual([]);
  });

  it("reports submitted for a superseded removal", () => {
    const r = deriveRemovalReadiness(ready({ local: "superseded" }));
    expect(r.state).toBe("submitted");
  });

  it("treats accepted defensively as submitted (unreachable for removals)", () => {
    const r = deriveRemovalReadiness(ready({ local: "accepted" }));
    expect(r.state).toBe("submitted");
  });
});

describe("deriveRemovalReadiness — ready", () => {
  it("is ready when never submitted and all preconditions met", () => {
    const r = deriveRemovalReadiness(ready());
    expect(r.state).toBe("ready");
    expect(r.reasons).toEqual([]);
  });

  it("is ready from a draft row with no live lock", () => {
    const r = deriveRemovalReadiness(ready({ local: "draft" }));
    expect(r.state).toBe("ready");
  });

  it("re-evaluates a rejected removal for resubmit (ready when clean)", () => {
    const r = deriveRemovalReadiness(ready({ local: "rejected" }));
    expect(r.state).toBe("ready");
  });

  it("is ready when the template requires no transport at all", () => {
    const r = deriveRemovalReadiness(ready({ requiredTransport: [] }));
    expect(r.state).toBe("ready");
  });
});

describe("deriveRemovalReadiness — blocked: linkage & template", () => {
  it("blocks with a single reason when the facility is not linked", () => {
    const r = deriveRemovalReadiness(
      ready({ hasMapping: false, hasDefaultTemplate: false }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toEqual(["Facility not linked to an Isometric project"]);
  });

  it("does not pile linkage reasons on top of missing template", () => {
    // No mapping short-circuits — template/transport reasons are suppressed.
    const r = deriveRemovalReadiness(
      ready({
        hasMapping: false,
        hasDefaultTemplate: false,
        hasSubmittableRuns: false,
      }),
    );
    expect(r.reasons).toHaveLength(1);
  });

  it("blocks when no default template is selected", () => {
    const r = deriveRemovalReadiness(ready({ hasDefaultTemplate: false }));
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain(
      "No default removal template selected for this facility",
    );
  });

  it("blocks when the configured template went missing on Isometric", () => {
    const r = deriveRemovalReadiness(
      ready({ hasDefaultTemplate: false, missingDefaultTemplateId: "tmpl_9" }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons[0]).toContain("tmpl_9");
    expect(r.reasons[0]).toContain("no longer available");
  });

  it("blocks on unresolved blueprint keys with correct pluralisation", () => {
    const one = deriveRemovalReadiness(
      ready({ unresolvedBlueprintKeys: ["k1"] }),
    );
    expect(one.reasons).toContain("Template references 1 unresolved blueprint");

    const many = deriveRemovalReadiness(
      ready({ unresolvedBlueprintKeys: ["k1", "k2"] }),
    );
    expect(many.reasons).toContain("Template references 2 unresolved blueprints");
  });

  it("suppresses transport judgement while the template is unresolved", () => {
    // Template not clean ⇒ required transport unknown ⇒ no transport reasons,
    // even though coverage is empty.
    const empty: TransportCoverageFact[] = [
      { category: "feedstock", count: 0, hasAggregationWarning: false },
    ];
    const r = deriveRemovalReadiness(
      ready({ hasDefaultTemplate: false, requiredTransport: empty }),
    );
    expect(r.reasons.some((m) => m.includes("transport"))).toBe(false);
  });
});

describe("deriveRemovalReadiness — blocked: transport coverage", () => {
  it("blocks on a missing required transport category", () => {
    const r = deriveRemovalReadiness(
      ready({
        requiredTransport: [
          { category: "feedstock", count: 0, hasAggregationWarning: false },
          { category: "biochar", count: 1, hasAggregationWarning: false },
        ],
      }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain("Missing feedstock transport legs");
  });

  it("blocks on incomplete (aggregation-warning) coverage", () => {
    const r = deriveRemovalReadiness(
      ready({
        requiredTransport: [
          { category: "biochar", count: 3, hasAggregationWarning: true },
        ],
      }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain("Incomplete biochar transport legs");
  });

  it("lists missing and incomplete separately across categories", () => {
    const r = deriveRemovalReadiness(
      ready({
        requiredTransport: [
          { category: "feedstock", count: 0, hasAggregationWarning: false },
          { category: "biochar", count: 2, hasAggregationWarning: true },
          { category: "sample", count: 1, hasAggregationWarning: false },
        ],
      }),
    );
    expect(r.reasons).toContain("Missing feedstock transport legs");
    expect(r.reasons).toContain("Incomplete biochar transport legs");
  });
});

describe("deriveRemovalReadiness — blocked: no data", () => {
  it("blocks when there is no production data to submit", () => {
    const r = deriveRemovalReadiness(ready({ hasSubmittableRuns: false }));
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain(
      "No production data linked yet — nothing to submit",
    );
  });

  it("accumulates template + transport + no-data reasons together", () => {
    const r = deriveRemovalReadiness(
      ready({
        hasSubmittableRuns: false,
        requiredTransport: [
          { category: "feedstock", count: 0, hasAggregationWarning: false },
        ],
      }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain("Missing feedstock transport legs");
    expect(r.reasons).toContain(
      "No production data linked yet — nothing to submit",
    );
  });
});
