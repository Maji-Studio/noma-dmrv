// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BATCH_EDGES, BATCH_NODES, batchGeo } from "./trace-fixtures";
import { ApplicationTraceMap } from "./application-trace-map";

vi.mock("./lazy-trace-map-canvas", () => ({ LazyTraceMapCanvas: () => <div data-testid="canvas" /> }));
vi.mock("@/hooks/use-media-query", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-chain-of-custody", () => ({
  useChainOfCustodyGeo: () => ({ data: batchGeo(), isLoading: false, error: null }),
}));
vi.mock("@/hooks/use-geo", () => ({ useRouteGeometries: () => ({ data: undefined }) }));

Element.prototype.scrollTo = vi.fn();
Element.prototype.scrollIntoView = vi.fn();
afterEach(cleanup);

const walkPanel = () => screen.getByRole("complementary");

it("opens the application's Map on its own chain walk, first step, with no Whole batch", () => {
  render(<ApplicationTraceMap applicationId="ap1" chainData={undefined} nodes={BATCH_NODES} edges={BATCH_EDGES} />);
  expect(within(walkPanel()).getByText(/01 \/ 05 · To Field A/)).toBeTruthy();
  expect(within(walkPanel()).queryByRole("button", { name: /Whole batch/ })).toBeNull();
});

it("Split: a Flow pick moves the walk, and the Flow lights the current step's records", () => {
  const openSheet = vi.fn();
  render(
    <ApplicationTraceMap
      applicationId="ap1"
      chainData={undefined}
      nodes={BATCH_NODES}
      edges={BATCH_EDGES}
      renderFlow={(focus, pick) => (
        <div>
          <output data-testid="flow-focus">{[...(focus ?? [])].sort().join(",")}</output>
          <button type="button" onClick={() => pick("delivery:dl1") || openSheet("delivery:dl1")}>Flow DL-26-001</button>
          <button type="button" onClick={() => pick("reactor:r1") || openSheet("reactor:r1")}>Flow reactor</button>
        </div>
      )}
    />,
  );
  expect(screen.getByTestId("flow-focus").textContent).toBe("feedstock:fs1,feedstock:fs2");
  fireEvent.click(screen.getByRole("button", { name: "Flow DL-26-001" }));
  expect(within(walkPanel()).getByText(/04 \/ 05/)).toBeTruthy();
  expect(screen.getByTestId("flow-focus").textContent).toBe("delivery:dl1");
  expect(openSheet).not.toHaveBeenCalled();
  // A record on no step (the reactor) leaves the walk where it is; the page
  // opens its sheet instead.
  fireEvent.click(screen.getByRole("button", { name: "Flow reactor" }));
  expect(within(walkPanel()).getByText(/04 \/ 05/)).toBeTruthy();
  expect(openSheet).toHaveBeenCalledWith("reactor:r1");
  fireEvent.click(within(walkPanel()).getByRole("button", { name: /^Next/ }));
  expect(screen.getByTestId("flow-focus").textContent).toBe("application:ap1");
});
