import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  legs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/use-transport-legs", () => ({
  useCreateTransportLeg: () => ({ isPending: false }),
  useDeleteTransportLeg: () => ({ isPending: false }),
  useUpdateTransportLeg: () => ({ isPending: false }),
  useTransportLegsForEntity: () => ({
    data: mocks.legs,
    error: null,
    isLoading: false,
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}));

import { TransportLegsEditor } from "./transport-legs-editor";

function savedLeg(patch: Record<string, unknown> = {}) {
  return {
    id: "leg-1",
    originName: "E2E Production facility",
    destinationName: "E2E Regional collection hub",
    distanceKm: 12,
    distanceSource: "manual",
    transportMethodType: "road",
    loadMassKg: 2,
    transportEvidenceDocumentCount: 0,
    ...patch,
  };
}

/** Strip tags so assertions read the rendered text, not the markup. */
function text(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function renderEditor(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <TransportLegsEditor entityType="sample" entityId="sample-1" {...props} />,
  );
}

describe("TransportLegsEditor route rail", () => {
  beforeEach(() => {
    mocks.legs = [savedLeg()];
  });

  it("renders the route as a list of stops, never a table", () => {
    const html = renderEditor({ readOnly: true });

    expect(html).not.toContain("<table");
    expect(html).toContain("<ol");
    expect(html).toContain("E2E Production facility");
    expect(html).toContain("E2E Regional collection hub");
  });

  it("labels the route as a field and names the category for screen readers", () => {
    const html = renderEditor({ readOnly: true });

    expect(html).not.toContain("<h3");
    expect(text(html).startsWith("Route")).toBe(true);
    expect(html).toContain('aria-label="Sample to lab journey"');
  });

  it("shares a stop between chained legs and keeps them in route order", () => {
    mocks.legs = [
      savedLeg(),
      savedLeg({
        id: "leg-2",
        originName: "E2E Regional collection hub",
        destinationName: "E2E Carbon Laboratory",
        distanceKm: 180,
      }),
    ];
    const rendered = text(renderEditor({ readOnly: true }));

    const first = rendered.indexOf("E2E Production facility");
    const middle = rendered.indexOf("E2E Regional collection hub");
    const last = rendered.indexOf("E2E Carbon Laboratory");

    expect(first).toBeGreaterThan(-1);
    expect(middle).toBeGreaterThan(first);
    expect(last).toBeGreaterThan(middle);
    // Three stops for two chained legs: the shared hub is one stop, named
    // once as a stop plus once in the first leg's screen-reader destination.
    expect(rendered.match(/Leg to E2E Regional collection hub/g)).toHaveLength(1);
    expect(rendered.match(/E2E Regional collection hub/g)).toHaveLength(2);
  });

  it("renders a mismatched origin as its own stop instead of merging it", () => {
    mocks.legs = [
      savedLeg(),
      savedLeg({
        id: "leg-2",
        originName: "E2E Depot",
        destinationName: "E2E Carbon Laboratory",
        distanceKm: 180,
      }),
    ];
    const rendered = text(renderEditor({ readOnly: true }));

    for (const stop of [
      "E2E Production facility",
      "E2E Regional collection hub",
      "E2E Depot",
      "E2E Carbon Laboratory",
    ]) {
      expect(rendered).toContain(stop);
    }
  });

  it("reads a leg as mode and one-way distance, with the counted round trip beside it", () => {
    const html = renderEditor({ readOnly: true });
    const rendered = text(html);

    expect(rendered).toContain("Road · 12 km one way");
    expect(rendered).toContain("24 km round trip");
    expect(html).toContain('role="img" aria-label="No evidence"');
    expect(html).not.toContain("Evidence attached");
  });

  it("states a single leg's counted distance once, with its load on the leg", () => {
    const rendered = text(renderEditor({ readOnly: true }));

    expect(rendered.match(/24 km/g)).toHaveLength(1);
    expect(rendered).toContain("Manual entry · 2 kg load");
    expect(rendered).not.toContain("Distance counted");
    expect(rendered).not.toContain("Load carried");
  });

  it("names attached evidence on the icon", () => {
    mocks.legs = [savedLeg({ transportEvidenceDocumentCount: 1 })];
    const html = renderEditor({ readOnly: true });

    expect(html).toContain('role="img" aria-label="Evidence attached"');
  });

  it("names where the distance came from on the leg", () => {
    mocks.legs = [savedLeg({ distanceSource: "map_estimate" })];

    expect(text(renderEditor({ readOnly: true }))).toContain("Route calculation");
  });

  it("totals several legs under the last stop and reads a shared load once", () => {
    mocks.legs = [
      savedLeg(),
      savedLeg({
        id: "leg-2",
        originName: "E2E Regional collection hub",
        destinationName: "E2E Carbon Laboratory",
        distanceKm: 180,
      }),
    ];
    const rendered = text(renderEditor({ readOnly: true }));

    expect(rendered).toContain("Distance counted, all legs 384 km");
    expect(rendered).toContain("Load carried 2 kg");
    expect(rendered).not.toContain("2 kg load");
  });

  it("names each leg's load when the legs carry different loads", () => {
    mocks.legs = [
      savedLeg(),
      savedLeg({
        id: "leg-2",
        originName: "E2E Regional collection hub",
        destinationName: "E2E Carbon Laboratory",
        loadMassKg: 5,
      }),
    ];
    const rendered = text(renderEditor({ readOnly: true }));

    expect(rendered).not.toContain("Load carried");
    expect(rendered).toContain("2 kg load");
    expect(rendered).toContain("5 kg load");
  });

  it("says how many legs the total could not include", () => {
    mocks.legs = [
      savedLeg(),
      savedLeg({
        id: "leg-2",
        originName: "E2E Regional collection hub",
        destinationName: "E2E Carbon Laboratory",
        distanceKm: null,
      }),
    ];
    const rendered = text(renderEditor({ readOnly: true }));

    expect(rendered).toContain("Distance counted, all legs 24 km");
    expect(rendered).toContain("1 leg has no recorded distance.");
  });

  it("carries one CERT chip on the Route label rather than one per leg", () => {
    mocks.legs = [savedLeg(), savedLeg({ id: "leg-2", originName: "E2E Regional collection hub" })];
    const html = renderEditor({ readOnly: true });

    expect(html.match(/data-cert-field=/g)?.length).toBe(1);
  });

  it("drops the CERT chip when the inputs around it carry their own", () => {
    expect(renderEditor({ readOnly: true, certTag: false })).not.toContain("data-cert-field=");
  });

  it("keeps the add button and a per-leg actions menu in edit mode", () => {
    mocks.legs = [
      savedLeg(),
      savedLeg({
        id: "leg-2",
        originName: "E2E Regional collection hub",
        destinationName: "E2E Carbon Laboratory",
      }),
    ];
    const html = renderEditor();

    expect(html).toContain("Add transport leg");
    expect(html).toContain('aria-label="Actions for leg 1"');
    expect(html).toContain('aria-label="Actions for leg 2"');
  });

  it("omits every control in read-only mode", () => {
    const html = renderEditor({ readOnly: true });

    expect(html).not.toContain("Add transport leg");
    expect(html).not.toContain("Actions for leg");
  });

  it("offers no map without coordinates on both ends", () => {
    expect(text(renderEditor({ readOnly: true }))).not.toContain("View map");
  });

  it("reports an unrecorded distance instead of a bare unit", () => {
    mocks.legs = [savedLeg({ distanceKm: null, distanceSource: null })];
    const rendered = text(
      renderToStaticMarkup(
        <TransportLegsEditor
          entityType="feedstock"
          entityId="feedstock-1"
          readOnly
        />,
      ),
    );

    expect(rendered).toContain("Road · distance not recorded");
    expect(rendered).toContain("Distance source not recorded");
    expect(rendered).not.toContain("null km");
  });

  it("names an unrecorded stop rather than leaving the node blank", () => {
    mocks.legs = [savedLeg({ destinationName: null })];
    const rendered = text(renderEditor({ readOnly: true }));

    expect(rendered).toContain("Not recorded");
  });
});
