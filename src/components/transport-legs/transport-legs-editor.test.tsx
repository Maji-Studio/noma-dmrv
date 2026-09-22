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

describe("TransportLegsEditor journey timeline", () => {
  beforeEach(() => {
    mocks.legs = [savedLeg()];
  });

  it("renders the journey as a list of stops, never a table", () => {
    const html = renderEditor({ readOnly: true });

    expect(html).not.toContain("<table");
    expect(html).toContain("<ol");
    expect(html).toContain("E2E Production facility");
    expect(html).toContain("E2E Regional collection hub");
  });

  it("names the route category in a caption and labels the timeline with it", () => {
    const html = renderEditor({ readOnly: true });

    expect(html).not.toContain("<h3");
    expect(html).not.toContain("Transport: Sample to lab");
    expect(html).toContain("Sample to lab");
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
    // Three stops for two chained legs: the shared hub is one node, named
    // once as a stop plus once in the first leg's screen-reader destination.
    expect(rendered.match(/Leg to E2E Regional collection hub/g)).toHaveLength(
      1,
    );
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

  it("carries the mode, the distance source and the distance on the leg box", () => {
    const rendered = text(renderEditor({ readOnly: true }));

    expect(rendered).toContain("Road, manual entry");
    expect(rendered).toContain("12 km");
    expect(rendered).toContain("Evidence None");
  });

  it("keeps the distance source visible in read-only mode", () => {
    mocks.legs = [savedLeg({ distanceSource: "map_estimate" })];
    const rendered = text(renderEditor({ readOnly: true }));

    expect(rendered).toContain("Road, route calculation");
  });

  it("totals the journey under the final stop", () => {
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

    expect(rendered).toContain("Total distance 192 km");
    // The same cargo moves along both legs, so the load is reported once.
    expect(rendered).toContain("Load carried 2 kg");
  });

  it("reports the load as a range when the legs carry different loads", () => {
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

    expect(rendered).toContain("Load carried 2 kg to 5 kg");
  });

  it("says how many legs the total distance could not include", () => {
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

    expect(rendered).toContain("Total distance 12 km");
    expect(rendered).toContain("1 leg has no recorded distance.");
  });

  it("carries one section CERT chip rather than one per leg", () => {
    const html = renderEditor({ readOnly: true });

    expect(html.match(/CERT/g)?.length).toBe(1);
  });

  it("keeps the add, edit and delete controls in edit mode", () => {
    const html = renderEditor();

    expect(html).toContain("Add transport leg");
    expect(html).toContain('aria-label="Edit transport leg"');
    expect(html).toContain('aria-label="Delete transport leg"');
  });

  it("omits every control in read-only mode", () => {
    const html = renderEditor({ readOnly: true });

    expect(html).not.toContain("Add transport leg");
    expect(html).not.toContain('aria-label="Edit transport leg"');
    expect(html).not.toContain('aria-label="Delete transport leg"');
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

    expect(rendered).toContain("Not recorded");
    expect(rendered).not.toContain("null km");
  });

  it("names an unrecorded stop rather than leaving the node blank", () => {
    mocks.legs = [savedLeg({ destinationName: null })];
    const rendered = text(renderEditor({ readOnly: true }));

    expect(rendered).toContain("Not recorded");
  });
});
