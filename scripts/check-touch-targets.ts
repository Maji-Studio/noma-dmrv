/** Check explicit small heights on JSX controls; this is not a layout/a11y audit. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { TOUCH_TARGET_PX } from "../src/components/ui/touch-target";
import { TOUCH_TARGET_ALLOWLIST } from "./touch-target-allowlist";

const ROOT = process.cwd();
const INTERACTIVE_TAGS = new Set(["button", "a", "Link", "Button", "select"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "tab"]);
const HIT_RECIPES = new Set([
  "CENTRED_HIT_AREA", "INLINE_HIT_AREA", "ICON_BUTTON_TOUCH_PROPS", "PHONE_TOUCH_TARGET",
]);
const SMALL_HEIGHT = /^(?:h|size|min-h)-(\d+(?:\.\d+)?|\[\d+(?:\.\d+)?px\])$/;
// Unprefixed only: a breakpoint-gated pseudo area does not exist on a phone.
const PSEUDO_HIT_AREA = new RegExp(`^(?:before|after):(?:h|min-h)-(?:${TOUCH_TARGET_PX}|\\[${TOUCH_TARGET_PX}px\\])!?$`);
/** `max-sm:` and friends apply below a breakpoint, so they are phone-level. */
const MAX_VARIANT = /^max-(?:(?:sm|md|lg|xl|2xl)|\[[^\]]+\]):/;
const TEST_FILE = /\.(?:test|spec)\.tsx?$/;

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
export interface TouchTargetViolation {
  line: number;
  tag: string;
  utility: string;
  reason?: string;
}

/** Literal portions of templates, cn/clsx branches and object keys are all inspectable. */
function literals(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return [node.text];
  const result: string[] = [];
  ts.forEachChild(node, child => { result.push(...literals(child)); });
  return result;
}

function hasRecipe(node: ts.Node, allowed = HIT_RECIPES): boolean {
  if (ts.isIdentifier(node) && allowed.has(node.text)) return true;
  let found = false;
  ts.forEachChild(node, child => { if (hasRecipe(child, allowed)) found = true; });
  return found;
}

function attribute(node: Opening, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find((prop): prop is ts.JsxAttribute =>
    ts.isJsxAttribute(prop) && prop.name.getText() === name);
}

/** `aria-hidden` (bare, true or "true") plus `tabIndex={-1}`: reachable by neither assistive tech nor keyboard. */
function isHiddenDuplicate(node: Opening): boolean {
  const hidden = attribute(node, "aria-hidden");
  const tabIndex = attribute(node, "tabIndex");
  if (!hidden || !tabIndex) return false;
  const hiddenText = hidden.initializer?.getText().replace(/[{}"'\s]/g, "") ?? "true";
  return (hiddenText === "true" || hiddenText === "") && tabIndex.initializer?.getText().replace(/[{}\s]/g, "") === "-1";
}

function coveredBySlot(node: Opening): boolean {
  // ROW_ACTION_HIT_AREA targets descendant buttons; do not treat an unrelated
  // ancestor's CENTRED_HIT_AREA as covering all its children.
  if (node.tagName.getText() === "input") {
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === "label") {
        const classes = attribute(parent.openingElement, "className");
        return !!classes && hasRecipe(classes);
      }
    }
    return false;
  }
  if (node.tagName.getText() !== "button" && node.tagName.getText() !== "Button") return false;
  const rowRecipe = new Set(["ROW_ACTION_HIT_AREA"]);
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && parent.openingElement !== node) {
      const classes = attribute(parent.openingElement, "className");
      if (classes && hasRecipe(classes, rowRecipe)) return true;
    }
    if (ts.isJsxAttribute(parent) && parent.name.getText() === "actions") {
      const owner = parent.parent.parent;
      if ((ts.isJsxOpeningElement(owner) || ts.isJsxSelfClosingElement(owner))
        && owner.tagName.getText() === "OrganizationRosterRow") return true;
    }
  }
  return false;
}

export function findTouchTargetViolations(
  source: string,
  fileName: string,
  spacingScale: ReadonlySet<number>,
): TouchTargetViolation[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: TouchTargetViolation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      const role = attribute(node, "role");
      const type = attribute(node, "type");
      const interactive = INTERACTIVE_TAGS.has(tag)
        || (role && literals(role).some(value => INTERACTIVE_ROLES.has(value)))
        || (tag === "input" && type && literals(type).some(value => value === "checkbox" || value === "radio"));
      const classes = attribute(node, "className");
      // A hidden duplicate (aria-hidden and tabIndex -1) is not a touch target.
      const hidden = isHiddenDuplicate(node);
      if (interactive && classes && !hidden) {
        const tokens = literals(classes).flatMap(value => value.split(/\s+/));
        if (!hasRecipe(node.attributes) && !coveredBySlot(node)
          && !tokens.some(token => PSEUDO_HIT_AREA.test(token))) {
          const smallTokens = new Set(tokens.filter(token => {
            // Only unprefixed phone-level sizes count; all variants are out of scope.
            const match = SMALL_HEIGHT.exec(token.replace(MAX_VARIANT, "").replace(/^!|!$/g, ""));
            if (!match) return false;
            const value = Number(match[1].replace(/^\[|px\]$/g, ""));
            return value < TOUCH_TARGET_PX && (match[1].startsWith("[") || spacingScale.has(value));
          }));
          for (const utility of smallTokens) {
            const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
            const waiver = TOUCH_TARGET_ALLOWLIST.find(entry => entry.file === fileName
              && entry.tag === tag && entry.utility === utility);
            violations.push({ line: line + 1, tag, utility, ...(waiver ? { reason: waiver.reason } : {}) });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return ["generated", "__tests__", "tests"].includes(entry.name) ? [] : sourceFiles(path);
    return /\.tsx$/.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}

function main(): void {
  if (TOUCH_TARGET_ALLOWLIST.some(entry => !entry.reason.trim())) {
    throw new Error("Every touch-target exception needs a reason.");
  }
  const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
  const scale = new Set([...css.matchAll(/--spacing-(\d+):\s*(\d+)px/g)]
    .filter(match => match[1] === match[2]).map(match => Number(match[1])));
  if (!scale.size) throw new Error("No px-named spacing tokens found in globals.css.");
  let failures = 0;
  let allowlisted = 0;
  for (const path of sourceFiles(join(ROOT, "src"))) {
    const file = relative(ROOT, path);
    for (const hit of findTouchTargetViolations(readFileSync(path, "utf8"), file, scale)) {
      if (hit.reason) { allowlisted++; continue; }
      failures++;
      console.error(`${file}:${hit.line} <${hit.tag}> ${hit.utility}: add a shared touch-target recipe or a reasoned allowlist entry.`);
    }
  }
  console.log(`check:touch-targets: ${failures} uncovered small heights; ${allowlisted} allowlisted.`);
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
