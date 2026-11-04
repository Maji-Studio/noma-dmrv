/**
 * What a reader of a rendered form sees, collected from a react-test-renderer
 * tree: field labels, section titles and inputs in order, plus the visible text.
 * Hidden and aria-hidden subtrees are skipped.
 */
import type { ReactTestInstance } from "react-test-renderer";
import { FormField } from "@/components/forms/form-field";
import { FormSection } from "@/components/forms/form-section";

export type RenderInventory = { items: string[]; text: string };

function isSkipped(node: ReactTestInstance): boolean {
  if (typeof node.type !== "string") return false;
  const props = node.props;
  return Boolean(props.hidden) || props["aria-hidden"] === true || props["aria-hidden"] === "true";
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  if (isSkipped(node)) return "";
  return node.children.map(textOf).join(" ");
}

export function inventory(root: ReactTestInstance): RenderInventory {
  const items: string[] = [];
  const walk = (node: ReactTestInstance | string) => {
    if (typeof node === "string" || isSkipped(node)) return;
    const { props, type } = node;
    if (type === FormSection) items.push(`section:${props.title ?? "(untitled)"}`);
    if (type === FormField) items.push(`field:${props.label}`);
    if (type === "input" || type === "select" || type === "textarea") items.push(`input:${props.id ?? props.name ?? props["aria-label"] ?? type}`);
    node.children.forEach(walk);
  };
  walk(root);
  return { items, text: textOf(root).replace(/\s+/g, " ").trim() };
}
