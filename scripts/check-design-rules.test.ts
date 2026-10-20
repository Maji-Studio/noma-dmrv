import { describe, expect, it } from "vitest";
import {
  filterChangedFiles,
  findDesignViolations,
  loadRadiusValues,
  matchClass,
  parseArgs,
  stripVariants,
} from "./check-design-rules";

const RADIUS = loadRadiusValues(`
  --radius-*: initial;
  --radius-2: 2px;
  --radius-4: 4px;
  --radius-8: 8px;
  --radius-12: 12px;
  --radius-full: 9999px;
`);
const COMPONENT_FILE = "src/components/example.tsx";

function scan(source: string, file = COMPONENT_FILE) {
  return findDesignViolations(source, file, RADIUS);
}

describe("design class matcher", () => {
  it("limits declared theme radii to the approved set without restoring deleted defaults", () => {
    expect([...RADIUS]).toEqual(["none", "4", "8", "full"]);
    expect(() => loadRadiusValues("--radius-*: initial;")).toThrow("No approved radius tokens");
    for (const value of RADIUS) {
      for (const side of ["", "t-", "r-", "b-", "l-", "s-", "e-", "tl-", "tr-", "bl-", "br-", "ss-", "se-", "es-", "ee-"]) {
        expect(matchClass(`rounded-${side}${value}`, RADIUS)).toBeNull();
      }
    }
  });

  it.each(["rounded", "rounded-md", "rounded-lg", "rounded-t", "rounded-t-md", "rounded-[6px]", "rounded-[length:var(--radius)]", "rounded-2", "rounded-12", "rounded-t-12", "hover:rounded-br-12", "rounded-48"])("rejects %s", (token) => {
    expect(matchClass(token, RADIUS)).toBe("radius");
  });

  it.each(["shadow", "shadow-sm", "shadow-lg", "shadow-[0_2px_4px_black]", "shadow-(--custom)", "shadow-black/20"])("rejects %s", (token) => {
    expect(matchClass(token, RADIUS)).toBe("shadow");
  });

  it("handles variants, colons inside brackets and both important markers", () => {
    for (const prefix of ["md:", "dark:hover:", "data-[state=open]:", "[&:nth-child(2)]:", "[@supports(display:grid)]:"]) {
      for (const utility of ["!rounded-md", "rounded-md!"]) {
        expect(matchClass(prefix + utility, RADIUS)).toBe("radius");
      }
      expect(matchClass(prefix + "!shadow-none", RADIUS)).toBeNull();
      expect(matchClass(prefix + "!shadow-sm", RADIUS)).toBe("shadow");
    }
    expect(stripVariants("hover:rounded-[length:var(--radius)]!")).toBe("rounded-[length:var(--radius)]");
    expect(matchClass("drop-shadow-sm", RADIUS)).toBeNull();
    expect(matchClass("text-shadow-sm", RADIUS)).toBeNull();
  });

  it("finds classes in JSX, cn, cva, arrays, objects and interpolated templates", () => {
    const source = [
      '<div className="md:rounded-lg shadow-sm" />;',
      'cn("rounded-md", active && "hover:shadow-lg");',
      'cva("rounded", { variants: { shape: { square: "rounded-t-md" } } });',
      'const classes = ["shadow", { "rounded-br-lg": active }];',
      'const template = `rounded-md ${active ? "shadow-sm" : "shadow-none"} md:rounded-[length:var(--r)]`;',
    ].join("\n");
    const hits = scan(source);
    expect(hits.map((hit) => hit.value)).toEqual([
      "md:rounded-lg", "shadow-sm", "rounded-md", "hover:shadow-lg", "rounded", "rounded-t-md",
      "shadow", "rounded-br-lg", "rounded-md", "shadow-sm", "md:rounded-[length:var(--r)]",
    ]);
    expect(hits.map((hit) => hit.line)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5]);
  });

  it("reports one-based lines and columns for classes, buttons and formatting", () => {
    const hits = scan([
      '<div className="rounded-md shadow-sm" />;',
      '  <button />;',
      'date.toLocaleTimeString();',
    ].join("\n"));
    expect(hits.map(({ line, column }) => [line, column])).toEqual([
      [1, 17], [1, 28], [2, 3], [3, 1],
    ]);
  });

  it("skips comments, JSX prose, other JSX attributes and plain copy words", () => {
    expect(scan([
      '// "rounded-md shadow-sm" <button> new Intl.NumberFormat()',
      '/* "rounded-lg" */',
      'const copy = "A rounded shape casts a shadow";',
      '<div title="rounded-md">A rounded shape casts a shadow</div>;',
    ].join("\n"))).toEqual([]);
  });
});

