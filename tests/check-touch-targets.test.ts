import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findTouchTargetViolations } from "../scripts/check-touch-targets";

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");
const SCRIPT = fileURLToPath(new URL("../scripts/check-touch-targets.ts", import.meta.url));
const SCALE = new Set([0, 16, 24, 32, 40, 44, 48]);
const scan = (source: string, file = "sample.tsx") => findTouchTargetViolations(source, file, SCALE);

describe("touch-target scanner", () => {
  it.each([
    '<button className="h-32" />', '<a className="min-h-24" />',
    '<Link className={`size-[43px] ${extra}`} />',
    '<Button className={cn("h-40", active && "md:size-32")} />',
    '<select className={clsx({ "h-32": small })} />',
    '<input type="checkbox" className="size-16" />',
    '<input type={"radio"} className="h-[18px]" />',
    '<span role="button" className="size-24" />',
    '<div role={"link"} className="h-32" />',
    '<div role="tab" className="!min-h-32" />',
    '<button className="h-32!" />',
  ])("flags explicit small heights: %s", source => {
    expect(scan(source).length).toBeGreaterThan(0);
  });

  it("counts max-* variants (phone-level) and rejects recipes or pseudo areas that only apply from a breakpoint", () => {
    expect(scan('<button className="h-44 max-sm:h-32" />')).toHaveLength(1);
    expect(scan('<a className="h-32 sm:after:h-44" />')).toHaveLength(1);
    expect(scan('<a className={cn("h-32", INLINE_HIT_AREA_FROM_SM)} />')).toHaveLength(1);
    expect(scan('<Link aria-hidden tabIndex={-1} className="h-32" />')).toEqual([]);
    expect(scan('<Link aria-hidden className="h-32" />')).toHaveLength(1);
    expect(scan('<button className="h-44 max-[1024px]:h-32" />')).toHaveLength(1);
    expect(scan('<button className={cn("h-32", ROW_ACTION_HIT_AREA)} />')).toHaveLength(1);
  });

  it.each([
    "sm", "md", "lg", "xl", "2xl",
    "min-sm", "min-md", "min-lg", "min-xl", "min-2xl", "min-[640px]",
    "hover", "disabled", "focus-visible", "sm:hover", "md:max-lg", "[&>button]",
  ])("ignores %s variants while preserving unprefixed hits", variant => {
    expect(scan(`<button className="h-44 ${variant}:h-32 ${variant}:size-[16px] ${variant}:!min-h-0!" />`)).toEqual([]);
    expect(scan(`<Button className={cn("h-40", active && "${variant}:size-32")} />`))
      .toEqual([{ line: 1, tag: "Button", utility: "h-40" }]);
  });

  it("checks base sizes in templates and objects without counting variant sizes", () => {
    expect(scan('<Link className={`md:h-32 ${extra} size-[18px]`} />'))
      .toEqual([{ line: 1, tag: "Link", utility: "size-[18px]" }]);
    expect(scan('<select className={clsx({ "sm:min-h-[36px]": small, "min-h-24": compact })} />'))
      .toEqual([{ line: 1, tag: "select", utility: "min-h-24" }]);
  });

  it("ignores non-controls, glyphs, width, off-scale tokens and Button size props", () => {
    expect(scan([
      '<div className="h-32"><svg className="size-16" /></div>',
      '<input type="text" className="h-32" />', '<Button size="icon" />',
      '<button className="h-44 w-16 [&_svg]:size-16 before:h-16" />',
      '<button className="h-48" />', '<a className="h-33" />',
      '<button className="h-[44px]" />', '// <button className="h-32" />',
    ].join(";\n"))).toEqual([]);
  });

  it.each(["CENTRED_HIT_AREA", "INLINE_HIT_AREA", "PHONE_TOUCH_TARGET"])("accepts %s on the element", recipe => {
    expect(scan(`<button className={cn("h-32", ${recipe})} />`)).toEqual([]);
  });

  it("accepts a spread, merged icon props, pseudo areas and the roster actions slot", () => {
    expect(scan([
      '<Button {...ICON_BUTTON_TOUCH_PROPS} className="h-24" />',
      '<Button className={cn(ICON_BUTTON_TOUCH_PROPS.className, "h-32")} />',
      '<a className="h-24 after:h-44" />', '<button className="h-32 before:min-h-[44px]" />',
      '<div className={ROW_ACTION_HIT_AREA}><Button className="h-32" /></div>',
      '<OrganizationRosterRow actions={<Button className="h-32" />} />',
      '<label className={cn(CENTRED_HIT_AREA, "flex")}><input type="checkbox" className="size-16" /></label>',
    ].join(";\n"))).toEqual([]);
  });

  it("does not let an unrelated ancestor or sibling recipe hide a violation", () => {
    expect(scan('<div className={CENTRED_HIT_AREA}><button className="h-32" /></div>')).toHaveLength(1);
    expect(scan('<div><a className={INLINE_HIT_AREA} /><button className="h-32" /></div>')).toHaveLength(1);
    expect(scan('<button className="h-32"><span className={CENTRED_HIT_AREA} /></button>')).toHaveLength(1);
  });

  it("reports sanctioned glyphs with their reason, without waiving other utilities", () => {
    const file = "src/components/certification/isometric-link.tsx";
    expect(scan('<a className="size-24 h-16" />', file)).toMatchObject([
      { line: 1, utility: "size-24", reason: expect.stringContaining("Sanctioned") },
      { line: 1, utility: "h-16" },
    ]);
    expect(scan('<a className="h-16" />', file)[0].reason).toBeUndefined();
  });
});


describe("touch-target CLI", () => {
  it.each([false, true])("skips test/generated fixtures and fails only uncovered controls: %s", uncovered => {
    const cache = join(process.cwd(), ".cache");
    mkdirSync(cache, { recursive: true });
    const root = mkdtempSync(join(cache, "touch-target-fixture-"));
    try {
      mkdirSync(join(root, "src/app"), { recursive: true });
      mkdirSync(join(root, "src/generated"));
      writeFileSync(join(root, "src/app/globals.css"), ":root { --spacing-32: 32px; --spacing-44: 44px; }");
      writeFileSync(join(root, "src/generated/upstream.tsx"), '<button className="h-32" />');
      writeFileSync(join(root, "src/fixture.test.tsx"), '<button className="h-32" />');
      writeFileSync(join(root, "src/control.tsx"), uncovered ? '<button className="h-32" />' : '<button className="h-44" />');
      const result = spawnSync(process.execPath, [TSX_CLI, SCRIPT], { cwd: root, encoding: "utf8" });
      expect(result.status).toBe(uncovered ? 1 : 0);
      if (uncovered) expect(result.stderr).toContain("src/control.tsx:1");
      else expect(result.stdout).toContain("0 uncovered small heights");
      expect(result.stderr).not.toContain("upstream.tsx");
      expect(result.stderr).not.toContain("fixture.test.tsx");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
