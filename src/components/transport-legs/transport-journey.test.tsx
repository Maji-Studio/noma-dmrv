import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TransportJourney } from "./transport-journey";
import { buildJourney, type JourneyLegInput } from "./transport-journey-model";

function leg(patch: Partial<JourneyLegInput> = {}): JourneyLegInput {
  return {
    originName: "Supplier yard",
    destinationName: "Plant",
    distanceKm: 15,
    distanceSource: "manual",
    transportMethodType: "road",
    loadMassKg: 2000,
    ...patch,
  };
}

function render(patch: Partial<JourneyLegInput>, evidence?: boolean) {
  const html = renderToStaticMarkup(
    <TransportJourney
      journey={buildJourney([leg(patch)])}
      label="Test journey"
      evidence={evidence === undefined ? undefined : () => evidence}
    />,
  );
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

describe("TransportJourney leg row", () => {
  it("says Not recorded once for a leg without a distance, with no source line", () => {
    const rendered = render({ distanceKm: null, distanceSource: null });

    expect(rendered.match(/Not recorded/g)).toHaveLength(1);
    expect(rendered).toContain("Road");
    expect(rendered).toContain("Load: 2.0 t");
    expect(rendered).not.toContain("Distance source");
    expect(rendered).not.toContain("One way:");
  });

  it("keeps the evidence icon when the no-distance caption has no load", () => {
    const html = renderToStaticMarkup(
      <TransportJourney
        journey={buildJourney([leg({ distanceKm: null, distanceSource: null })], { hideLoad: true })}
        label="Test journey"
        evidence={() => false}
      />,
    );

    expect(html).toContain('aria-label="No evidence"');
  });

  it("renders a leg with a distance as before", () => {
    const rendered = render({});

    expect(rendered).toContain("Road · 15 km one way");
    expect(rendered).toContain("Distance source: Manual entry · Load: 2.0 t");
    expect(rendered).toContain("round trip");
  });
});
