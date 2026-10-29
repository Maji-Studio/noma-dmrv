import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CreditBatchTimelineFacts } from "@/data-access/credit-batch-timeline-facts";
import { HoverCardBody, type HoverCardBatch } from "./credit-batch-timeline-hover-card";

function batch(overrides: Partial<HoverCardBatch>): HoverCardBatch {
  return {
    code: "CB-001",
    feedstockName: "Pine",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    state: null,
    todoCount: 0,
    facts: undefined,
    factsStatus: "ready",
    ...overrides,
  };
}

describe("HoverCardBody", () => {
  it("heads a named batch with its name and the code beneath", () => {
    const html = renderToStaticMarkup(<HoverCardBody batch={batch({ name: "September maize" })} />);
    expect(html.indexOf("September maize")).toBeGreaterThan(-1);
    expect(html.indexOf("CB-001")).toBeGreaterThan(html.indexOf("September maize"));
  });

  it("heads an unnamed batch with its code alone", () => {
    const html = renderToStaticMarkup(<HoverCardBody batch={batch({ name: null })} />);
    expect(html.match(/CB-001/g)).toHaveLength(1);
  });

  it("leaves out the figures strip when the facts cover neither figure", () => {
    const html = renderToStaticMarkup(<HoverCardBody batch={batch({ facts: undefined, factsStatus: "ready" })} />);

    expect(html).not.toContain("<dl");
    expect(html).not.toContain("Produced (dry)");
  });

  it("keeps the strip with the figure it has", () => {
    const facts = {
      producedDryKg: null,
      appliedDryKg: 500,
      notInRemovalDryKg: 0,
      removalCodes: [],
    } as Partial<CreditBatchTimelineFacts> as CreditBatchTimelineFacts;
    const html = renderToStaticMarkup(<HoverCardBody batch={batch({ facts })} />);

    expect(html).toContain("<dl");
    expect(html).toContain("Applied (dry)");
    expect(html).not.toContain("Produced (dry)");
  });
});
