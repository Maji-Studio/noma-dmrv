import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Notice, type NoticeTone } from "./index";

const html = (tone: NoticeTone) =>
  renderToStaticMarkup(
    <Notice tone={tone}>
      Saving changes the stock.
    </Notice>,
  );

describe("Notice", () => {
  it.each([
    ["info", "status"],
    ["warning", "status"],
    ["success", "status"],
    ["error", "alert"],
  ] as const)("%s announces as role=%s", (tone, role) => {
    expect(html(tone)).toContain(`role="${role}"`);
  });

  it("defaults to a warning", () => {
    expect(renderToStaticMarkup(<Notice>Check this.</Notice>)).toContain(
      'data-tone="warning"',
    );
  });

  it("hides the icon from assistive tech", () => {
    for (const tone of ["info", "warning", "success", "error"] as const) {
      const svg = html(tone).match(/<svg[^>]*>/)?.[0] ?? "";
      expect(svg).toContain('aria-hidden="true"');
    }
  });

  it("tints only the blocking tone", () => {
    expect(html("error")).toContain("--st-bad-bg");
    for (const tone of ["info", "warning", "success"] as const) {
      expect(html(tone)).not.toContain("-bg)");
    }
  });

  it("renders a title, the line and an action in order", () => {
    const out = renderToStaticMarkup(
      <Notice title="Over delivery" action={<a href="/x">Open batch</a>}>
        1 kg over.
      </Notice>,
    );

    expect(out.indexOf("Over delivery")).toBeLessThan(out.indexOf("1 kg over."));
    expect(out.indexOf("1 kg over.")).toBeLessThan(out.indexOf("Open batch"));
  });
});
