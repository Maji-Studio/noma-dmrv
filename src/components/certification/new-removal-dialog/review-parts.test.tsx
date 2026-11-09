import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PassedChecks } from "./review-parts";

describe("PassedChecks", () => {
  it("shows a count that opens the list of passed checks", async () => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<PassedChecks checks={["Facility linked", "Template set"]} />);
    });
    expect(JSON.stringify(renderer.toJSON())).toContain("passed");
    expect(JSON.stringify(renderer.toJSON())).not.toContain("Template set");
    await act(async () => renderer.root.findByType("button").props.onClick());
    expect(JSON.stringify(renderer.toJSON())).toContain("Facility linked");
    expect(JSON.stringify(renderer.toJSON())).toContain("Template set");
  });

  it("reads 1 check passed in the singular and renders nothing without a passed check", () => {
    expect(renderToStaticMarkup(<PassedChecks checks={["Facility linked"]} />)).toContain("1 check passed");
    expect(renderToStaticMarkup(<PassedChecks checks={[]} />)).toBe("");
  });
});
