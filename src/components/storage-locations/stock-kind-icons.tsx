import type { ComponentProps, ComponentType } from "react";
import {
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowsLeftRightIcon,
  ArrowsMergeIcon,
  ArrowsSplitIcon,
  ArrowUpIcon,
  DropIcon,
  MinusCircleIcon,
  PencilSimpleIcon,
  ScalesIcon,
} from "@phosphor-icons/react/dist/ssr";

/** One icon per kind of stock movement, shared by every history list. Decorative: the kind title says it. */
const STOCK_KIND_ICONS: Record<string, ComponentType<ComponentProps<typeof ScalesIcon>>> = {
  delivery: ArrowDownIcon,
  production_draw: ArrowUpIcon,
  product_draw: ArrowUpIcon,
  loss: MinusCircleIcon,
  count: ScalesIcon,
  reversal: ArrowCounterClockwiseIcon,
  replacement: PencilSimpleIcon,
  moisture_update: DropIcon,
  merge: ArrowsMergeIcon,
  split: ArrowsSplitIcon,
};

export function StockKindIcon({ kind, ...props }: { kind: string } & ComponentProps<typeof ScalesIcon>) {
  const Glyph = STOCK_KIND_ICONS[kind] ?? ArrowsLeftRightIcon;
  return <Glyph aria-hidden="true" {...props} />;
}
