import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
