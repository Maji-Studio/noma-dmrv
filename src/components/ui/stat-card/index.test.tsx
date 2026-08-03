import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MassPair } from "@/components/ui/mass-pair";
import { StatCard } from "./index";

describe("StatCard", () => {
  it("gives a structured breakdown the full card width without headline typography", () => {
    const html = renderToStaticMarkup(
      <StatCard
        title="Product Mass"
        value={<MassPair wetKg={35_740} dryKg={33_926.8} />}
        valueLayout="breakdown"
        description="Current page"
      />,
    );

    expect(html).toContain("Product Mass");
    expect(html).toContain("Wet mass");
    expect(html).toContain("Dry mass");
    expect(html).not.toContain("title-heading-3");
  });

  it("preserves headline typography for a single value", () => {
    const html = renderToStaticMarkup(
      <StatCard title="Total Products" value={12} />,
    );

    expect(html).toContain("title-heading-3");
  });
});
