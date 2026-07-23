import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PeriodWindow } from "./ghg-statement-create-dialog";

describe("PeriodWindow", () => {
  it("shows Isometric-owned first start and the chosen end", () => {
    const html = renderToStaticMarkup(
      <PeriodWindow derivedStart={null} endOn="2026-07-31" />,
    );

    expect(html).toContain("Start");
    expect(html).toContain("Set by Isometric");
    expect(html).toContain("End");
    expect(html).toContain("Jul 31, 2026");
  });

  it("shows the derived start for later statements", () => {
    const html = renderToStaticMarkup(
      <PeriodWindow
        derivedStart="2026-07-01"
        endOn="2026-07-31"
      />,
    );

    expect(html).toContain("Start");
    expect(html).toContain("Jul 1, 2026");
    expect(html).toContain("End");
    expect(html).toContain("Jul 31, 2026");
  });
});
