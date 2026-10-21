// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderDom, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StepFlow } from ".";

describe("StepFlow", () => {
  it("keeps horizontal step labels readable and lets the rail scroll", () => {
    const html = renderToStaticMarkup(
      <StepFlow
        current={0}
        steps={[
          { key: "select", label: "Select batches" },
          { key: "submit", label: "Confirm & submit" },
        ]}
      >
        <div>Current step</div>
      </StepFlow>,
    );

    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("shrink-0 gap-8");
    expect(html).not.toContain("truncate transition-colors");
  });

  it("truncates vertical labels inside the fixed-width rail", () => {
    const html = renderToStaticMarkup(
      <StepFlow
        current={0}
        orientation="vertical"
        steps={[
          {
            key: "details",
            label: "A deliberately long step label",
            description: "A deliberately long description",
          },
        ]}
      >
        <div>Current step</div>
      </StepFlow>,
    );

    expect(html).toContain("body-small transition-colors truncate");
    expect(html).not.toContain("body-small transition-colors whitespace-nowrap");
  });
});

describe("StepFlow on a phone", () => {
  const steps = [
    { key: "select", label: "Select batches" },
    { key: "empty", label: "Empty components" },
    { key: "submit", label: "Confirm & submit" },
  ];

  function render(orientation?: "vertical") {
    return renderToStaticMarkup(
      <StepFlow current={1} steps={steps} orientation={orientation}>
        <div>Current step</div>
      </StepFlow>,
    );
  }

  it("hides every step but the current one below sm and says which step it is", () => {
    const html = render();
    expect(html.match(/max-sm:hidden/g)).toHaveLength(2 + 2); // two other steps, two connectors
    expect(html).toContain("Step 2 of 3");
    // Only the current step carries the caption.
    expect(html.match(/ of 3/g)).toHaveLength(1);
  });

  it("does the same in the vertical rail", () => {
    const html = render("vertical");
    expect(html.match(/max-sm:hidden/g)).toHaveLength(2);
    expect(html).toContain("Step 2 of 3");
  });
});

describe("StepFlow phoneBack", () => {
  const steps = [
    { key: "select", label: "Select batches" },
    { key: "empty", label: "Empty components" },
    { key: "submit", label: "Confirm & submit" },
  ];
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function phone(matches: boolean) {
    vi.stubGlobal("matchMedia", () => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  }
  function flow(props: { phoneBack?: boolean; canNavigate?: (index: number) => boolean; onNavigate?: (index: number) => void }) {
    renderDom(
      <StepFlow current={2} furthest={2} steps={steps} onNavigate={props.onNavigate} canNavigate={props.canNavigate} phoneBack={props.phoneBack}>
        <div>Current step</div>
      </StepFlow>,
    );
  }

  it("offers Back to the nearest earlier step canNavigate allows, and calls onNavigate with it", () => {
    phone(true);
    const onNavigate = vi.fn();
    flow({ phoneBack: true, onNavigate, canNavigate: (index) => index === 1 });
    const back = screen.getByRole("button", { name: "Back to Empty components" });
    expect(back.className).toContain("min-h-44");
    fireEvent.click(back);
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it("is off unless asked for", () => {
    phone(true);
    flow({ onNavigate: vi.fn() });
    expect(screen.queryByText(/^Back to/)).toBeNull();
  });

  it("is absent on a wider screen, without a navigable earlier step, and without onNavigate", () => {
    phone(false);
    flow({ phoneBack: true, onNavigate: vi.fn() });
    expect(screen.queryByText(/^Back to/)).toBeNull();
    cleanup();
    phone(true);
    flow({ phoneBack: true, onNavigate: vi.fn(), canNavigate: () => false });
    expect(screen.queryByText(/^Back to/)).toBeNull();
    cleanup();
    flow({ phoneBack: true });
    expect(screen.queryByText(/^Back to/)).toBeNull();
  });
});
