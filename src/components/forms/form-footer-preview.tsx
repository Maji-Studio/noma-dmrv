/**
 * FormFooterPreview
 * One quiet line in the sticky form footer, directly above Save, that says
 * what saving will associate the record with (the credit batch a run joins,
 * #1164). It reads like a `Notice` (icon, one line of secondary text, an
 * optional action) but leads with the subject's own icon, because its ⓘ sits
 * in the line and a second info glyph beside it would read as noise.
 *
 * A status region: assistive tech hears the line when it changes, and
 * `aria-busy` while a check runs. Never a Save blocker.
 */
"use client";

import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { InfoHint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const ICON_SIZE = 16;

export interface FormFooterPreviewProps {
  /** The subject's icon (e.g. the credit batch icon), shown in the neutral tone. */
  icon: Icon;
  /** `warning` when the association the operator may expect will not happen. */
  tone?: "neutral" | "warning";
  /** The line itself: text and inline links. */
  children: ReactNode;
  /** The ⓘ explanation; plain text, no links. */
  info?: { label: string; content: ReactNode } | null;
  /** A control that resolves the line, such as Retry. */
  action?: ReactNode;
  /** A check is running; the line says so in words too. */
  busy?: boolean;
}

export function FormFooterPreview({
  icon: SubjectIcon,
  tone = "neutral",
  children,
  info,
  action,
  busy = false,
}: FormFooterPreviewProps) {
  const LeadIcon = tone === "warning" ? WarningIcon : SubjectIcon;
  return (
    <div
      role="status"
      aria-busy={busy || undefined}
      data-tone={tone}
      data-form-footer-preview=""
      // A Retry button is taller than one text line: centre the row on it.
      className={cn("flex gap-x-8", action == null ? "items-start" : "items-center")}
    >
      <LeadIcon
        size={ICON_SIZE}
        weight={tone === "warning" ? "fill" : "bold"}
        aria-hidden="true"
        className={cn(
          "shrink-0",
          action == null && "mt-2",
          tone === "warning" ? "text-[var(--st-wait)]" : "text-[var(--color-text-tertiary)]",
        )}
      />
      <p className="min-w-0 flex-1 body-small text-[var(--color-text-secondary)]">
        {children}
        {info && (
          <>
            {" "}
            <InfoHint label={info.label} className="-my-4">
              {info.content}
            </InfoHint>
          </>
        )}
      </p>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}
