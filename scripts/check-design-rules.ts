/** Mechanical UI rules from docs/design-system.md. Comments are ignored by the TS parser. */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = process.cwd();
const SOURCE_DIR = "src";
const THEME_FILE = "src/app/globals.css";
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const TEST_FILE = /\.(?:test|spec)\.[jt]sx?$/;
const UI_DIRS = ["src/components/", "src/app/", "src/features/"];
const PRIMITIVES_DIR = "src/components/ui/";
// These own shared formatting, rather than consuming it. Neither is currently in UI_DIRS.
const FORMAT_HELPERS = new Set(["src/lib/format-utils.ts", "src/lib/date-utils.ts"]);
const LOCALE_METHODS = new Set(["toLocaleDateString", "toLocaleTimeString"]);
const INTL_FORMATTERS = new Set(["DateTimeFormat", "RelativeTimeFormat", "DurationFormat"]);
const ALLOWED_RADIUS_VALUES = new Set(["none", "full", "4", "8"]);
const RADIUS_SIDES = "(?:[trblse]|tl|tr|bl|br|ss|se|es|ee)";
const RULES = ["radius", "shadow", "raw-button", "formatting"] as const;
type Rule = (typeof RULES)[number];
interface Exception {
  file: string;
  rule: Rule;
  value: string;
  count: number;
  reason: string;
}
// Exact utility/API plus occurrence budget: an exempt file cannot accumulate new hits.
const ALLOWLIST: readonly Exception[] = [
  {
    file: "src/app/(auth)/accept-invitation/[id]/page.tsx",
    rule: "shadow",
    value: "shadow-sm",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/app/(auth)/forgot-password/page.tsx",
    rule: "shadow",
    value: "shadow-sm",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/app/(auth)/login/page.tsx",
    rule: "shadow",
    value: "shadow-sm",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/app/(auth)/reset-password/page.tsx",
    rule: "shadow",
    value: "shadow-sm",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/app/(auth)/set-password/page.tsx",
    rule: "shadow",
    value: "shadow-sm",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/components/chain-of-custody/sankey/batch-sankey.tsx",
    rule: "shadow",
    value: "shadow-[0_2px_12px_rgba(20,8,38,0.10)]",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/components/forms/position-picker/address-search.tsx",
    rule: "shadow",
    value: "shadow-[0_4px_16px_var(--color-black-10)]",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/components/map/map-controls.tsx",
    rule: "shadow",
    value: "shadow-[0_1px_4px_var(--color-black-10)]",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/components/navigation/facility-selector.tsx",
    rule: "shadow",
    value: "shadow-[0_8px_24px_rgba(0,0,0,0.35)]",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/components/navigation/mobile-nav.tsx",
    rule: "shadow",
    value: "shadow-[-8px_0_32px_rgba(0,0,0,0.4)]",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/components/navigation/org-brand.tsx",
    rule: "shadow",
    value: "shadow-[0_8px_24px_rgba(0,0,0,0.35)]",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/components/ui/toast/index.tsx",
    rule: "shadow",
    value: "shadow-[0_4px_16px_var(--color-black-10)]",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/components/ui/tooltip/index.tsx",
    rule: "shadow",
    value: "shadow-[0_4px_16px_var(--color-black-10)]",
    count: 1,
    reason: "renders a shadow today; removal is a visual change pending review",
  },
  {
    file: "src/components/certification/durability-tier-select.tsx",
    rule: "radius",
    value: "rounded-[2px]",
    count: 1,
    reason: "legacy arbitrary radius listed in docs/design-system.md; swapping to the token breaks tailwind-merge overrides",
  },
  {
    file: "src/components/customers/customer-saved-locations.tsx",
    rule: "radius",
    value: "rounded-[4px]",
    count: 1,
    reason: "legacy arbitrary radius listed in docs/design-system.md; swapping to the token breaks tailwind-merge overrides",
  },
  {
    file: "src/components/ui/accordion/index.tsx",
    rule: "radius",
    value: "rounded-[8px]",
    count: 1,
    reason: "legacy arbitrary radius listed in docs/design-system.md; swapping to the token breaks tailwind-merge overrides",
  },
  {
    file: "src/components/ui/card/index.tsx",
    rule: "radius",
    value: "rounded-[8px]",
    count: 2,
    reason: "legacy arbitrary radius listed in docs/design-system.md; swapping to the token breaks tailwind-merge overrides",
  },
  {
    file: "src/components/ui/notice/index.tsx",
    rule: "radius",
    value: "rounded-[8px]",
    count: 1,
    reason: "legacy arbitrary radius listed in docs/design-system.md; swapping to the token breaks tailwind-merge overrides",
  },
  {
    file: "src/components/forms/choice-card-group.tsx",
    rule: "shadow",
    value: "peer-checked:shadow-[inset_0_0_0_1px_var(--color-interaction)]",
    count: 1,
    reason: "Inset shadow reinforces the checked state; replacing it needs selection-state design review.",
  },
  {
    file: "src/components/forms/segmented-control.tsx",
    rule: "shadow",
    value: "peer-checked:shadow-[inset_0_0_0_1px_var(--color-interaction)]",
    count: 1,
    reason: "Inset shadow reinforces the checked state; replacing it needs selection-state design review.",
  },
  {
    file: "src/components/certification/certification-status-badge.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/certification/durability-readiness.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/certification/durability-tier-select.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/certification/entity-certify-readiness-badge.tsx",
    rule: "raw-button",
    value: "<button",
    count: 2,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/chain-of-custody/batch-picker.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/chain-of-custody/map/custody-stages-rail.tsx",
    rule: "raw-button",
    value: "<button",
    count: 3,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/chain-of-custody/map/record-detail-panel.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/chain-of-custody/map/viewer-rails.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/chain-of-custody/run-picker.tsx",
    rule: "raw-button",
    value: "<button",
    count: 2,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/chain-of-custody/traceability-header.tsx",
    rule: "raw-button",
    value: "<button",
    count: 2,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/credit-batches/credit-batch-card.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Card action deliberately avoids the Button primitive to preserve card layout; migration needs review.",
  },
  {
    file: "src/components/credit-batches/credit-batch-health-strip.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/dashboard/flow-hero.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/dashboard/range-toggle.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/energy/energy-record-list.tsx",
    rule: "raw-button",
    value: "<button",
    count: 3,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/feedstock-types/feedstock-type-form.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/feedstock-types/isometric-feedstock-browser.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/forms/form-file-upload.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/navigation/facility-selector.tsx",
    rule: "raw-button",
    value: "<button",
    count: 3,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/navigation/org-brand.tsx",
    rule: "raw-button",
    value: "<button",
    count: 2,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/navigation/sidebar-content.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/orders/matching-output-bins.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/schema/schema-table-view.tsx",
    rule: "raw-button",
    value: "<button",
    count: 2,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/storage-locations/loss-reason-chips.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/storage-locations/storage-bin-board.tsx",
    rule: "raw-button",
    value: "<button",
    count: 1,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
  {
    file: "src/components/storage-locations/storage-bin-tile.tsx",
    rule: "raw-button",
    value: "<button",
    count: 2,
    reason: "Existing custom control requires a Button migration; preserve its layout and interaction in this mechanical change.",
  },
];

export interface Violation {
  rule: Rule;
  file: string;
  line: number;
  value: string;
}

/** No shared walker/reporter exists in the sibling checks; follow their recursive walk pattern. */
function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path);
    return !TEST_FILE.test(entry.name) && EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

