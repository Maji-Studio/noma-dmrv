import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MultilineDetail } from "./multiline-detail";

describe("MultilineDetail", () => {
  it("renders the lead followed by a semantic list", () => {
    expect(renderToStaticMarkup(<MultilineDetail>{"Template blocked.\nRename a component.\nReview settings."}</MultilineDetail>))
      .toBe('Template blocked.<ul class="list-disc pl-16"><li>Rename a component.</li><li>Review settings.</li></ul>');
  });

  it("passes plain text and rich content through unchanged", () => {
    expect(renderToStaticMarkup(<MultilineDetail>Ready to submit.</MultilineDetail>)).toBe("Ready to submit.");
    expect(renderToStaticMarkup(<MultilineDetail><strong>Ready</strong></MultilineDetail>)).toBe("<strong>Ready</strong>");
  });
});
