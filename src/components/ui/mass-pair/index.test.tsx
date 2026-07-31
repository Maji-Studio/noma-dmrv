import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MassPair } from "./index";

describe("MassPair", () => {
  it("renders wet and dry values as separately labelled summary figures", () => {
    const html = renderToStaticMarkup(
      <MassPair wetKg={35_740} dryKg={33_926.8} />,
    );

    expect(html).toContain("Wet mass");
    expect(html).toContain("35.74 t");
    expect(html).toContain("Dry mass");
    expect(html).toContain("33.93 t");
    expect(html).toContain("body-large");
    expect(html).toContain("grid-cols-2");
  });

  it("keeps missing dry mass explicit in compact rows", () => {
    const html = renderToStaticMarkup(
      <MassPair
        wetKg={850}
        dryKg={null}
        layout="stacked"
        variant="compact"
      />,
    );

    expect(html).toContain("850 kg");
    expect(html).toContain("Not recorded");
    expect(html).toContain("body-small");
  });
});
