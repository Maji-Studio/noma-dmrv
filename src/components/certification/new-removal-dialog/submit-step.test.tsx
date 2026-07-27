import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SupportingSourcesPreparation } from "./submit-step";

describe("SupportingSourcesPreparation", () => {
  it("shows one workflow-level preparation state", () => {
    const html = renderToStaticMarkup(
      <SupportingSourcesPreparation
        error={null}
        isPending
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("Preparing supporting sources");
    expect(html).toContain("all required evidence");
    expect(html).not.toContain("Retry preparation");
  });

  it("shows one retry action for a failed all-files attempt", () => {
    const html = renderToStaticMarkup(
      <SupportingSourcesPreparation
        error={new Error("Could not prepare all supporting sources")}
        isPending={false}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("Could not prepare all supporting sources");
    expect(html).toContain("Retry preparation");
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain(">Mirror<");
  });
});
