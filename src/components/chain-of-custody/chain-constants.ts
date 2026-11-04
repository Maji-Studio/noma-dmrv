import type { Icon } from "@phosphor-icons/react";
import {
  CubeIcon,
  FactoryIcon,
  FlaskIcon,
  LeafIcon,
  MapPinIcon,
  ShoppingCartIcon,
  TruckIcon,
} from "@phosphor-icons/react/dist/ssr";

/**
 * Flow chart geometry (graph coordinates, px at zoom 1). Records sit in fixed
 * columns by kind, in chain order; each record is a small square with its code
 * underneath, like the buyer journey graph.
 */
export const FLOW_NODE_SIZE = 28;
/** The node box is wider than the square so the code label fits under it. */
export const FLOW_NODE_BOX_WIDTH = 112;
/** Square plus the label line under it. */
export const FLOW_NODE_BOX_HEIGHT = 48;
export const FLOW_COLUMN_PITCH = 208;
export const FLOW_ROW_PITCH = 64;
/** Column headers sit this far above the topmost record. */
/** Title, count and a 44px "Collapse" button must fit above the first row. */
export const FLOW_HEADER_GAP = 104;
export const FLOW_HEADER_WIDTH = 168;
export const FLOW_HEADER_HEIGHT = 88;
/**
 * A column with more records than this collapses into one stacked group
 * node. Clicking the group lists every record again.
 */
export const FLOW_GROUP_THRESHOLD = 12;
export const FLOW_ICON_SIZE = 16;
/** Inferred links (feedstock intakes behind a run): edge and legend. */
export const FLOW_INFERRED_DASHARRAY = "4 4";
/** Zoom bounds; the low end lets a wide batch fit a phone screen. */
export const FLOW_MIN_ZOOM = 0.2;
export const FLOW_MAX_ZOOM = 2.5;
export const FLOW_FIT_PADDING = 0.12;
/**
 * Below this canvas width (a phone) fitting every column would shrink the
 * codes past reading, so the chart opens at a readable zoom from its first
 * column and its header instead, and the operator pans or pinches for the
 * rest.
 */
export const FLOW_NARROW_CANVAS_PX = 640;
/** Zoom 1 keeps every node's 48px hit box at least 44px on screen. */
export const FLOW_NARROW_ZOOM = 1;
export const FLOW_NARROW_INSET_PX = 16;

/**
 * Shared graph-canvas chrome (figure/ground per the concept screens): the
 * canvas sits on the --sea plum wash with a quiet dotted grid; the white
 * records lift off it. Controls are paper boxes with ink hairlines
 * that invert on hover.
 */
export const GRAPH_CANVAS_CLASS = "!bg-[var(--sea)]";
export const GRAPH_DOTS = {
  gap: 28,
  size: 1.5,
  color: "var(--clr-dark-purple-10)",
} as const;
export const GRAPH_CONTROLS_CLASS =
  "!rounded-none !border-[1.5px] !border-[var(--ink)] !bg-[var(--paper)] !shadow-none " +
  "[&>button]:!rounded-none [&>button]:!border-b [&>button]:!border-[var(--clr-dark-purple-10)] " +
  "[&>button]:!bg-transparent [&>button:last-child]:!border-b-0 " +
  "[&>button:hover]:!bg-[var(--ink)] [&>button:hover>svg]:!fill-[var(--paper)]";

export type LineageNodeKind =
  | "application"
  | "delivery"
  | "order"
  | "biocharProduct"
  | "productionRun"
  | "reactor"
  | "feedstock";

export interface LineageNodeStyle {
  label: string;
  /** Plural for a collapsed group ("34 feedstocks"). */
  plural: string;
  icon: Icon;
  /** Fill accent: node square, marker shapes. */
  accent: string;
  /** Ink variant of the accent — text-on-light always passes contrast. */
  accentInk: string;
}

/**
 * Accent triad (Phase 0 tokens): Production (orange) / Infrastructure
 * (purple) / Distribution (pink) — each with its ink variant for text.
 */
export const LINEAGE_NODE_STYLES: Record<LineageNodeKind, LineageNodeStyle> = {
  application: {
    plural: "applications",
    label: "Application",
    icon: MapPinIcon,
    accent: "var(--acc-dist)",
    accentInk: "var(--acc-dist-ink)",
  },
  delivery: {
    plural: "deliveries",
    label: "Delivery",
    icon: TruckIcon,
    accent: "var(--acc-dist)",
    accentInk: "var(--acc-dist-ink)",
  },
  order: {
    plural: "orders",
    label: "Order",
    icon: ShoppingCartIcon,
    accent: "var(--acc-dist)",
    accentInk: "var(--acc-dist-ink)",
  },
  biocharProduct: {
    plural: "products",
    label: "Biochar product",
    icon: CubeIcon,
    accent: "var(--acc-prod)",
    accentInk: "var(--acc-prod-ink)",
  },
  productionRun: {
    plural: "runs",
    label: "Production run",
    icon: FactoryIcon,
    accent: "var(--acc-prod)",
    accentInk: "var(--acc-prod-ink)",
  },
  reactor: {
    plural: "reactors",
    label: "Reactor",
    icon: FlaskIcon,
    accent: "var(--acc-infra)",
    accentInk: "var(--acc-infra-ink)",
  },
  feedstock: {
    plural: "feedstocks",
    label: "Feedstock",
    icon: LeafIcon,
    accent: "var(--acc-prod)",
    accentInk: "var(--acc-prod-ink)",
  },
};

/**
 * Flow chart columns, in chain order. The reactor is equipment, not a mass
 * step, so it sits above the runs it served instead of in the flow's path.
 */
export const FLOW_COLUMNS: readonly LineageNodeKind[] = [
  "feedstock",
  "reactor",
  "productionRun",
  "biocharProduct",
  "order",
  "delivery",
  "application",
];
export const FLOW_EQUIPMENT_KINDS: ReadonlySet<LineageNodeKind> = new Set(["reactor"]);
