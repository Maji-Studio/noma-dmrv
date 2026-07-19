import type { ElementType } from "react";
import {
  CubeIcon,
  FactoryIcon,
  FlaskIcon,
  LeafIcon,
  MapPinIcon,
  ShoppingCartIcon,
  TruckIcon,
} from "@phosphor-icons/react/dist/ssr";

export const NODE_WIDTH = 260;
// Layout estimate for dagre — sized for the tallest card (feedstock: date +
// code + five label/value rows with a wrapping supplier name), so real cards
// never overlap.
export const NODE_HEIGHT = 232;

export const DAGRE_CONFIG = {
  rankdir: "LR" as const,
  // Vertical breathing room between sibling cards so fan-in/out trunks get
  // their own corridor instead of piling on each other's labels.
  nodesep: 76,
  // Wide enough that edge mass labels sit clear of both ranks' cards.
  ranksep: 208,
};

/** Edge mass labels declutter below this zoom (read the flow, not the kg). */
export const EDGE_LABEL_MIN_ZOOM = 0.62;

/** Fallback edge color when an edge ships without an explicit color. */
export const EDGE_COLOR_FALLBACK = "var(--clr-dark-purple)";

/**
 * Shared graph-canvas chrome (figure/ground per the concept screens): the
 * canvas sits on the --sea plum wash with a quiet dotted grid; the white
 * cards lift off it. Controls/minimap are paper boxes with ink hairlines
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
export const GRAPH_MINIMAP_CLASS =
  "pointer-events-none !rounded-none !border-[1.5px] !border-[var(--ink)] !bg-[var(--paper)] !shadow-none";
export const GRAPH_MINIMAP_MASK = "rgba(15, 2, 26, 0.05)";

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
  icon: ElementType;
  /** Fill accent — left edge, minimap, marker shapes. */
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
    label: "Application",
    icon: MapPinIcon,
    accent: "var(--acc-dist)",
    accentInk: "var(--acc-dist-ink)",
  },
  delivery: {
    label: "Delivery",
    icon: TruckIcon,
    accent: "var(--acc-dist)",
    accentInk: "var(--acc-dist-ink)",
  },
  order: {
    label: "Order",
    icon: ShoppingCartIcon,
    accent: "var(--acc-dist)",
    accentInk: "var(--acc-dist-ink)",
  },
  biocharProduct: {
    label: "Biochar Product",
    icon: CubeIcon,
    accent: "var(--acc-prod)",
    accentInk: "var(--acc-prod-ink)",
  },
  productionRun: {
    label: "Production Run",
    icon: FactoryIcon,
    accent: "var(--acc-prod)",
    accentInk: "var(--acc-prod-ink)",
  },
  reactor: {
    label: "Reactor",
    icon: FlaskIcon,
    accent: "var(--acc-infra)",
    accentInk: "var(--acc-infra-ink)",
  },
  feedstock: {
    label: "Feedstock",
    icon: LeafIcon,
    accent: "var(--acc-prod)",
    accentInk: "var(--acc-prod-ink)",
  },
};

export const STATUS_COLORS: Record<string, string> = {
  applied: "var(--st-ok)",
  delivered: "var(--st-ok)",
  complete: "var(--st-ok)",
  ready: "var(--st-ok)",
  processed: "var(--st-ok)",
  running: "var(--st-run)",
  upcoming: "var(--st-run)",
  ordered: "var(--st-run)",
  pending: "var(--st-wait)",
  scheduled: "var(--st-wait)",
  draft: "var(--st-off)",
  missing_data: "var(--st-off)",
  rejected: "var(--st-bad)",
  void: "var(--st-bad)",
};

export const STATUS_COLOR_FALLBACK = "var(--st-off)";
