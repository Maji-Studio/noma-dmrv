/**
 * DOM factories for the Carbon Viewer's MapLibre-managed elements — site
 * markers, distance chips, and popup cards. Built with createElement +
 * textContent only (codes, supplier names, and field identifiers are user
 * data — never injected as HTML). Styled by carbon-viewer.css.
 */

import { STATUS_COLOR_FALLBACK, STATUS_COLORS } from "../chain-constants";
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
    input.sub ? `${input.code} — ${input.sub}` : input.code
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

export function createDistanceChipElement(distanceKm: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "cvm-dist";
  el.dataset.testid = "carbon-viewer-distance-chip";
  el.textContent = `${distanceKm} KM`;
  return el;
}

export interface PopupCardInput {
  kind: ViewerMarkerKind;
  /** Mono-uppercase entity type label (e.g. "Feedstock"). */
  typeLabel: string;
  code: string;
  status: string | null;
  detailLines: string[];
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
    pill.style.color = STATUS_COLORS[input.status] ?? STATUS_COLOR_FALLBACK;
    pill.textContent = input.status.replaceAll("_", " ");
    head.appendChild(pill);
  }
  card.appendChild(head);

  const code = document.createElement("div");
  code.className = "cvm-card-code";
  code.textContent = input.code;
  card.appendChild(code);

  if (input.detailLines.length > 0) {
    const details = document.createElement("div");
    details.className = "cvm-card-details";
    for (const line of input.detailLines) {
      const row = document.createElement("div");
      row.className = "cvm-card-line";
      row.textContent = line;
      details.appendChild(row);
    }
    card.appendChild(details);
  }

  return card;
}
