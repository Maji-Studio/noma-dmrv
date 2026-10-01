import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapControls } from "@/components/map";
import { FormActions, reserveStickyFooterSpace } from "./form-actions";

describe("FormActions", () => {
  it("renders an action error inside the sticky footer immediately above the buttons", () => {
    const markup = renderToStaticMarkup(
      <FormActions errorMessage="Action failed" submitLabel="Save record" />,
    );

    const stickyFooterIndex = markup.indexOf("sticky bottom-0");
    const alertIndex = markup.indexOf('role="alert"');
    const buttonRowIndex = markup.indexOf(
      'class="flex items-center justify-start gap-16"',
    );

    expect(stickyFooterIndex).toBeGreaterThanOrEqual(0);
    expect(alertIndex).toBeGreaterThan(stickyFooterIndex);
    expect(buttonRowIndex).toBeGreaterThan(alertIndex);
    expect(markup.match(/role="alert"/g)).toHaveLength(1);
    expect(markup).toContain("Action failed");
  });

  it("does not render an alert without an action error", () => {
    const markup = renderToStaticMarkup(<FormActions submitLabel="Save record" />);

    expect(markup).not.toContain('role="alert"');
  });

  it("stacks the sticky footer above floating map controls", () => {
    const controlsMarkup = renderToStaticMarkup(
      <MapControls
        onZoomIn={() => undefined}
        onZoomOut={() => undefined}
        satOn={false}
        onToggleSat={() => undefined}
      />,
    );
    const footerMarkup = renderToStaticMarkup(
      <FormActions submitLabel="Save record" />,
    );
    const controlsClassName = controlsMarkup.match(
      /class="([^"]*\bz-(\d+)\b[^"]*)"/,
    );
    const footerClassName = footerMarkup.match(/class="([^"]*\bsticky\b[^"]*)"/);
    const controlsZIndex = Number(controlsClassName?.[2] ?? 0);
    const footerZIndex = Number(
      footerClassName?.[1].match(/\bz-(\d+)\b/)?.[1] ?? 0,
    );

    expect(controlsZIndex).toBeGreaterThan(0);
    expect(footerZIndex).toBeGreaterThan(controlsZIndex);
  });

  it("uses a context-specific secondary action label", () => {
    const markup = renderToStaticMarkup(
      <FormActions
        submitLabel="Add facility"
        cancelLabel="Skip setup"
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain("Skip setup");
    expect(markup).not.toContain("Cancel");
  });

  it("keeps Cancel as the default secondary action label", () => {
    const markup = renderToStaticMarkup(
      <FormActions submitLabel="Save record" onCancel={() => undefined} />,
    );

    expect(markup).toContain("Cancel");
  });
});

describe("reserveStickyFooterSpace", () => {
  type FakeNode = {
    parentElement: FakeNode | null;
    overflowY: string;
    offsetHeight: number;
    style: { scrollPaddingBottom: string };
  };
  const node = (parentElement: FakeNode | null, overflowY = "visible"): FakeNode => ({
    parentElement,
    overflowY,
    offsetHeight: 0,
    style: { scrollPaddingBottom: "" },
  });

  let resize: () => void = () => undefined;
  const disconnect = vi.fn();
  const stubDom = () => {
    vi.stubGlobal("getComputedStyle", (el: FakeNode) => ({ overflowY: el.overflowY }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    disconnect.mockClear();
  });

  it("reserves the footer height plus clearance on the nearest scroll container", () => {
    stubDom();
    const scrollport = node(node(null, "auto"), "auto");
    scrollport.style.scrollPaddingBottom = "4px";
    const footer = node(node(scrollport));

    const cleanup = reserveStickyFooterSpace(footer as unknown as HTMLElement);
    footer.offsetHeight = 81;
    resize();
    expect(scrollport.style.scrollPaddingBottom).toBe("89px");

    // An action error makes the row taller; the reservation follows.
    footer.offsetHeight = 140;
    resize();
    expect(scrollport.style.scrollPaddingBottom).toBe("148px");

    cleanup?.();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(scrollport.style.scrollPaddingBottom).toBe("4px");
  });

  it("does nothing without a scroll container", () => {
    stubDom();
    const footer = node(node(null));

    expect(reserveStickyFooterSpace(footer as unknown as HTMLElement)).toBeUndefined();
  });
});
