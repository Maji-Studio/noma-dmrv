/**
 * MassFlowSankey — where a mass goes, drawn as bands whose thickness is
 * kilograms. Nodes are the stops (a bin, a reactor, a product), segments the
 * kinds of mass a stop holds, bands the mass moving between stops, and exits
 * the mass leaving the process (water driven off, conversion loss). A node
 * can name its own parts beside it, as a product does with what it is made
 * of.
 *
 * It speaks the moisture split's visual language so the two read as one idea:
 * dry matter is the plum solid, water the hatched void, added water purple,
 * ingredient solids their entity accent. Bands are the same colours lighter,
 * so a node always reads as the thing and a band as the movement.
 *
 * The SVG carries only shapes and is hidden from assistive technology; every
 * name and figure is HTML text over it, so labels stay 14px and 12px at any
 * width and read in order. Where a label crosses a band, a halo in the paper
 * colour keeps it legible without boxing it. Geometry comes from
 * `layoutMassFlow` at the measured container width.
 */
"use client";

import { useId, useState, useSyncExternalStore } from "react";
import {
  layoutMassFlow,
  NODE_WIDTH_PX,
  type MeasureText,
  type LaidOutBand,
  type LaidOutLabel,
  type LaidOutSegment,
  type MassFlowDiagram,
  type MassFlowKind,
} from "./mass-flow-layout";

/** Width drawn before the first measurement: the form column on a desktop sheet. */
const INITIAL_WIDTH_PX = 560;
const HATCH_TILE_PX = 6;
const HATCH_LINE_PX = 1.5;
/** Paper-coloured halo, so text crossing a band stays legible. */
const LABEL_HALO = "[text-shadow:0_0_2px_var(--paper),0_0_2px_var(--paper),0_0_4px_var(--paper)]";
/** How much of a solid node colour a band keeps. */
const BAND_OPACITY = 0.3;

const SEGMENT_FILLS: Record<MassFlowKind, string> = {
  dry: "var(--clr-dark-purple-80)",
  process: "var(--clr-dark-purple-100)",
  wet: "var(--clr-dark-purple-40)",
  solids: "var(--clr-dark-purple-40)",
  addedWater: "var(--color-moisture-added-water)",
  released: "var(--clr-dark-purple-100)",
  water: "",
};

const BAND_FILLS: Record<MassFlowKind, string> = {
  dry: "var(--clr-dark-purple-20)",
  process: "var(--clr-dark-purple-10)",
  wet: "var(--clr-dark-purple-10)",
  solids: "var(--clr-dark-purple-20)",
  addedWater: "var(--color-moisture-added-water)",
  released: "var(--clr-dark-purple-10)",
  water: "",
};

const LINE_FONTS = { large: "500 14px", small: "400 12px" } as const;
let measureContext: CanvasRenderingContext2D | null | undefined;

/**
 * Measures label lines in the page's own font, so labels step apart only when
 * they really collide. Null on the server and in environments without canvas,
 * where the layout falls back to its estimate.
 */
function textMeasurer(): MeasureText | undefined {
  if (typeof document === "undefined") return undefined;
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement("canvas").getContext("2d");
    } catch {
      measureContext = null;
    }
  }
  const context = measureContext;
  if (!context) return undefined;
  const family = getComputedStyle(document.body).fontFamily;
  return (text, size) => {
    context.font = `${LINE_FONTS[size]} ${family}`;
    return context.measureText(text).width;
  };
}

const subscribeNever = () => () => {};

/** Track the element's content width. Keeps the last width while it is hidden. */
function useMeasuredWidth(): [number, (element: HTMLDivElement | null) => (() => void) | undefined] {
  const [width, setWidth] = useState(INITIAL_WIDTH_PX);
  const measure = (element: HTMLDivElement | null) => {
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  };
  return [width, measure];
}

function Segment({ x, segment, hatch }: { x: number; segment: LaidOutSegment; hatch: string }) {
  if (segment.h <= 0) return null;
  if (segment.kind === "water") {
    return (
      <rect
        x={x + 0.5}
        y={segment.y + 0.5}
        width={NODE_WIDTH_PX - 1}
        height={Math.max(0, segment.h - 1)}
        fill={`url(#${hatch})`}
        stroke="var(--clr-dark-purple-20)"
      />
    );
  }
  return <rect x={x} y={segment.y} width={NODE_WIDTH_PX} height={segment.h} fill={segment.fill ?? SEGMENT_FILLS[segment.kind]} />;
}

