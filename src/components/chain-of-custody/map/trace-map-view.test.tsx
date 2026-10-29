// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { batchModel } from "./trace-fixtures";
import { TraceMapView } from "./trace-map-view";

const canvas = vi.hoisted(() => ({ props: [] as Array<{ frameKey: string; onMarkerClick?: (nodeId: string) => void }> }));
vi.mock("./lazy-trace-map-canvas", () => ({
  LazyTraceMapCanvas: (props: { frameKey: string; onMarkerClick?: (nodeId: string) => void }) => {
    canvas.props.push(props);
    return <div data-testid="canvas" />;
  },
}));
vi.mock("@/hooks/use-media-query", () => ({ useIsMobile: () => false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// jsdom has no element scrolling; the list scrolls to the open stage or step.
Element.prototype.scrollTo = vi.fn();

afterEach(() => {
  cleanup();
  canvas.props.length = 0;
});

const panel = () => screen.getByRole("complementary");

it("rests on the stage list and opens a stage with its records", () => {
  render(<TraceMapView model={batchModel()} routeGeometries={undefined} onTrace={vi.fn()} />);
  expect(within(panel()).queryByRole("button", { name: /Back/ })).toBeNull();
  fireEvent.click(within(panel()).getByRole("button", { name: /Application/ }));
  expect(within(panel()).getByText("Field A")).toBeTruthy();
  expect(within(panel()).getByText("Field B")).toBeTruthy();
});

it("starts a chain walk at the supplier from a field and leaves with Whole batch", () => {
  render(<TraceMapView model={batchModel()} routeGeometries={undefined} onTrace={vi.fn()} />);
  fireEvent.click(within(panel()).getByRole("button", { name: /Application/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /Field A/ }));
  expect(within(panel()).getByText(/01 \/ 05 · To Field A/)).toBeTruthy();
  fireEvent.click(within(panel()).getByRole("button", { name: /Next/ }));
  expect(within(panel()).getByText(/02 \/ 05/)).toBeTruthy();
  fireEvent.click(within(panel()).getByRole("button", { name: /Whole batch/ }));
  // Back on the list, with the stage the walk began from still open.
  expect(within(panel()).getByText("05 / 05 · Application")).toBeTruthy();
  expect(within(panel()).getByRole("button", { name: /Field B/ })).toBeTruthy();
});

it("starts a mid-chain record at itself", () => {
  render(<TraceMapView model={batchModel()} routeGeometries={undefined} onTrace={vi.fn()} />);
  fireEvent.click(within(panel()).getByRole("button", { name: /Production run/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /PR-26-001/ }));
  expect(within(panel()).getByText(/02 \/ 05/)).toBeTruthy();
});

it("walks converging intakes as one step and opens a picked record inside it", () => {
  render(<TraceMapView model={batchModel()} routeGeometries={undefined} onTrace={vi.fn()} />);
  fireEvent.click(within(panel()).getByRole("button", { name: /Feedstock intake/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /FS-26-002/ }));
  expect(within(panel()).getByText("2 feedstock intakes")).toBeTruthy();
  expect(within(panel()).getByText(/01 \/ 05/)).toBeTruthy();
  expect(within(panel()).getByRole("button", { name: /FS-26-001/ }).getAttribute("aria-expanded")).toBe("false");
  expect(within(panel()).getByRole("button", { name: /FS-26-002/ }).getAttribute("aria-expanded")).toBe("true");
  expect(within(panel()).getByRole("link", { name: /View full record/ })).toBeTruthy();
  // One open at a time.
  fireEvent.click(within(panel()).getByRole("button", { name: /FS-26-001/ }));
  expect(within(panel()).getByRole("button", { name: /FS-26-002/ }).getAttribute("aria-expanded")).toBe("false");
});

const clickMarker = (nodeId: string) => act(() => canvas.props.at(-1)!.onMarkerClick!(nodeId));
const startAtFieldA = () => {
  fireEvent.click(within(panel()).getByRole("button", { name: /Application/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /Field A/ }));
};

it("scrolls to the opened member of a grouped step, not to the group's header", () => {
  const { container } = render(<TraceMapView model={batchModel()} routeGeometries={undefined} onTrace={vi.fn()} />);
  startAtFieldA();
  expect(container.querySelectorAll("[data-scroll-target]")).toHaveLength(1);
  clickMarker("feedstock:fs2");
  const target = container.querySelector("[data-scroll-target]")!;
  expect(container.querySelectorAll("[data-scroll-target]")).toHaveLength(1);
  expect(within(target.closest("li")!).getByRole("button", { name: /FS-26-002/ })).toBeTruthy();
  clickMarker("feedstock:fs1");
  expect(within(container.querySelector("[data-scroll-target]")!.closest("li")!).getByRole("button", { name: /FS-26-001/ })).toBeTruthy();
});

it("clears the opened record when stepping away and back", () => {
  render(<TraceMapView model={batchModel()} routeGeometries={undefined} onTrace={vi.fn()} />);
  fireEvent.click(within(panel()).getByRole("button", { name: /Feedstock intake/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /FS-26-002/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /^Next/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /^Back/ }));
  expect(within(panel()).getByRole("button", { name: /FS-26-002/ }).getAttribute("aria-expanded")).toBe("false");
});

it("a marker inside the active chain jumps to its step; one outside starts its own chain", () => {
  render(<TraceMapView model={batchModel()} routeGeometries={undefined} onTrace={vi.fn()} />);
  startAtFieldA();
  clickMarker("feedstock:fs2");
  expect(within(panel()).getByText(/01 \/ 05 · To Field A/)).toBeTruthy();
  expect(within(panel()).getByRole("button", { name: /FS-26-002/ }).getAttribute("aria-expanded")).toBe("true");
  clickMarker("application:ap2");
  expect(within(panel()).getByText(/01 \/ 05 · To Field B/)).toBeTruthy();
});

it("shows an empty state instead of the map when nothing has a location, and keeps the list", () => {
  const model = batchModel({
    facility: { id: "fac-1", code: "FAC-1", name: "Mafinga", lat: null, lng: null },
    nodes: [],
    legs: [],
  });
  render(<TraceMapView model={model} routeGeometries={undefined} onTrace={vi.fn()} />);
  expect(screen.getByText("Nothing to place on the map yet")).toBeTruthy();
  expect(screen.queryByTestId("canvas")).toBeNull();
  expect(within(panel()).getByText("Feedstock intake")).toBeTruthy();
});

it("shows the payload's warnings over the map", () => {
  const model = batchModel({ warnings: ["One leg has no distance."] });
  render(<TraceMapView model={model} routeGeometries={undefined} onTrace={vi.fn()} />);
  expect(screen.getByText("One leg has no distance.")).toBeTruthy();
});

it("offers Back only after the first step and Next only before the last", () => {
  render(<TraceMapView model={batchModel()} routeGeometries={undefined} onTrace={vi.fn()} />);
  fireEvent.click(within(panel()).getByRole("button", { name: /Application/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /Field A/ }));
  expect(within(panel()).queryByRole("button", { name: /^Back/ })).toBeNull();
  for (let step = 0; step < 4; step++) fireEvent.click(within(panel()).getByRole("button", { name: /^Next/ }));
  expect(within(panel()).queryByRole("button", { name: /^Next/ })).toBeNull();
  expect(within(panel()).getByRole("button", { name: /^Back/ })).toBeTruthy();
});

it("says a delivery has no location rather than placing it at the facility", () => {
  render(<TraceMapView model={batchModel()} routeGeometries={undefined} onTrace={vi.fn()} />);
  expect(within(panel()).getByText("1 delivery · no location recorded")).toBeTruthy();
});

it("says so when the batch has no records", () => {
  const model = { ...batchModel(), stages: [] };
  render(<TraceMapView model={model} routeGeometries={undefined} onTrace={vi.fn()} />);
  expect(within(panel()).getByText("No records in this batch yet")).toBeTruthy();
});
