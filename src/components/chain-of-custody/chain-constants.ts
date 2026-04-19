import type { ElementType } from "react";
import {
  Cube,
  Factory,
  Flask,
  Leaf,
  MapPin,
  ShoppingCart,
  Truck,
} from "@phosphor-icons/react/dist/ssr";

export const NODE_WIDTH = 260;
export const NODE_HEIGHT = 168;

export const DAGRE_CONFIG = {
  rankdir: "LR" as const,
  nodesep: 48,
  ranksep: 120,
};

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
  accent: string;
}

export const LINEAGE_NODE_STYLES: Record<LineageNodeKind, LineageNodeStyle> = {
  application: {
    label: "Application",
    icon: MapPin,
    accent: "var(--clr-rose)",
  },
  delivery: {
    label: "Delivery",
    icon: Truck,
    accent: "var(--clr-rose)",
  },
  order: {
    label: "Order",
    icon: ShoppingCart,
    accent: "var(--clr-rose)",
  },
  biocharProduct: {
    label: "Biochar Product",
    icon: Cube,
    accent: "var(--clr-orange)",
  },
  productionRun: {
    label: "Production Run",
    icon: Factory,
    accent: "var(--clr-orange)",
  },
  reactor: {
    label: "Reactor",
    icon: Flask,
    accent: "var(--clr-purple)",
  },
  feedstock: {
    label: "Feedstock",
    icon: Leaf,
    accent: "var(--clr-orange)",
  },
};

export const STATUS_COLORS: Record<string, string> = {
  applied: "var(--color-status-success)",
  delivered: "var(--color-status-success)",
  complete: "var(--color-status-success)",
  ready: "var(--color-status-success)",
  processed: "var(--color-status-success)",
  running: "var(--clr-purple)",
  upcoming: "var(--clr-purple)",
  ordered: "var(--clr-purple)",
  pending: "var(--color-signal-orange)",
  scheduled: "var(--color-signal-orange)",
  draft: "var(--color-text-tertiary)",
  missing_data: "var(--color-text-tertiary)",
  rejected: "var(--color-signal-red)",
  void: "var(--color-signal-red)",
};

export const STATUS_COLOR_FALLBACK = "var(--color-text-tertiary)";