function Band({ band, hatch, maskId }: { band: LaidOutBand; hatch: string; maskId: string | undefined }) {
  const mask = maskId ? `url(#${maskId})` : undefined;
  if (band.kind === "water") {
    return (
      <g mask={mask}>
        <path d={band.path} fill="var(--clr-dark-purple-5)" />
        <path d={band.path} fill={`url(#${hatch})`} />
      </g>
    );
  }
  const solid = band.fill !== undefined || band.kind === "addedWater";
  return (
    <path
      d={band.path}
      fill={band.fill ?? BAND_FILLS[band.kind]}
      fillOpacity={solid ? BAND_OPACITY : undefined}
      mask={mask}
    />
  );
}

function Label({ label }: { label: LaidOutLabel }) {
  const position = label.align === "left" ? { left: label.x } : { right: `calc(100% - ${label.x}px)` };
  return (
    <div
      className={`absolute flex flex-col gap-2 ${LABEL_HALO} ${label.align === "left" ? "text-left" : "text-right"}`}
      style={{ ...position, top: label.y, maxWidth: label.maxWidth }}
    >
      {label.figure ? (
        <>
          <span className="truncate body-caption text-[var(--color-text-secondary)]">{label.name}</span>
          {label.caption && <span className="truncate body-small font-medium tabular-nums">{label.caption}</span>}
        </>
      ) : (
        <>
          <span className={`truncate body-small font-medium ${label.placeholder ? "text-[var(--color-text-tertiary)]" : ""}`}>
            {label.name}
          </span>
          {label.caption && (
            <span className="truncate body-caption tabular-nums text-[var(--color-text-secondary)]">{label.caption}</span>
          )}
        </>
      )}
    </div>
  );
}

export function MassFlowSankey({ diagram, className = "" }: { diagram: MassFlowDiagram; className?: string }) {
  const [width, measure] = useMeasuredWidth();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // Measure only after hydration, so the first client render matches the
  // server's estimated layout.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const layout = layoutMassFlow(diagram, width, hydrated ? textMeasurer() : undefined);
  if (!layout) return null;
  const hatch = `${id}-hatch`;

  return (
    <div ref={measure} data-mass-flow className={`relative w-full ${className}`} style={{ height: layout.height }}>
      <svg
        aria-hidden="true"
        focusable="false"
        className="absolute inset-0 overflow-visible"
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        <defs>
          <pattern id={hatch} width={HATCH_TILE_PX} height={HATCH_TILE_PX} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={HATCH_LINE_PX} height={HATCH_TILE_PX} fill="var(--clr-dark-purple-20)" />
          </pattern>
          {layout.bands.map((band) =>
            band.fade ? (
              <g key={band.key}>
                <linearGradient id={`${id}-${band.key}-fade`} gradientUnits="userSpaceOnUse" x1={band.fade.x0} x2={band.fade.x1} y1="0" y2="0">
                  <stop offset="0" stopColor="white" stopOpacity="1" />
                  <stop offset="1" stopColor="white" stopOpacity="0.1" />
                </linearGradient>
                <mask id={`${id}-${band.key}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width={layout.width} height={layout.height}>
                  <rect x="0" y="0" width={layout.width} height={layout.height} fill={`url(#${id}-${band.key}-fade)`} />
                </mask>
              </g>
            ) : null,
          )}
        </defs>
        {layout.bands.map((band) => (
          <Band key={band.key} band={band} hatch={hatch} maskId={band.fade ? `${id}-${band.key}-mask` : undefined} />
        ))}
        {layout.leaders.map((leader) => (
          <line
            key={leader.key}
            x1={leader.x1}
            y1={leader.y1}
            x2={leader.x2}
            y2={leader.y2}
            stroke="var(--clr-dark-purple-30)"
            strokeWidth={1}
          />
        ))}
        {layout.nodes.map((node) => (
          <g key={node.id}>
            {node.segments.map((segment) => (
              <Segment key={segment.id} x={node.x} segment={segment} hatch={hatch} />
            ))}
          </g>
        ))}
      </svg>
      {layout.labels.map((label) => (
        <Label key={label.key} label={label} />
      ))}
    </div>
  );
}
