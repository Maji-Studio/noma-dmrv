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
});