/** Allow only approved theme radii, plus the built-in none utility. */
export function loadRadiusValues(css: string): Set<string> {
  const values = new Set(["none"]);
  for (const match of css.matchAll(/--radius-([\w-]+)\s*:\s*([^;]+);/g)) {
    if (ALLOWED_RADIUS_VALUES.has(match[1]) && match[2].trim() !== "initial") values.add(match[1]);
  }
  if (values.size === 1) throw new Error(`No approved radius tokens found in ${THEME_FILE}. Update the check.`);
  return values;
}

/** Colons inside arbitrary variants/values are not variant separators. */
export function stripVariants(token: string): string {
  let depth = 0;
  let start = 0;
  let escaped = false;
  for (let index = 0; index < token.length; index++) {
    const character = token[index];
    if (escaped) { escaped = false; continue; }
    if (character === "\\") { escaped = true; continue; }
    if (character === "[" || character === "(") depth++;
    if (character === "]" || character === ")") depth--;
    if (character === ":" && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!/, "").replace(/!$/, "");
}

export function matchClass(token: string, radiusValues: ReadonlySet<string>): Rule | null {
  const bare = stripVariants(token);
  if (bare === "rounded" || bare.startsWith("rounded-")) {
    const value = bare.replace(new RegExp(`^rounded-(?:${RADIUS_SIDES}-)?`), "");
    return radiusValues.has(value) ? null : "radius";
  }
  // New code uses hairlines for elevation and only shadow-none is allowed.
  // Existing rendered shadows require visual review before removal; see ALLOWLIST.
  if (bare === "shadow" || (bare.startsWith("shadow-") && bare !== "shadow-none")) return "shadow";
  return null;
}

function isClassContext(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) return parent.name.getText() === "className";
    if (ts.isCallExpression(parent) && /^(?:cn|cva|clsx)$/.test(parent.expression.getText())) return true;
    if (ts.isVariableDeclaration(parent) && /class|style|variant/i.test(parent.name.getText())) return true;
  }
  return false;
}

