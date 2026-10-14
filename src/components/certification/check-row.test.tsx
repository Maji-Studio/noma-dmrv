import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckRow } from "./check-row";

describe("CheckRow detail", () => {
  it("renders multiline blocker instructions as list items beneath the lead", () => {
    const html = renderToStaticMarkup(
      <CheckRow status="unmet" label="Template" isFirst detail={"Choose a supported template.\nReplace the transport component.\nReview certification settings."} />,
    );
    expect(html).toContain('Choose a supported template.<ul class="list-disc pl-16"><li>Replace the transport component.</li><li>Review certification settings.</li></ul>');
    expect(html).not.toContain("whitespace-pre-line");
  });

  it("preserves rich detail content", () => {
    const html = renderToStaticMarkup(
      <CheckRow status="met" label="Evidence" isFirst detail={<strong>Evidence recorded</strong>} />,
    );
    expect(html).toContain("<strong>Evidence recorded</strong>");
    expect(html).not.toContain("<ul");
  });
});
