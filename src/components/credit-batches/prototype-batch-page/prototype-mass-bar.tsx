"use client";

/**
 * PROTOTYPE (throwaway): the stacked mass bar shared by the Overview and the Removals tab.
 * One group per Removal (coloured by its status, split into its applications), then the two
 * open parts: applied but not in a Removal, and not applied yet.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useProto } from "./prototype-context";
import type { MassSegmentKey, RemovalRef } from "./prototype-model";
import { RemovalChip, tonnes } from "./prototype-parts";

const MUTED = "text-[var(--color-text-secondary)]";
const HATCH = "repeating-linear-gradient(135deg, var(--st-off-border) 0 2px, transparent 2px 6px)";
const MIN_SEGMENT_PX = 6;

/** Quiet meaning colours: submitted strongest, draft the same hue lighter, attention for the actionable part, grey for the rest. */
export const SEGMENTS: { key: MassSegmentKey; label: string; fill: string; background?: string }[] = [
  { key: "sent", label: "In submitted Removals", fill: "var(--st-run)" },
  { key: "inRemoval", label: "In draft Removals", fill: "color-mix(in srgb, var(--st-run) 40%, var(--paper))" },
  { key: "notIn", label: "Applied, not in a Removal", fill: "var(--st-wait)" },
  { key: "notApplied", label: "Not applied yet", fill: "var(--st-off-bg)", background: HATCH },
];
export const SEGMENT_BY_KEY = Object.fromEntries(SEGMENTS.map((segment, index) => [segment.key, { ...segment, order: index }])) as Record<
  MassSegmentKey,
  (typeof SEGMENTS)[number] & { order: number }
>;

export function segmentOfRemoval(removal: { status: string } | null): MassSegmentKey {
  if (!removal) return "notIn";
  return removal.status === "draft" ? "inRemoval" : "sent";
}

export function Swatch({ segment, className }: { segment: MassSegmentKey; className?: string }) {
  const { fill, background } = SEGMENT_BY_KEY[segment];
  return <span aria-hidden className={cn("inline-block size-12 shrink-0 border border-[var(--st-off-border)]", className)} style={{ backgroundColor: fill, backgroundImage: background }} />;
}

interface Part { id: string; label: string; tons: number }
interface Group {
  id: string;
  segment: MassSegmentKey;
  /** Short name on the bar and in the legend. */
  name: string;
  removal: RemovalRef | null;
  tons: number;
  parts: Part[];
}

function useGroups(): Group[] {
  const { model } = useProto();
  const groups: Group[] = [];
  for (const removal of model.removals) {
    const slices = model.slices.filter((slice) => slice.removal?.code === removal.code);
    groups.push({
      id: removal.code,
      segment: segmentOfRemoval(removal),
      name: removal.code,
      removal,
      tons: slices.reduce((sum, slice) => sum + slice.tons, 0),
      parts: slices.map((slice) => ({ id: slice.id, label: slice.label, tons: slice.tons })),
    });
  }
  groups.sort((a, b) => SEGMENT_BY_KEY[a.segment].order - SEGMENT_BY_KEY[b.segment].order);
  const open = model.slices.filter((slice) => !slice.removal);
  if (model.masses.notIn > 0) {
    groups.push({ id: "notIn", segment: "notIn", name: "Not in a Removal", removal: null, tons: model.masses.notIn, parts: open.map((slice) => ({ id: slice.id, label: slice.label, tons: slice.tons })) });
  }
  if (model.masses.notApplied > 0) {
    groups.push({ id: "notApplied", segment: "notApplied", name: "Not applied yet", removal: null, tons: model.masses.notApplied, parts: [{ id: "notApplied", label: "Not applied yet", tons: model.masses.notApplied }] });
  }
  return groups;
}

export function RemovalMassBar({ onOpenRemoval }: { onOpenRemoval?: (code: string) => void }) {
  const groups = useGroups();
  const [active, setActive] = useState<{ text: string; center: number } | null>(null);
  const total = groups.reduce((sum, group) => sum + group.tons, 0);
  if (groups.length === 0) return null;
  const firstOpen = groups.findIndex((group) => group.removal == null);
  return (
    <div className="flex flex-col gap-12">
      <div className="relative">
        <div className="flex gap-4">
          {groups.map((group) => {
            const start = groups.slice(0, groups.indexOf(group)).reduce((sum, g) => sum + g.tons, 0);
            const seg = SEGMENT_BY_KEY[group.segment];
            return (
              <div key={group.id} className="flex min-w-0 flex-col gap-4" style={{ flexGrow: group.tons, flexBasis: 0, minWidth: MIN_SEGMENT_PX }}>
                <span className={cn("truncate body-caption", group.removal ? "text-[var(--color-text-primary)]" : MUTED)}>
                  {group.removal ? `${group.name} ${tonnes(group.tons)}` : ""}
                </span>
                <div className="flex h-24 gap-2 bg-[var(--paper)]">
                  {group.parts.map((part, index) => {
                    const before = group.parts.slice(0, index).reduce((sum, p) => sum + p.tons, 0);
                    const center = ((start + before + part.tons / 2) / total) * 100;
                    const text = group.removal ? `${group.name}: ${part.label}, ${tonnes(part.tons)}` : `${part.label}, ${tonnes(part.tons)}`;
                    return (
                      <span
                        key={part.id}
                        role="img"
                        tabIndex={0}
                        aria-label={text}
                        onMouseEnter={() => setActive({ text, center })}
                        onMouseLeave={() => setActive(null)}
                        onFocus={() => setActive({ text, center })}
                        onBlur={() => setActive(null)}
                        className="h-full border border-[var(--st-off-border)] outline-offset-2"
                        style={{ flexGrow: part.tons, flexBasis: 0, minWidth: 2, backgroundColor: seg.fill, backgroundImage: seg.background }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {active && (
          <span
            aria-hidden
            className={cn("pointer-events-none absolute top-full z-10 mt-4 max-w-full border border-[var(--color-border-secondary)] bg-[var(--paper)] px-8 py-4 body-caption", active.center > 50 ? "right-0 text-right" : "left-0")}
          >
            {active.text}
          </span>
        )}
      </div>
      <ul className="flex flex-col">
        {groups.map((group, index) => {
          const open = group.removal == null;
          const row = (
            <>
              <Swatch segment={group.segment} />
              {group.removal ? <RemovalChip removal={group.removal} /> : <span className="body-small font-medium">{group.name === "Not in a Removal" ? "Applied, not in a Removal" : group.name}</span>}
              <span className="body-medium tabular-nums">{tonnes(group.tons)}</span>
            </>
          );
          const rowClass = "grid w-full grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-12 py-8 text-left";
          return (
            <li key={group.id} className={cn(index === firstOpen && index > 0 && "mt-4 border-t border-[var(--color-border-secondary)] pt-4", open && "bg-transparent")}>
              {group.removal && onOpenRemoval ? (
                <button type="button" onClick={() => onOpenRemoval(group.id)} className={cn(rowClass, "hover:bg-[var(--color-surface-medium)]")}>{row}</button>
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
