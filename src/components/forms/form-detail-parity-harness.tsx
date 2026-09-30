/**
 * Test harness for the detail level parity guards (`form-detail-parity*.test.tsx`).
 * Renders a surface at Simple, then at Detailed, and collects what a reader
 * sees: field labels, section and block titles, inputs, actions, links and the
 * visible text. Explanation blocks (`DETAIL_EXPLANATION_ATTR`), hidden and
 * aria-hidden subtrees are skipped, since only those may differ.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ReactElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { DetailField, DetailSection } from "@/components/ui/detail-panel";
import { CompositionCard } from "./composition-card";
import { DETAIL_EXPLANATION_ATTR, FormDetailControl, FormDetailProvider } from "./form-detail-context";
import { FormField } from "./form-field";
import { FormSection } from "./form-section";

export type ParityInventory = { items: string[]; text: string };

/** `src/`, the root the coverage checks scan. */
const SRC = join(__dirname, "..", "..");

/** Every non-test TypeScript source under `src/`, path relative to it. */
export function sourceFiles(): { path: string; text: string }[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter(file => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map(file => ({ path: relative(SRC, join(SRC, file)), text: readFileSync(join(SRC, file), "utf8") }));
}

/** A host node Simple and Detailed may legitimately differ on. */
function isSkipped(node: ReactTestInstance): boolean {
  if (typeof node.type !== "string") return false;
  const props = node.props;
  return Boolean(props.hidden) || Boolean(props[DETAIL_EXPLANATION_ATTR]) || props["aria-hidden"] === true || props["aria-hidden"] === "true";
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  if (isSkipped(node)) return "";
  return node.children.map(textOf).join(" ");
}

const clean = (value: string) => value.replace(/\s+/g, " ").trim();

/** What the parity check compares: labels, titles, inputs, actions and links, in order, plus the visible text. */
export function inventory(root: ReactTestInstance): ParityInventory {
  const items: string[] = [];
  const walk = (node: ReactTestInstance | string) => {
    if (typeof node === "string" || isSkipped(node)) return;
    const { props, type } = node;
    if (type === DetailField) {
      items.push(`field:${props.label}`);
      if (props.secondary) items.push(`field:${props.secondary.label}`);
    }
    if (type === DetailSection || type === FormSection) items.push(`section:${props.title}`);
    if (type === CompositionCard) items.push(`block:${props.title}`);
    if (type === FormField) items.push(`field:${props.label}`);
    if (type === "button") items.push(`action:${props["aria-label"] ?? clean(textOf(node))}`);
    if (type === "a") items.push(`link:${props.href}:${clean(textOf(node))}`);
    if (type === "input" || type === "select" || type === "textarea") items.push(`input:${props.id ?? props.name ?? props["aria-label"] ?? type}`);
    if (typeof type === "string" && /^h[1-6]$|^legend$|^label$|^dt$/.test(type)) items.push(`${type}:${clean(textOf(node))}`);
    node.children.forEach(walk);
  };
  walk(root);
  return { items, text: clean(textOf(root)) };
}

/** Renders `element` at Simple, then at Detailed, and returns both inventories. */
export async function renderBothLevels(element: ReactElement): Promise<{ simple: ParityInventory; detailed: ParityInventory; detailedJson: string }> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<FormDetailProvider scope="parity"><FormDetailControl /><div data-parity-subject>{element}</div></FormDetailProvider>);
  });
  const subject = () => renderer.root.find(node => node.props["data-parity-subject"] === true);
  const simple = inventory(subject());
  await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
  const detailed = inventory(subject());
  const detailedJson = JSON.stringify(renderer.toJSON());
  await act(async () => renderer.unmount());
  return { simple, detailed, detailedJson };
}

