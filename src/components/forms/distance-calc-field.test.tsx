import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({ isPending: false }));
vi.mock("@/hooks/use-geo", () => ({
  useGeoCapabilities: () => ({ data: { routingConfigured: true } }),
  useRouteDistance: () => ({ isError: false, isPending: routeState.isPending, reset: vi.fn(), mutate: vi.fn() }),
}));
import { DistanceCalcField } from "./distance-calc-field";

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

type Props = Partial<Parameters<typeof DistanceCalcField>[0]>;

/** Renders through the real Tooltip, so the trigger composition is the production one. */
function render(props: Props) {
  return renderToStaticMarkup(<DistanceCalcField {...baseProps} {...props} />);
}

function tagOf(markup: string, pattern: RegExp) {
  const tag = markup.match(pattern)?.[0];
  if (!tag) throw new Error(`No tag matching ${pattern}`);
  return tag;
}

const inputTag = (markup: string) => tagOf(markup, /<input[^>]*id="distanceKm"[^>]*>/);
const buttonTag = (markup: string) => tagOf(markup, /<button[^>]*>/);
const hasAttr = (tag: string, name: string) => new RegExp(`\\s${name}(=|\\s|>|/)`).test(tag);

/** Keyboard stops in the calculate control: focusable wrappers plus enabled buttons. */
function calculateTabStops(markup: string) {
  const action = markup.slice(markup.indexOf(inputTag(markup)) + inputTag(markup).length);
  const wrappers = action.match(/<span[^>]*tabindex="0"[^>]*>/g) ?? [];
  const enabledButtons = (action.match(/<button[^>]*>/g) ?? []).filter(tag => !hasAttr(tag, "disabled"));
  return wrappers.length + enabledButtons.length;
}

describe("DistanceCalcField accessibility", () => {
  it("describes the input by its short helper", () => {
    const input = inputTag(render({ helperText: "Road distance." }));
    expect(input).toContain('aria-describedby="distanceKm-helper"');
  });

  it("describes the input by the error and marks it invalid", () => {
    const input = inputTag(render({ helperText: "Road distance.", error: "Enter a distance." }));
    expect(input).toContain('aria-describedby="distanceKm-error"');
    expect(input).toContain('aria-invalid="true"');
  });
});

describe("DistanceCalcField calculate button", () => {
  const point = { lat: 1, lng: 2 };

  it("is a single tab stop when enabled", () => {
    const markup = render({ origin: point, destination: point });
    expect(calculateTabStops(markup)).toBe(1);
    expect(hasAttr(buttonTag(markup), "disabled")).toBe(false);
  });

  it("stays a single tab stop on the wrapper while the button is disabled", () => {
    const markup = render({});
    expect(calculateTabStops(markup)).toBe(1);
    expect(hasAttr(buttonTag(markup), "disabled")).toBe(true);
  });

  it("shows a spinner, not a text swap, while the route is pending", () => {
    routeState.isPending = true;
    try {
      const markup = render({ origin: point, destination: point });
      const button = buttonTag(markup);
      expect(button).toContain('aria-busy="true"');
      expect(hasAttr(button, "disabled")).toBe(true);
      expect(markup).toMatch(/<button[^>]*>.*Calculate<\/button>/);
    } finally {
      routeState.isPending = false;
    }
  });

  it("uses a sentence case label", () => {
    const markup = render({ origin: point, destination: point });
    expect(markup).toMatch(/<button[^>]*>Calculate<\/button>/);
    expect(buttonTag(markup)).not.toMatch(/class="[^"]*\buppercase\b/);
  });
});
