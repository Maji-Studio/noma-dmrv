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

    expect(mocks.fetchEnabled).toEqual([false]);
    expect(rendered).toContain("Mafinga Facility");
    expect(rendered).toContain("Demo coffee field");
    expect(rendered).toContain("240 km one way by road");
    expect(rendered).toContain("480 km round trip counted");
    expect(rendered).toContain("400 kg");
    expect(rendered).not.toContain("Add transport leg");
    expect(html).not.toContain("Actions for leg");
  });

  it("hides the evidence icon unless the caller knows the evidence state", () => {
    expect(renderToStaticMarkup(<TransportRoutePreview {...ROUTE} />)).not.toContain("No evidence");
    expect(renderToStaticMarkup(<TransportRoutePreview {...ROUTE} evidenceAttached />)).toContain("Evidence attached");
  });

  it("shows the empty message until there is a distance or a load", () => {
    const rendered = text(renderToStaticMarkup(
      <TransportRoutePreview {...ROUTE} distanceKm={null} loadMassKg={0} />,
    ));

    expect(rendered).toContain("Nothing to draw yet.");
    expect(rendered).not.toContain("Mafinga Facility");
  });
});
