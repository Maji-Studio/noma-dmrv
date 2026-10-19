"use client";

/** Small building blocks shared by the credit batch page's header and tabs. */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useCreditBatchPage } from "./credit-batch-page-context";

export const PAGE_PANEL = "border border-[var(--color-border-secondary)] bg-[var(--paper)]";
export const MUTED_TEXT = "text-[var(--color-text-secondary)]";
export const ROW_RULE = "border-t border-[var(--color-border-tertiary)] first:border-t-0";
export const FOCUS_RING = "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ink)]";

/** A framed panel with an optional title row. */
export function PagePanel({
  title,
  titleAddon,
  action,
  children,
  className,
  labelledBy,
}: {
  title?: string;
  titleAddon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Id for the title, so the section is named by it. */
  labelledBy?: string;
}) {
  return (
    <section aria-labelledby={title ? labelledBy : undefined} className={cn(PAGE_PANEL, "flex min-w-0 flex-col gap-16 p-16 sm:p-24", className)}>
      {(title || action) && (
        <div className="flex min-h-40 flex-wrap items-center justify-between gap-12">
          {title && (
            <span className="inline-flex items-center gap-8">
              <h2 id={labelledBy} className="title-heading-3">{title}</h2>
              {titleAddon}
            </span>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** The to-do colors, defined once: Blocking is red, Check is orange. Dots, the tab count and the group headings read from here. */
export const TODO_TONE = { blocking: "bg-[var(--st-bad)]", check: "bg-[var(--st-wait)]" } as const;

/** The 8px status dot: the Open to-dos group headings and the unselected tabs share it. `tone` is a status color token, e.g. `bg-[var(--st-bad)]`. */
export function StatusDot({ tone, label }: { tone: string; label?: string }) {
  return <span className={cn("size-8 shrink-0 rounded-full", tone)} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} />;
}

/** Round count: red when the count blocks, orange when it only needs a check. The selected tab and the data milestone share it. */
export function CountBadge({ count, blocking, label }: { count: number; blocking: boolean; label: string }) {
  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex h-20 min-w-20 items-center justify-center rounded-full px-6 body-caption font-medium tabular-nums",
        blocking ? TODO_TONE.blocking : TODO_TONE.check,
        "text-[var(--paper)]",
      )}
    >
      {count}
    </span>
  );
}

/** A square identity chip, as on the list cards. */
export function IdentityChip({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-6 border border-[var(--clr-dark-purple-20)] bg-[var(--clr-dark-purple-10)] px-8 py-2 body-small text-[var(--clr-dark-purple)]">
      {icon}
      {children}
    </span>
  );
}

const FOCUSED_ROW_CLASS = "bg-[var(--st-wait-bg)] outline outline-1 outline-[var(--st-wait-border)]";

/**
 * Props for a deep-link focus target (`?focus=`): the element id, the
 * highlight, and a ref callback that scrolls it into view once per focus.
 * Context-free, so any row can take it; no effect is needed.
 */
export function focusRowProps(id: string, focused: boolean) {
  return {
    id,
    "data-focused": focused || undefined,
    className: focused ? FOCUSED_ROW_CLASS : undefined,
    ref: (node: HTMLElement | null) => {
      if (!node) return;
      if (!focused) {
        delete node.dataset.scrolled;
      } else if (!node.dataset.scrolled) {
        node.dataset.scrolled = "true";
        node.scrollIntoView({ block: "center" });
      }
    },
  };
}

/** Wraps a row so `?focus=<rowId>` highlights it and scrolls it into view once. */
export function FocusRow({ rowId, className, children, as: Tag = "div" }: { rowId: string; className?: string; children: ReactNode; as?: "div" | "li" }) {
  const { focus } = useCreditBatchPage();
  const props = focusRowProps(`row-${rowId}`, focus === rowId);
  return (
    <Tag {...props} className={cn(className, props.className)}>
      {children}
    </Tag>
  );
}
