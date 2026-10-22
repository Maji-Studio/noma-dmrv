import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapControls } from "@/components/map";
import { SubmitBlockContext, type SubmitBlock } from "@/components/ui/submit-block-context";
import { FormActions, reserveStickyFooterSpace } from "./form-actions";

describe("FormActions", () => {
  it("renders an action error as flow content directly above the sticky footer", () => {
    const markup = renderToStaticMarkup(
      <FormActions errorMessage="Action failed" submitLabel="Save record" />,
    );

    const stickyFooterIndex = markup.indexOf("sticky bottom-0");
    const alertIndex = markup.indexOf('role="alert"');
    const buttonRowIndex = markup.indexOf(
      'class="flex items-center justify-start gap-16"',
    );

    expect(stickyFooterIndex).toBeGreaterThanOrEqual(0);
    expect(alertIndex).toBeGreaterThanOrEqual(0);
    expect(alertIndex).toBeLessThan(stickyFooterIndex);
    expect(buttonRowIndex).toBeGreaterThan(stickyFooterIndex);
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

  it("hides an unnecessary submit action without leaving an empty footer", () => {
    const markup = renderToStaticMarkup(<FormActions showSubmit={false} submitLabel="Save keys" />);
    expect(markup).not.toContain("Save keys");
    expect(markup).not.toContain("border-t");
  });

  it("renders secondary submit actions with the outline style", () => {
    const markup = renderToStaticMarkup(<FormActions submitLabel="Link project" submitVariant="default" />);
    expect(markup).toContain("bg-transparent");
    expect(markup).not.toContain("text-white");
  });

  it("keeps Cancel as the default secondary action label", () => {
    const markup = renderToStaticMarkup(
      <FormActions submitLabel="Save record" onCancel={() => undefined} />,
    );

    expect(markup).toContain("Cancel");
  });
});

describe("FormActions preview slot", () => {
  const PREVIEW = <p data-testid="association-preview">Credit batch: CB-1</p>;

  it("renders the preview after the action error and directly above the buttons", () => {
    const markup = renderToStaticMarkup(
      <FormActions errorMessage="Action failed" submitLabel="Save record" preview={PREVIEW} />,
    );
    const alertIndex = markup.indexOf('role="alert"');
    const previewIndex = markup.indexOf('data-testid="association-preview"');
    const buttonRowIndex = markup.indexOf('class="flex items-center justify-start gap-16"');

    expect(alertIndex).toBeGreaterThanOrEqual(0);
    expect(previewIndex).toBeGreaterThan(alertIndex);
    expect(buttonRowIndex).toBeGreaterThan(previewIndex);
    expect(markup.indexOf("sticky bottom-0")).toBeLessThan(previewIndex);
  });

  it("sits below why Save is off, and never disables Save itself", () => {
    const block: SubmitBlock = { reason: "Checking the record lock.", tone: "info", readOnly: false };
    const blocked = renderToStaticMarkup(
      <SubmitBlockContext.Provider value={block}>
        <FormActions submitLabel="Save record" preview={PREVIEW} />
      </SubmitBlockContext.Provider>,
    );
    expect(blocked.indexOf("Checking the record lock.")).toBeLessThan(blocked.indexOf("association-preview"));

    const open = renderToStaticMarkup(<FormActions submitLabel="Save record" preview={PREVIEW} />);
    expect(open).toContain("association-preview");
    const submit = open.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
    expect(submit).not.toBe("");
    expect(submit).not.toMatch(/\sdisabled(="[^"]*")?[\s>]/);
  });

  it("is hidden with the footer on a read-only form", () => {
    const block: SubmitBlock = { reason: "Sent", tone: "error", readOnly: true };
    const markup = renderToStaticMarkup(
      <SubmitBlockContext.Provider value={block}>
        <FormActions submitLabel="Save record" preview={PREVIEW} />
      </SubmitBlockContext.Provider>,
    );
    expect(markup).not.toContain("association-preview");
  });

  it("keeps the submit button tied to its form id", () => {
    const markup = renderToStaticMarkup(<FormActions submitLabel="Save record" formId="run-form" preview={PREVIEW} />);
    expect(markup).toMatch(/<button[^>]*form="run-form"/);
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
