"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";

interface ActionableFocusTargetProps {
  target: EntityFocusTarget;
  activeTarget?: string | null;
  children: ReactNode;
  actionLabel?: string;
  className?: string;
}

/**
 * Reusable landing target for actionable entity deep links. It owns both the
 * imperative scroll/focus sync and the visible callout, so pages do not query
 * or manipulate feature-specific DOM selectors.
 */
export function ActionableFocusTarget({
  target,
  activeTarget,
  children,
  actionLabel = "Action required from the dashboard attention item",
  className,
}: ActionableFocusTargetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const active = activeTarget === target;

  useEffect(() => {
    if (!active || !ref.current) return;
    ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    ref.current.focus({ preventScroll: true });
  }, [active]);

  return (
    <div
      ref={ref}
      tabIndex={active ? -1 : undefined}
      className={cn(
        active &&
          "border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] p-12 outline-none",
        className,
      )}
      data-focus-target={target}
    >
      {active && (
        <p className="label-micro mb-10 text-[var(--st-wait)]" role="status">
          {actionLabel}
        </p>
      )}
      {children}
    </div>
  );
}
