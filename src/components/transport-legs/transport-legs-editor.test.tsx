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

describe("TransportLegsEditor read-only presentation", () => {
  beforeEach(() => {
    mocks.legs = [savedLeg()];
  });

  it("stacks each leg instead of tabulating it", () => {
    const html = renderToStaticMarkup(
      <TransportLegsEditor entityType="sample" entityId="sample-1" readOnly />,
    );

    expect(html).not.toContain("<table");
    expect(html).toContain("<li");
    expect(html).toContain("E2E Production facility");
    expect(html).toContain("E2E Regional collection hub");
  });

  it("names the route category in a caption, never a heading", () => {
    const html = renderToStaticMarkup(
      <TransportLegsEditor entityType="sample" entityId="sample-1" readOnly />,
    );

    expect(html).not.toContain("<h3");
    expect(html).not.toContain("Transport: Sample to lab");
    expect(html).toContain("Sample to lab");
  });

  it("drops the provenance card and its leg count", () => {
    const html = renderToStaticMarkup(
      <TransportLegsEditor entityType="sample" entityId="sample-1" readOnly />,
    );

    expect(html).not.toContain("Transport provenance");
    expect(html).not.toContain("recorded transport leg");
    expect(html).not.toContain("Details");
  });

  it("labels every leg fact so nothing reads as a bare number", () => {
    const html = renderToStaticMarkup(
      <TransportLegsEditor entityType="sample" entityId="sample-1" readOnly />,
    );

    for (const label of ["Distance", "Method", "Load", "Evidence"]) {
      expect(html).toContain(`>${label}</dt>`);
    }
    expect(html).toContain("12 km");
    expect(html).toContain("Road");
    expect(html).toContain("2 kg");
    expect(html).toContain("None");
  });

  it("carries one section CERT chip rather than one per column header", () => {
    const html = renderToStaticMarkup(
      <TransportLegsEditor entityType="sample" entityId="sample-1" readOnly />,
    );

    expect(html.match(/CERT/g)?.length).toBe(1);
  });

  it("keeps the add, edit and delete controls in edit mode", () => {
    const html = renderToStaticMarkup(
      <TransportLegsEditor entityType="sample" entityId="sample-1" />,
    );

    expect(html).toContain("Add leg");
    expect(html).toContain('aria-label="Edit transport leg"');
    expect(html).toContain('aria-label="Delete transport leg"');
  });

  it("reports an unrecorded distance instead of a bare unit", () => {
    mocks.legs = [savedLeg({ distanceKm: null, distanceSource: null })];
    const html = renderToStaticMarkup(
      <TransportLegsEditor entityType="feedstock" entityId="feedstock-1" readOnly />,
    );

    expect(html).toContain("Not recorded");
    expect(html).not.toContain("null km");
  });
});
