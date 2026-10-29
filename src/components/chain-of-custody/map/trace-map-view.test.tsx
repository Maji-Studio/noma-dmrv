// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { batchModel } from "./trace-fixtures";
import { TraceMapView } from "./trace-map-view";

const canvas = vi.hoisted(() => ({ props: [] as Array<{ frameKey: string }> }));
vi.mock("./lazy-trace-map-canvas", () => ({
  LazyTraceMapCanvas: (props: { frameKey: string }) => {
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
  expect(within(panel()).getByText(/01 \/ 06 · to Field A/)).toBeTruthy();
  fireEvent.click(within(panel()).getByRole("button", { name: /Next/ }));
  expect(within(panel()).getByText(/02 \/ 06/)).toBeTruthy();
  fireEvent.click(within(panel()).getByRole("button", { name: /Whole batch/ }));
  // Back on the list, with the stage the walk began from still open.
  expect(within(panel()).getByText("05 / 05 · Application")).toBeTruthy();
  expect(within(panel()).getByRole("button", { name: /Field B/ })).toBeTruthy();
});

it("starts a mid-chain record at itself", () => {
  render(<TraceMapView model={batchModel()} routeGeometries={undefined} onTrace={vi.fn()} />);
  fireEvent.click(within(panel()).getByRole("button", { name: /Production run/ }));
  fireEvent.click(within(panel()).getByRole("button", { name: /PR-26-001/ }));
  expect(within(panel()).getByText(/03 \/ 06/)).toBeTruthy();
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
  for (let step = 0; step < 5; step++) fireEvent.click(within(panel()).getByRole("button", { name: /^Next/ }));
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
