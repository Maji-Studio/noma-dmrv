import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompilationBlockers } from "./compilation-notices";

describe("CompilationBlockers", () => {
  it("renders multiline instructions as a nested list", () => {
    const html = renderToStaticMarkup(<CompilationBlockers blockers={["Template blocked.\nRename a component."]} />);
    expect(html).toContain('Template blocked.<ul class="list-disc pl-16"><li>Rename a component.</li></ul>');
    expect(html).not.toContain("whitespace-pre-line");
  });
});
