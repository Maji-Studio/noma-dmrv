/**
 * The custom-property gate's parser. An undefined `var(--x)` compiles and
 * renders as the property's initial value, with no warning from Tailwind,
 * `tsc` or ESLint, so this parser is the only thing that notices.
 */
import { describe, expect, it } from "vitest";
import {
  extractDefinitions,
  extractUses,
  findUndefinedUses,
} from "../scripts/check-css-vars";

describe("extractDefinitions", () => {
  it("reads CSS declarations, including @theme and scoped ones", () => {
    const css = `@theme { --color-ink: #000; }\n.card { --card-pad:4px; padding: var(--card-pad); }`;
    expect(extractDefinitions(css)).toEqual(new Set(["--color-ink", "--card-pad"]));
  });

  it("reads inline style strings and style-object keys", () => {
    const tsx = `style={{ "--cv-rail-w": "40px", ['--bin-track' as string]: t }}\nstyle="--at: 1ms"`;
    expect(extractDefinitions(tsx)).toEqual(new Set(["--cv-rail-w", "--bin-track", "--at"]));
  });

  it("reads runtime setProperty calls", () => {
    expect(extractDefinitions(`el.style.setProperty("--hero-y", y)`)).toEqual(new Set(["--hero-y"]));
  });

  it("does not count a var() reference as a definition", () => {
    expect(extractDefinitions(`.a { color: var(--ink); }`)).toEqual(new Set());
  });
});

describe("extractUses", () => {
  it("reads var() in CSS and in Tailwind arbitrary values", () => {
    const uses = extractUses(`.a { color: var(--ink); }\nclassName="bg-[var(--panel-bg)]"`);
    expect(uses.map((u) => [u.name, u.line])).toEqual([
      ["--ink", 1],
      ["--panel-bg", 2],
    ]);
  });

  it("reads Tailwind v4 shorthand references", () => {
    expect(extractUses(`className="p-(--card-pad) bg-(--panel)"`).map((u) => u.name)).toEqual([
      "--card-pad",
      "--panel",
    ]);
  });

  it("skips uses that carry a fallback", () => {
    expect(extractUses(`width: var(--maybe, 40px); height: var( --maybe-too ,1px)`)).toEqual([]);
  });

  it("marks an interpolated name as a dynamic prefix", () => {
    expect(extractUses("fill: `var(--stock-batch-${tone})`")).toEqual([
      { name: "--stock-batch-", line: 1, dynamic: true },
    ]);
  });
});

describe("findUndefinedUses", () => {
  const defined = new Set(["--ink", "--stock-batch-a"]);

  it("passes defined names, allowlisted library names and matching dynamic prefixes", () => {
    const uses = [
      { name: "--ink", line: 1, dynamic: false },
      { name: "--anchor-width", line: 2, dynamic: false },
      { name: "--tw-ring-color", line: 3, dynamic: false },
      { name: "--stock-batch-", line: 4, dynamic: true },
    ];
    expect(findUndefinedUses(uses, defined)).toEqual([]);
  });

  it("flags an undefined name and a dynamic prefix nothing defines", () => {
    const uses = [
      { name: "--spacing-44", line: 1, dynamic: false },
      { name: "--bin-tone-", line: 2, dynamic: true },
    ];
    expect(findUndefinedUses(uses, defined)).toEqual(uses);
  });
});
