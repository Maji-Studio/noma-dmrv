import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchEnabled: [] as boolean[] }));

vi.mock("@/hooks/use-transport-legs", () => ({
  useCreateTransportLeg: () => ({ isPending: false }),
  useDeleteTransportLeg: () => ({ isPending: false }),
  useUpdateTransportLeg: () => ({ isPending: false }),
  useTransportLegsForEntity: (_type: string, _id: string, options: { enabled: boolean }) => {
    mocks.fetchEnabled.push(options.enabled);
    return { data: [], error: null, isLoading: false };
  },
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));

import { TransportRoutePreview } from "./transport-route-preview";

function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

const ROUTE = {
  entityType: "biochar" as const,
  originName: "Mafinga Facility",
  destinationName: "Demo coffee field",
  distanceKm: 240,
  distanceSource: "manual" as const,
  loadMassKg: 400,
  emptyMessage: "Nothing to draw yet.",
};

describe("TransportRoutePreview", () => {
  it("draws the caller's route without fetching saved legs or offering edits", () => {
    mocks.fetchEnabled = [];
    const html = renderToStaticMarkup(<TransportRoutePreview {...ROUTE} />);
    const rendered = text(html);

    // Drawn from the caller's values: no saved-leg query, no mutation hooks.
    expect(mocks.fetchEnabled).toEqual([]);
    expect(rendered).toContain("Mafinga Facility");
    expect(rendered).toContain("Demo coffee field");
    expect(rendered).toContain("Road · 240 km one way");
    expect(rendered).toContain("480 km round trip");
    expect(rendered).toContain("Load: 400 kg");
    expect(rendered).not.toContain("Add transport leg");
    expect(html).not.toContain("Actions for leg");
  });

  it("hides the evidence icon unless the caller knows the evidence state", () => {
    expect(renderToStaticMarkup(<TransportRoutePreview {...ROUTE} />)).not.toContain("No evidence");
    expect(renderToStaticMarkup(<TransportRoutePreview {...ROUTE} evidenceAttached />)).toContain("Evidence attached");
  });

  it("draws a planned route without a load or a CERT chip", () => {
    const html = renderToStaticMarkup(<TransportRoutePreview {...ROUTE} plannedRoute certTag />);

    expect(text(html)).not.toContain("400 kg");
    expect(html).not.toContain("data-cert-field=");
  });

  it("carries the CERT chip only when asked, as read views do", () => {
    expect(renderToStaticMarkup(<TransportRoutePreview {...ROUTE} />)).not.toContain("data-cert-field=");
    expect(renderToStaticMarkup(<TransportRoutePreview {...ROUTE} saved certTag />)).toContain("data-cert-field=");
  });

  it("draws a located route without a distance so its map stays reachable", () => {
    const rendered = text(renderToStaticMarkup(
      <TransportRoutePreview
        {...ROUTE}
        distanceKm={null}
        plannedRoute
        originPoint={{ lat: -8.3, lng: 35.28 }}
        destinationPoint={{ lat: -8.91, lng: 33.46 }}
      />,
    ));

    expect(rendered).toContain("Road · One way: Not recorded");
    expect(rendered).not.toContain("Nothing to draw yet.");
  });

  it("shows the empty message until there is a distance, a load or both ends located", () => {
    const rendered = text(renderToStaticMarkup(
      <TransportRoutePreview {...ROUTE} distanceKm={null} loadMassKg={0} />,
    ));

    expect(rendered).toContain("Nothing to draw yet.");
    expect(rendered).not.toContain("Mafinga Facility");
  });
});
