import { describe, expect, it } from "vitest";
import {
  applyAllowlist,
  findDesignViolations,
  loadRadiusValues,
  matchClass,
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

  it("skips comments, JSX prose, other JSX attributes and plain copy words", () => {
    expect(scan([
      '// "rounded-md shadow-sm" <button> new Intl.NumberFormat()',
      '/* "rounded-lg" */',
      'const copy = "A rounded shape casts a shadow";',
      '<div title="rounded-md">A rounded shape casts a shadow</div>;',
    ].join("\n"))).toEqual([]);
  });
});

describe("UI scopes and exception budgets", () => {
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

  it.each([0, 1])("rejects stale allowlist budgets with %i remaining occurrences", (count) => {
    const hits = scan('date.toLocaleDateString();'.repeat(count));
    const exceptions = [{ file: COMPONENT_FILE, rule: "formatting" as const, value: "toLocaleDateString", count: 2, reason: "Existing date formatting." }];
    expect(() => applyAllowlist(hits, exceptions)).toThrow(
      `Stale allowlist entry: ${COMPONENT_FILE} (formatting: toLocaleDateString) has ${count} occurrence(s), below pinned count 2. Lower the count or delete this entry.`,
    );
  });

  it("does not let an exempt file accumulate extra occurrences or another API", () => {
    const hits = scan('date.toLocaleDateString(); other.toLocaleDateString(); date.toLocaleTimeString();');
    const exceptions = [{ file: COMPONENT_FILE, rule: "formatting" as const, value: "toLocaleDateString", count: 1, reason: "Existing date formatting." }];
    expect(applyAllowlist(hits, exceptions).map((hit) => hit.value)).toEqual(["toLocaleDateString", "toLocaleTimeString"]);
    expect(applyAllowlist(scan('date.toLocaleDateString();'), exceptions)).toEqual([]);
    expect(() => applyAllowlist(scan('date.toLocaleDateString();', "src/components/other.tsx"), exceptions))
      .toThrow("has 0 occurrence(s), below pinned count 1. Lower the count or delete this entry.");
  });
});
