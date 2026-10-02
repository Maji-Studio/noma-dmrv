/**
 * DOM factories for the Carbon Viewer's MapLibre-managed elements — site
 * markers, distance chips, and popup cards. Built with createElement +
 * textContent only (codes, supplier names, and field identifiers are user
 * data — never injected as HTML). Styled by carbon-viewer.css, imported here
 * so every surface that builds these elements gets their styles.
 */

import "./carbon-viewer.css";
import { formatLegDistanceCompactKm, formatLegDistanceKm } from "@/lib/format-utils";
import { STATUS_STATE_BADGE_CLASSES, getStatusState } from "@/lib/status-state";
import { statusLabels } from "@/components/ui/status-badge";
import { toBadgeProps } from "../chain-status-badge";
import type { LineageDetailRow } from "../use-chain-graph";
import type { ViewerMarkerKind } from "./viewer-constants";

export interface SiteMarkerInput {
  /** Chain node id (`kind:entityId`) — carried for cross-linking. */
  nodeId: string;
  kind: ViewerMarkerKind;
  code: string;
  sub: string | null;
}

export function createSiteMarkerElement(input: SiteMarkerInput): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `cvm-mk cvm-mk--${input.kind}`;
  el.dataset.nodeId = input.nodeId;
  el.dataset.testid = "carbon-viewer-marker";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute(
    "aria-label",
    input.sub ? `${input.code}: ${input.sub}` : input.code
  );

  const ring = document.createElement("div");
  ring.className = "cvm-ring";
  el.appendChild(ring);

  const shape = document.createElement("div");
  shape.className = "cvm-shape";
  el.appendChild(shape);

  const label = document.createElement("div");
  label.className = "cvm-lbl";
  const code = document.createElement("span");
  code.className = "cvm-lbl-code";
  code.textContent = input.code;
  label.appendChild(code);
  if (input.sub) {
    const sub = document.createElement("span");
    sub.className = "cvm-lbl-sub";
    sub.textContent = input.sub;
    label.appendChild(sub);
  }
  el.appendChild(label);

  return el;
}

export function createDistanceChipElement(distanceKm: number | null | undefined): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "cvm-dist";
  el.dataset.testid = "carbon-viewer-distance-chip";
  el.textContent = formatLegDistanceCompactKm(distanceKm);
  el.setAttribute("aria-label", formatLegDistanceKm(distanceKm));
  return el;
}

export interface PopupCardInput {
  kind: ViewerMarkerKind;
  /** Mono-uppercase entity type label (e.g. "Feedstock"). */
  typeLabel: string;
  code: string;
  status: string | null;
  /** Label/value rows — same grammar as the lineage cards. */
  details: LineageDetailRow[];
}

export function createPopupCardElement(input: PopupCardInput): HTMLDivElement {
  const card = document.createElement("div");
  card.className = `cvm-card cvm-card--${input.kind}`;
  card.dataset.testid = "carbon-viewer-popup";

  const head = document.createElement("div");
  head.className = "cvm-card-head";
  const type = document.createElement("span");
  type.className = "cvm-card-type";
  type.textContent = input.typeLabel;
  head.appendChild(type);
  if (input.status) {
    const pill = document.createElement("span");
    pill.className = "cvm-card-pill";
    const badge = toBadgeProps(input.status);
    const state = getStatusState(badge.status);
    // Same classes and label vocabulary as the StatusBadge in the panels.
    pill.className = `cvm-card-pill ${STATUS_STATE_BADGE_CLASSES[state]}`;
    pill.dataset.statusState = state;
    pill.textContent = badge.label ?? statusLabels[badge.status];
    head.appendChild(pill);
  }
  card.appendChild(head);

  const code = document.createElement("div");
  code.className = "cvm-card-code";
  code.textContent = input.code;
  card.appendChild(code);

  if (input.details.length > 0) {
    const details = document.createElement("div");
    details.className = "cvm-card-details";
    for (const entry of input.details) {
      const row = document.createElement("div");
      row.className = "cvm-card-dr";
      const label = document.createElement("span");
      label.className = "cvm-card-dl";
      label.textContent = entry.label;
      row.appendChild(label);
      const value = document.createElement("span");
      value.className = "cvm-card-dv";
      value.textContent = entry.value;
      row.appendChild(value);
      details.appendChild(row);
    }
    card.appendChild(details);
  }

  return card;
}