describe("UI scopes", () => {
  it("exempts UI primitives only for raw buttons", () => {
    expect(scan('<button className="rounded-md" />', "src/components/ui/button/index.tsx")
      .map((hit) => hit.rule)).toEqual(["radius"]);
    expect(scan('<button />; <button></button>; <Button />; <buttonish />;')
      .map((hit) => hit.value)).toEqual(["<button", "<button"]);
    expect(scan('<button />', "src/components/ui-lookalike.tsx")).toHaveLength(1);
  });

  it("checks raw buttons in JSX files and exempts JSX primitives", () => {
    expect(scan('<button />; <button></button>; <Button />;', "src/components/example.jsx")
      .map((hit) => hit.value)).toEqual(["<button", "<button"]);
    expect(scan('<button />', "src/components/ui/button/index.jsx")).toEqual([]);
  });

  it("checks date and time APIs in all UI roots, including plain TS helpers", () => {
    const source = [
      'date.toLocaleDateString(); date.toLocaleTimeString();',
      'new Intl.DateTimeFormat(); new Intl.RelativeTimeFormat(); new Intl.DurationFormat();',
      'Intl.DateTimeFormat(); date["toLocaleTimeString"](); Intl["DurationFormat"];',
    ].join("\n");
    for (const file of [COMPONENT_FILE, "src/app/page.tsx", "src/features/report/format.ts"]) {
      expect(scan(source, file)).toHaveLength(8);
    }
    for (const file of ["src/lib/format-utils.ts", "src/lib/date-utils.ts", "src/data-access/report.ts"]) {
      expect(scan(source, file)).toEqual([]);
    }
    expect(scan('const text = "toLocaleDateString new Intl.DateTimeFormat";')).toEqual([]);
    expect(scan("const formatter = Intl.RelativeTimeFormat; const method = date.toLocaleDateString;"))
      .toHaveLength(2);
  });

  it("does not flag ListFormat, number formatting or other non-date formatters", () => {
    expect(scan('new Intl.ListFormat(); Intl["ListFormat"]; new Intl.NumberFormat(); Intl.NumberFormat(); n.toLocaleString(); n["toLocaleString"](); new Intl.FutureFormat();'))
      .toEqual([]);
    expect(scan('new Other.ListFormat(); new Intl.Collator();')).toEqual([]);
  });
});

describe("design review arguments", () => {
  it("defaults to every rule and the full source tree", () => {
    expect(parseArgs([])).toEqual({
      help: false, rules: ["radius", "shadow", "raw-button", "formatting"], files: [],
    });
  });

  it("combines repeated and comma-separated rules without duplicates", () => {
    expect(parseArgs(["--rule", "radius,shadow", "--rule", "formatting,radius"]).rules)
      .toEqual(["radius", "shadow", "formatting"]);
    expect(parseArgs(["--rule", "raw-button"]).rules).toEqual(["raw-button"]);
  });

  it("uses the default changed base or an explicit base", () => {
    expect(parseArgs(["--changed"]).changedBase).toBe("origin/staging");
    expect(parseArgs(["--changed", "review-base"]).changedBase).toBe("review-base");
    expect(parseArgs(["--changed", "--rule", "radius"]).changedBase).toBe("origin/staging");
  });

  it("collects explicit files after options and the option terminator", () => {
    expect(parseArgs(["--rule", "shadow", COMPONENT_FILE, "src/app/page.tsx"]).files)
      .toEqual([COMPONENT_FILE, "src/app/page.tsx"]);
    expect(parseArgs(["--changed", "--", COMPONENT_FILE])).toMatchObject({
      changedBase: "origin/staging", files: [COMPONENT_FILE],
    });
  });

  it("rejects unknown rules with the valid names", () => {
    expect(() => parseArgs(["--rule", "radius,spacing"]))
      .toThrow("Unknown design rule: spacing. Valid names: radius, shadow, raw-button, formatting");
  });

  it("rejects missing rule values and unknown options", () => {
    for (const args of [["--rule"], ["--rule", "--changed"]]) {
      expect(() => parseArgs(args)).toThrow("--rule requires a name");
    }
    expect(() => parseArgs(["--unknown"])).toThrow("Unknown option: --unknown");
  });

  it("recognizes help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});

describe("changed source file filtering", () => {
  it("keeps supported source extensions and excludes non-source, tests and other extensions", () => {
    expect(filterChangedFiles([
      COMPONENT_FILE, "src/app/page.jsx", "src/features/report.ts", "src/lib/helper.js",
      "scripts/example.ts", "src-lookalike/example.tsx", "docs/example.md",
      "src/example.test.ts", "src/example.spec.tsx", "src/example.test.js", "src/example.spec.jsx",
      "src/app/globals.css", "src/data.json", "../src/outside.ts", "src/../../outside.ts",
    ], () => true)).toEqual([
      "src/app/page.jsx", COMPONENT_FILE, "src/features/report.ts", "src/lib/helper.js",
    ]);
  });

  it("excludes non-existent paths even when present in the branch diff", () => {
    expect(filterChangedFiles([COMPONENT_FILE, "src/app/deleted.tsx"], (file) => file === COMPONENT_FILE))
      .toEqual([COMPONENT_FILE]);
  });

  it("normalizes, deduplicates and sorts the union of changed paths", () => {
    expect(filterChangedFiles([COMPONENT_FILE, "./src/app/page.tsx", COMPONENT_FILE, "src/lib/../app/page.tsx"], () => true))
      .toEqual(["src/app/page.tsx", COMPONENT_FILE]);
  });
});
