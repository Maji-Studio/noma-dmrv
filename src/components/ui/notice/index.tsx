/**
 * Notice
 * The one style for in-flow information, warnings and blockers: a Phosphor
 * icon, an optional title, one line of text and an optional action.
 *
 * Only a blocking error is tinted. Every other tone is an icon and text, so a
 * page full of advisories stays quiet and the one thing stopping the user is
 * the only box. Live-region roles follow the tone: `status` announces politely
 * (info, warning, success); `alert` interrupts, so it is reserved for errors.
 */
import type { HTMLAttributes, ReactNode } from "react";
import {
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export type NoticeTone = "info" | "warning" | "error" | "success";

const NOTICE_ICON_SIZE = 16;

const TONES: Record<
  NoticeTone,
  { Icon: Icon; iconClass: string; boxClass: string; role: "status" | "alert" }
> = {
  info: {
    Icon: InfoIcon,
    iconClass: "text-[var(--color-text-tertiary)]",
    boxClass: "",
    role: "status",
  },
  warning: {
    Icon: WarningIcon,
    iconClass: "text-[var(--st-wait)]",
    boxClass: "",
    role: "status",
  },
  success: {
    Icon: CheckCircleIcon,
    iconClass: "text-[var(--st-ok)]",
    boxClass: "",
    role: "status",
  },
  error: {
    Icon: WarningCircleIcon,
    iconClass: "text-[var(--st-bad)]",
    boxClass: "bg-[var(--st-bad-bg)] p-12",
    role: "alert",
  },
};

export interface NoticeProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "role"> {
  tone?: NoticeTone;
  /** Short lead-in in medium weight. Omit when one sentence says it all. */
  title?: ReactNode;
  /** A link or button that resolves the notice, shown after the text. */
  action?: ReactNode;
  /** Override the tone's default live-region role. */
  role?: "status" | "alert";
}

export function Notice({
  tone = "warning",
  title,
  action,
  role,
  className,
  children,
  ...props
}: NoticeProps) {
  const config = TONES[tone];
  const ToneIcon = config.Icon;

  return (
    <div
      role={role ?? config.role}
      data-tone={tone}
      className={cn(
        "flex flex-wrap items-start gap-x-8 gap-y-8",
        config.boxClass,
        className,
      )}
      {...props}
    >
      <ToneIcon
        size={NOTICE_ICON_SIZE}
        weight="fill"
        aria-hidden="true"
        className={cn("mt-2 shrink-0", config.iconClass)}
      />
      <div className="min-w-0 flex-1 basis-[200px] body-small text-[var(--color-text-secondary)]">
        {title != null && (
          <p className="body-small font-medium text-[var(--color-text-primary)]">
            {title}
          </p>
        )}
        {children != null && <div>{children}</div>}
      </div>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  );
}
