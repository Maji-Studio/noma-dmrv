/** PROTOTYPE. Evidence glyph shared by the `?leg=` variants. Not for merge. */
"use client";

import { FileDashedIcon, FileTextIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

const ICON_PX = 16;

export function EvidenceMark({
  attached,
  withLabel = false,
}: {
  attached: boolean | undefined;
  withLabel?: boolean;
}) {
  if (attached === undefined) return null;
  const label = attached ? "Evidence attached" : "No evidence";
  const Glyph = attached ? FileTextIcon : FileDashedIcon;
  return (
    <span
      role={withLabel ? undefined : "img"}
      aria-label={withLabel ? undefined : label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-4",
        attached ? "text-[var(--st-ok)]" : "text-[var(--color-text-tertiary)]",
      )}
    >
      <Glyph size={ICON_PX} weight={attached ? "fill" : "regular"} aria-hidden />
      {withLabel && <span className="body-caption">{label}</span>}
    </span>
  );
}
