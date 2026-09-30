import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoHint } from "./index";

describe("InfoHint", () => {
  it("describes its trigger with the explanation's text and adds no hidden copy", () => {
    const markup = renderToStaticMarkup(
      <h3>
        Supporting evidence
        <InfoHint label="About evidence">
          <>From the reading on <strong>Sep 15</strong>. Wet basis.</>
        </InfoHint>
      </h3>,
    );

    expect(markup).toContain('aria-description="From the reading on Sep 15. Wet basis."');
    expect(markup).not.toMatch(/\shidden(=|>|\s)/);
    // The heading's own text stays exactly its title.
    expect(markup.replace(/<button[\s\S]*<\/button>/, "")).toBe("<h3>Supporting evidence</h3>");
  });

  it("points at an existing description instead when given one", () => {
    const markup = renderToStaticMarkup(
      <InfoHint label="More about Mass" descriptionId="mass-helper">As-received weight.</InfoHint>,
    );

    expect(markup).toContain('aria-describedby="mass-helper"');
    expect(markup).not.toContain("aria-description=");
  });
});
