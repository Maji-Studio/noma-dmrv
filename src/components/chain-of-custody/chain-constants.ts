/**
 * Chain of Custody — static DAG configuration
 * Node definitions, edge definitions, status color mapping, and layout constants.
 */
import type { ElementType } from "react";
import {
  Flask,
  Package,
  Leaf,
  Grains,
  Factory,
  Cube,
  ShoppingCart,
  Truck,
  MapPin,
  Certificate,
  UserCircle,
} from "@phosphor-icons/react/dist/ssr";

// ============================================
// Layout
// ============================================

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 160;

export const DAGRE_CONFIG = {
  rankdir: "LR" as const,
  nodesep: 60,
  ranksep: 140,
};

// ============================================
// Node definitions
// ============================================

export interface ChainNodeDef {
  id: string;
  label: string;
  icon: ElementType;
  accent: string;
  href: string | null;
}

export const CHAIN_NODE_DEFS: ChainNodeDef[] = [
  { id: "reactors", label: "Reactors", icon: Flask, accent: "var(--clr-purple)", href: "/reactors" },
  // Storage locations split by type
  { id: "feedstockBin", label: "Feedstock Bin", icon: Package, accent: "var(--clr-purple)", href: "/storage-locations" },
  { id: "biocharBin", label: "Biochar Bin", icon: Package, accent: "var(--clr-purple)", href: "/storage-locations" },
  { id: "productBin", label: "Product Bin", icon: Package, accent: "var(--clr-purple)", href: "/storage-locations" },
  // Chain-of-custody flow
  { id: "suppliers", label: "Suppliers", icon: UserCircle, accent: "var(--clr-purple)", href: "/suppliers" },
  { id: "feedstockDeliveries", label: "Feedstock Deliveries", icon: Leaf, accent: "var(--clr-orange)", href: "/feedstock-deliveries" },
  { id: "feedstocks", label: "Feedstocks", icon: Grains, accent: "var(--clr-orange)", href: "/feedstocks" },
  { id: "productionRuns", label: "Production Runs", icon: Factory, accent: "var(--clr-orange)", href: "/production-runs" },
  { id: "samples", label: "Samples", icon: Flask, accent: "var(--clr-orange)", href: null },
  { id: "biocharProducts", label: "Biochar Products", icon: Cube, accent: "var(--clr-orange)", href: "/biochar-products" },
  { id: "orders", label: "Orders", icon: ShoppingCart, accent: "var(--clr-rose)", href: "/orders" },
  { id: "deliveries", label: "Deliveries", icon: Truck, accent: "var(--clr-rose)", href: "/deliveries" },
  { id: "applications", label: "Applications", icon: MapPin, accent: "var(--clr-rose)", href: "/applications" },
  { id: "creditBatches", label: "Credit Batches", icon: Certificate, accent: "var(--clr-pink)", href: "/credit-batches" },
];

// ============================================
// Edge definitions (source → target)
// ============================================

export interface ChainEdgeDef {
  source: string;
  target: string;
}

export const CHAIN_EDGE_DEFS: ChainEdgeDef[] = [
  // Feedstock intake
  { source: "suppliers", target: "feedstockDeliveries" },
  { source: "feedstockDeliveries", target: "feedstocks" },
  { source: "feedstocks", target: "feedstockBin" },
  // Production
  { source: "feedstockBin", target: "productionRuns" },
  { source: "reactors", target: "productionRuns" },
  { source: "productionRuns", target: "samples" },
  // Post-production storage
  { source: "productionRuns", target: "biocharBin" },
  { source: "biocharBin", target: "biocharProducts" },
  // Product storage & distribution
  { source: "biocharProducts", target: "productBin" },
  { source: "productBin", target: "orders" },
  { source: "orders", target: "deliveries" },
  { source: "deliveries", target: "applications" },
  { source: "applications", target: "creditBatches" },
];

// ============================================
// Status → color mapping
// ============================================

/**
 * Maps status strings to CSS color tokens for the status bar segments.
 * Mirrors the categories from StatusBadge.
 */
export const STATUS_COLORS: Record<string, string> = {
  // Success / terminal
  complete: "var(--color-status-success)",
  ready: "var(--color-status-success)",
  delivered: "var(--color-status-success)",
  applied: "var(--color-status-success)",
  verified: "var(--color-status-success)",
  issued: "var(--color-status-success)",
  processed: "var(--color-status-success)",
  sold: "var(--color-status-success)",

  // In-progress
  running: "var(--clr-purple)",
  processing: "var(--clr-purple)",
  ordered: "var(--clr-purple)",

  // Pending / warning
  pending: "var(--color-signal-orange)",
  scheduled: "var(--color-signal-orange)",
  testing: "var(--color-signal-orange)",

  // Not started
  draft: "var(--color-text-tertiary)",
  missing_data: "var(--color-text-tertiary)",

  // Problem
  void: "var(--clr-red)",
  rejected: "var(--clr-red)",
};

/** Fallback for unknown statuses */
export const STATUS_COLOR_FALLBACK = "var(--color-text-tertiary)";

/** Statuses considered "in progress" — used to animate edges */
export const IN_PROGRESS_STATUSES = new Set(["running", "upcoming"]);