/** Parse literals, including every static segment of interpolated templates, maps and arrays. */
export function findDesignViolations(source: string, file: string, radiusValues: ReadonlySet<string>): Violation[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];
  const inUI = UI_DIRS.some((directory) => file.startsWith(directory)) && !FORMAT_HELPERS.has(file);
  const report = (node: ts.Node, rule: Rule, value: string, position = node.getStart(sourceFile)): void => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(position);
    violations.push({ rule, file, line: line + 1, value });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const context = isClassContext(node);
      const attribute = ts.isJsxAttribute(node.parent) ? node.parent : undefined;
      if (!attribute || context) {
        for (const match of node.text.matchAll(/\S+/g)) {
          const token = match[0];
          const bare = stripVariants(token);
          // Ordinary copy uses the words "rounded" and "shadow" too.
          if ((bare === "rounded" || bare === "shadow") && !context && node.text.trim() !== token) continue;
          const rule = matchClass(token, radiusValues);
          if (rule) report(node, rule, token, node.getStart(sourceFile) + 1 + match.index);
        }
      }
    }
    if (/\.[jt]sx$/.test(file) && !file.startsWith(PRIMITIVES_DIR) &&
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === "button") {
      report(node, "raw-button", "<button");
    }
    if (inUI && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text
        : ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : undefined;
      if (name && LOCALE_METHODS.has(name)) {
        report(node, "formatting", name);
      } else if (name && INTL_FORMATTERS.has(name) && node.expression.getText() === "Intl") {
        report(node, "formatting", `Intl.${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

export function applyAllowlist(violations: readonly Violation[], allowlist: readonly Exception[]): Violation[] {
  const remaining = [...violations];
  for (const exception of allowlist) {
    let budget = exception.count;
    for (let index = 0; index < remaining.length && budget > 0;) {
      const violation = remaining[index];
      if (violation.file === exception.file && violation.rule === exception.rule && violation.value === exception.value) {
        remaining.splice(index, 1);
        budget--;
      } else index++;
    }
    if (budget > 0) {
      throw new Error(`Stale allowlist entry: ${exception.file} (${exception.rule}: ${exception.value}) has ${exception.count - budget} occurrence(s), below pinned count ${exception.count}. Lower the count or delete this entry.`);
    }
  }
  return remaining;
}

function main(): void {
  const requested = process.argv[2];
  if (requested && !RULES.includes(requested as Rule)) throw new Error(`Unknown design rule: ${requested}`);
  const selected = requested ? [requested as Rule] : RULES;
  const radiusValues = loadRadiusValues(readFileSync(join(ROOT, THEME_FILE), "utf8"));
  const violations = walkFiles(join(ROOT, SOURCE_DIR)).flatMap((path) =>
    findDesignViolations(readFileSync(path, "utf8"), relative(ROOT, path), radiusValues));
  const remaining = applyAllowlist(violations, ALLOWLIST);
  for (const rule of selected) {
    const hits = remaining.filter((hit) => hit.rule === rule);
    const exempt = violations.filter((hit) => hit.rule === rule).length - hits.length;
    console.log(`check:${rule}: ${hits.length} violation(s), ${exempt} allowlisted occurrence(s).`);
    for (const hit of hits) console.error(`  ${hit.file}:${hit.line}  ${hit.value}`);
    if (hits.length) process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
