import type { CSSProperties } from "react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const TILE_PX = 28;
const TILE_ICON_PX = 15;

/** Left inset of a row's text and values, so they line up under the tile. */
export const TILE_TEXT_INSET_PX = TILE_PX + 12;

/**
 * A kind's accent square with its icon: the stage list and the chain walk read
 * as siblings of the Flow chart. `ghost` outlines it for stages or steps that
 * are not the current one.
 */
export function TraceTile({
  icon: IconComponent,
  accent,
  accentInk,
  ghost,
}: {
  icon: Icon;
  accent: string;
  accentInk: string;
  ghost?: boolean;
}) {
  return (
    <span
      className={cn("tm-tile relative z-10", ghost && "tm-tile--ghost")}
      style={{ "--tm-acc": accent, "--tm-acc-ink": accentInk, width: TILE_PX, height: TILE_PX } as CSSProperties}
      aria-hidden
    >
      <IconComponent size={TILE_ICON_PX} weight="bold" />
    </span>
  );
}

/** The thread between two tiles in a list. */
export function TraceThread({ dark }: { dark?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("absolute bottom-0 w-px", dark ? "bg-[var(--ink)]" : "bg-[var(--clr-dark-purple-20)]")}
      style={{ left: TILE_PX / 2, top: TILE_PX + 8 }}
    />
  );
}

/** The Button's focus ring, for the raw row buttons of the stage list and the chain walk. */
export const ROW_FOCUS_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-primary)]";

const SCROLL_MARGIN_PX = 8;

/**
 * Ref for a marker that appears with the open stage or current step: scrolls
 * the list around it (and only it, never the page) so the row sits at the top.
 */
const scrollListToMarker = (element: HTMLElement | null) => {
  const list = element?.closest("ol");
  if (!element || !list) return;
  const offset = element.getBoundingClientRect().top - list.getBoundingClientRect().top;
  list.scrollTo({ top: list.scrollTop + offset - SCROLL_MARGIN_PX, behavior: "smooth" });
};

/** Place inside a list row's `relative` item, rendered only while the row is open or current. */
export function ScrollTarget() {
  return <span ref={scrollListToMarker} data-scroll-target aria-hidden className="absolute inset-x-0 top-0 h-0" />;
}
