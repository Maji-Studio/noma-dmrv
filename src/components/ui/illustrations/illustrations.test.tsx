import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as set from "./index";
import { ILLUSTRATION_SIZE } from "./index";

const DRAWINGS = Object.entries(set).filter(([name]) => name.endsWith("Art")) as [string, (p: set.IllustrationProps) => React.ReactElement][];

describe("illustrations", () => {
  it("exports the whole set", () => {
    expect(DRAWINGS).toHaveLength(19);
  });

  it.each(DRAWINGS)("%s renders a decorative monoline svg", (_name, Art) => {
    const html = renderToStaticMarkup(<Art className="x" />);
    expect(html).toMatch(/^<svg /);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('fill="none"');
    expect(html).toMatch(/^<svg class="illo x"/);
    expect(html).not.toMatch(/<text|<linearGradient/);
  });

  it.each(DRAWINGS)("%s keeps the on-screen stroke weight at both sizes", (_name, Art) => {
    const width = (html: string) => Number(/stroke-width="([\d.]+)"/.exec(html)?.[1]);
    const card = renderToStaticMarkup(<Art />);
    const empty = renderToStaticMarkup(<Art size={ILLUSTRATION_SIZE.empty} />);
    expect(card).toContain(`width="${ILLUSTRATION_SIZE.card}"`);
    expect(empty).toContain(`width="${ILLUSTRATION_SIZE.empty}"`);
    expect(width(card) * (ILLUSTRATION_SIZE.card / 56)).toBeCloseTo(1.5);
    expect(width(empty) * (ILLUSTRATION_SIZE.empty / 56)).toBeCloseTo(2);
  });

  it.each(DRAWINGS)("%s has a part that moves at card size, and marks large drawings", (_name, Art) => {
    const card = renderToStaticMarkup(<Art />);
    const empty = renderToStaticMarkup(<Art size={ILLUSTRATION_SIZE.empty} />);
    // A card-size drawing still needs one part that plays (not large-only).
    expect(card).toMatch(/class="illo-m illo-[a-z]+"/);
    expect(card).not.toContain("illo-lg\"");
    expect(empty).toMatch(/^<svg class="illo illo-lg"/);
  });
});
