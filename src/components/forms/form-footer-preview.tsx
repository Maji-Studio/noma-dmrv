/**
 * FormFooterPreview
 * One quiet line in the sticky form footer, directly above Save, that says
 * what saving will associate the record with (the credit batch a run joins,
 * #1164). A `Notice` whose info tone leads with the subject's own icon,
 * because its ⓘ sits in the line and a second info glyph would read as noise.
 *
 * A status region: assistive tech hears the line when it changes, and
 * `aria-busy` while a check runs. Never a Save blocker.
 */
"use client";

import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { Notice } from "@/components/ui/notice";
import { InfoHint } from "@/components/ui/tooltip";

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
  icon,
  tone = "neutral",
  children,
  info,
  action,
  busy = false,
}: FormFooterPreviewProps) {
  return (
    <Notice
      tone={tone === "warning" ? "warning" : "info"}
      infoIcon={icon}
      action={action}
      aria-busy={busy || undefined}
      data-form-footer-preview=""
    >
      {children}
      {info && (
        <>
          {" "}
          <InfoHint label={info.label} className="-my-4">
            {info.content}
          </InfoHint>
        </>
      )}
    </Notice>
  );
}
