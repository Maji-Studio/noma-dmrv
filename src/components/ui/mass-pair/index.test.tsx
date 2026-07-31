import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MassPair } from "./index";

describe("MassPair", () => {
  it("keeps large split figures in kg so wet and dry values remain comparable", () => {
    const html = renderToStaticMarkup(
      <MassPair wetKg={35_740} dryKg={33_926.8} />,
    );

    expect(html).toContain("Wet mass");
    expect(html).toContain("35,740 kg");
    expect(html).toContain("Dry mass");
    expect(html).toContain("33,926.8 kg");
    expect(html).toContain("grid-cols-2");
  });

  it("does not switch either split figure to tonnes at the threshold", () => {
    const html = renderToStaticMarkup(
      <MassPair wetKg={1_000} dryKg={999.9} />,
    );
    const figureValues = [...html.matchAll(/<dd class="[^"]+">([^<]+)<\/dd>/g)]
      .map(([, value]) => value);

    expect(figureValues).toEqual(["1,000 kg", "999.9 kg"]);
  });

  it("uses local size utilities without overriding mono and weight styles", () => {
    const html = renderToStaticMarkup(
      <MassPair wetKg={1_000} dryKg={900} />,
    );
    const figureClasses = [...html.matchAll(/<dd class="([^"]+)"/g)].map(
      ([, className]) => className,
    );

    expect(figureClasses).toHaveLength(2);
    for (const className of figureClasses) {
      const classTokens = className?.split(" ") ?? [];
      expect(classTokens).toContain("font-mono");
      expect(classTokens).toContain("font-semibold");
      expect(classTokens).toContain("text-[length:var(--text-body-large)]");
      expect(classTokens).not.toContain("body-large");
    }
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
    expect(html).toContain("text-[length:var(--text-body-small)]");
    const figureClasses = [...html.matchAll(/<dd class="([^"]+)"/g)].map(
      ([, className]) => className?.split(" ") ?? [],
    );
    for (const classTokens of figureClasses) {
      expect(classTokens).not.toContain("body-small");
    }
  });
});
