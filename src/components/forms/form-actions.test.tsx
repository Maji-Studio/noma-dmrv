// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useForm } from "react-hook-form";
import { LOCK_REFUSAL_ROOT } from "./use-save-refusal";
import { MapControls } from "@/components/map";
import { RefusalSlotContext } from "@/components/ui/refusal-slot-context";
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

/** FormActions with a form whose lock refusal is filed, as `useSaveRefusal` does. */
function LockRefused({ message }: { message: string }) {
  const { control } = useForm({ errors: { root: { lockRefusal: { type: "locked" } } } });
  return <div data-testid="form"><FormActions control={control} errorMessage={message} submitLabel="Save record" /></div>;
}

describe("FormActions refusal on a read-only form", () => {
  const SENT: SubmitBlock = { reason: "Sent", tone: "error", readOnly: true };
  afterEach(cleanup);

  it("portals the error box into the sheet's refusal slot", () => {
    const slot = document.createElement("div");
    document.body.append(slot);
    render(
      <RefusalSlotContext.Provider value={slot}>
        <SubmitBlockContext.Provider value={SENT}>
          <LockRefused message="Locked. Its Removal was sent." />
        </SubmitBlockContext.Provider>
      </RefusalSlotContext.Provider>,
    );
    // A lock refusal says what happened to the edit; the lock line keeps the reason.
    expect(slot.textContent).toBe("Your changes were not saved.");
    expect(slot.textContent).not.toContain("Its Removal was sent.");
    expect(screen.getByTestId("form").textContent).not.toContain("Its Removal was sent.");
    const box = slot.querySelector<HTMLElement>("[data-top-refusal]");
    expect(document.activeElement).toBe(box);
    expect(box?.getAttribute("role")).toBe("group");
    expect(box?.getAttribute("aria-labelledby")).toBe(box?.querySelector("[data-tone]")?.id);
    expect(slot.querySelector('[role="alert"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Save record" })).toBeNull();
    slot.remove();
  });

  it("shows a refusal that is not a lock as the server worded it", () => {
    const slot = document.createElement("div");
    document.body.append(slot);
    function Plain() {
      const { control } = useForm();
      return <FormActions control={control} errorMessage="Updated the application. The photo was not uploaded." />;
    }
    render(
      <RefusalSlotContext.Provider value={slot}>
        <SubmitBlockContext.Provider value={SENT}><Plain /></SubmitBlockContext.Provider>
      </RefusalSlotContext.Provider>,
    );
    expect(slot.textContent).toContain("Updated the application.");
    expect(slot.textContent).toContain("The photo was not uploaded.");
    expect(slot.textContent).not.toContain("Your changes were not saved.");
    slot.remove();
  });

  it("renders the box inline without a slot instead of vanishing", () => {
    render(
      <SubmitBlockContext.Provider value={SENT}>
        <LockRefused message="Locked. Its Removal was sent." />
      </SubmitBlockContext.Provider>,
    );
    expect(screen.getByTestId("form").textContent).toContain("Your changes were not saved.");
    expect(screen.queryByRole("button", { name: "Save record" })).toBeNull();
  });

  it("shows nothing for a read-only form with no refusal", () => {
    render(
      <SubmitBlockContext.Provider value={SENT}>
        <div data-testid="form"><FormActions submitLabel="Save record" /></div>
      </SubmitBlockContext.Provider>,
    );
    expect(screen.getByTestId("form").textContent).toBe("");
  });
});
