import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Base UI tooltips need a DOM this node environment does not have.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  InfoHint: () => null,
}));
vi.mock("@/hooks/use-geo", () => ({
  useGeoCapabilities: () => ({ data: { routingConfigured: true } }),
  useRouteDistance: () => ({ isError: false, isPending: false, reset: vi.fn(), mutate: vi.fn() }),
}));
import { DistanceCalcField } from "./distance-calc-field";

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

const baseProps = {
  id: "distanceKm",
  label: "Distance (km)",
  distanceKm: null,
  distanceSource: null,
  onDistanceChange: () => {},
  origin: null,
  destination: null,
  originLabel: "supplier",
  destinationLabel: "facility",
};

async function mount(props: Partial<Parameters<typeof DistanceCalcField>[0]>) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<DistanceCalcField {...baseProps} {...props} />);
  });
  return renderer;
}

async function render(props: Partial<Parameters<typeof DistanceCalcField>[0]>) {
  const renderer = await mount(props);
  return renderer.root.findByProps({ id: "distanceKm", type: "number" });
}

describe("DistanceCalcField accessibility", () => {
  it("describes the input by its short helper", async () => {
    const input = await render({ helperText: "Road distance." });
    expect(input.props["aria-describedby"]).toBe("distanceKm-helper");
  });

  it("describes the input by the error and marks it invalid", async () => {
    const input = await render({ helperText: "Road distance.", error: "Enter a distance." });
    expect(input.props["aria-describedby"]).toBe("distanceKm-error");
    expect(input.props["aria-invalid"]).toBe(true);
  });
});

describe("DistanceCalcField calculate button", () => {
  const point = { lat: 1, lng: 2 };

  it("is a single tab stop when enabled", async () => {
    const renderer = await mount({ origin: point, destination: point });
    expect(renderer.root.findByType("span").props.tabIndex).toBeUndefined();
    expect(renderer.root.findByType("button").props.disabled).toBeFalsy();
  });

  it("keeps the wrapper focusable while the button is disabled", async () => {
    const renderer = await mount({});
    expect(renderer.root.findByType("span").props.tabIndex).toBe(0);
    expect(renderer.root.findByType("button").props.disabled).toBe(true);
  });

  it("uses a sentence case label", async () => {
    const renderer = await mount({ origin: point, destination: point });
    const button = renderer.root.findByType("button");
    expect(button.children).toContain("Calculate");
    expect(button.props.className).not.toContain("uppercase");
  });
});
