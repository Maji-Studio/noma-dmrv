/**
 * StatCard — the one KPI card (visual design plan, Phase 2).
 *
 * White paper panel on the warm page field with a hairline border — the style
 * the Energy summary cards pioneered, now canonical. Optional sparkline slot
 * so the same card can build the dashboard KPI strip (Phase 5).
 *
 * Moved here from `src/components/dashboard/stat-card.tsx`.
 */
"use client";

import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { TrendUpIcon, TrendDownIcon, MinusIcon } from "@phosphor-icons/react";

/* -------------------------------------------------------------------------------------------------
 * StatCard Variants
 * -----------------------------------------------------------------------------------------------*/

const statCardVariants = cva(
  // Shared panel recipe (Phase 2.5) — paper + plum hairline, candidate
  // treatments swap via the --panel-* tokens.
  "group flex flex-col overflow-hidden bg-[var(--panel-bg)] [border:var(--panel-border)] [box-shadow:var(--panel-shadow)] transition-colors duration-300",
  {
    variants: {
      interactive: {
        true: "cursor-pointer hover:[border-color:var(--edge-soft)]",
        false: "",
      },
    },
    defaultVariants: {
      interactive: false,
    },
  }
);

const trendBadgeVariants = cva(
  "inline-flex items-center gap-4 body-caption-fit font-medium px-6 py-2",
  {
    variants: {
      trend: {
        up: "bg-[var(--st-ok-bg)] text-[var(--st-ok)]",
        down: "bg-[var(--st-bad-bg)] text-[var(--st-bad)]",
        neutral: "bg-[var(--color-background-medium)] text-[var(--color-text-secondary)]",
      },
    },
    defaultVariants: {
      trend: "neutral",
    },
  }
);

/* -------------------------------------------------------------------------------------------------
 * StatCard Types
 * -----------------------------------------------------------------------------------------------*/

export type TrendDirection = "up" | "down" | "neutral";

export interface StatCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statCardVariants> {
  /** The title/label for the stat */
  title: string;
  /** The main value to display */
  value: string | number;
  /** Optional description text */
  description?: string;
  /** Optional icon to display */
  icon?: React.ReactNode;
  /** Trend direction indicator */
  trend?: TrendDirection;
  /** Trend value (e.g., "+12%", "-5") */
  trendValue?: string;
  /** Trend label (e.g., "from last month") */
  trendLabel?: string;
  /** Optional sparkline slot rendered under the value row (dashboard KPI strip) */
  sparkline?: React.ReactNode;
  /** Link destination for click-through navigation */
  href?: string;
  /** Loading state */
  isLoading?: boolean;
}

/* -------------------------------------------------------------------------------------------------
 * TrendBadge Component
 * -----------------------------------------------------------------------------------------------*/

interface TrendBadgeProps {
  trend: TrendDirection;
  value?: string;
  label?: string;
}

const TrendBadge = ({ trend, value, label }: TrendBadgeProps) => {
  const TrendIcon = trend === "up" ? TrendUpIcon : trend === "down" ? TrendDownIcon : MinusIcon;

  return (
    <div className="flex items-center gap-8">
      <span className={cn(trendBadgeVariants({ trend }))}>
        <TrendIcon size={12} weight="bold" />
        {value && <span>{value}</span>}
      </span>
      {label && (
        <span className="body-caption text-[var(--color-text-tertiary)]">{label}</span>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------------------------------
 * StatCard Skeleton for Loading State
 * -----------------------------------------------------------------------------------------------*/

const StatCardSkeleton = () => (
  <div className={cn(statCardVariants({ interactive: false }), "px-20 py-16")}>
    <div className="flex items-start justify-between gap-12">
      <div className="flex flex-col gap-6 min-w-0">
        <div className="h-14 w-80 bg-[var(--color-surface-light)] animate-pulse" />
        <div className="h-28 w-64 bg-[var(--color-surface-light)] animate-pulse" />
        <div className="h-14 w-120 bg-[var(--color-surface-light)] animate-pulse" />
      </div>
      <div className="w-32 h-32 bg-[var(--color-surface-light)] animate-pulse shrink-0" />
    </div>
  </div>
);

/* -------------------------------------------------------------------------------------------------
 * StatCard Component
 * -----------------------------------------------------------------------------------------------*/

const StatCardContent = React.forwardRef<
  HTMLDivElement,
  Omit<StatCardProps, "href">
>(
  (
    {
      className,
      title,
      value,
      description,
      icon,
      trend,
      trendValue,
      trendLabel,
      sparkline,
      interactive,
      isLoading,
      ...props
    },
    ref
  ) => {
    if (isLoading) {
      return <StatCardSkeleton />;
    }

    return (
      <div
        ref={ref}
        className={cn(
          statCardVariants({ interactive }),
          "px-20 py-16",
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-12">
          <div className="flex flex-col gap-2 min-w-0">
            <span className="label-micro text-[var(--color-text-secondary)]">
              {title}
            </span>
            <span className="title-heading-3 tabular-nums tracking-tight text-[var(--color-text-primary)]">
              {value}
            </span>
            {/* Trend indicator or description */}
            {trend && (trendValue || trendLabel) ? (
              <TrendBadge trend={trend} value={trendValue} label={trendLabel} />
            ) : description ? (
              <p className="body-caption text-[var(--color-text-tertiary)]">
                {description}
              </p>
            ) : null}
          </div>
          {icon && (
            <div className="flex items-center justify-center w-32 h-32 text-[var(--color-text-secondary)] shrink-0">
              {icon}
            </div>
          )}
        </div>
        {sparkline && <div className="mt-12">{sparkline}</div>}
      </div>
    );
  }
);
StatCardContent.displayName = "StatCardContent";

/* -------------------------------------------------------------------------------------------------
 * StatCard Main Export
 * -----------------------------------------------------------------------------------------------*/

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ href, ...props }, ref) => {
    if (href) {
      return (
        <Link href={href} className="block">
          <StatCardContent ref={ref} {...props} interactive />
        </Link>
      );
    }

    return <StatCardContent ref={ref} {...props} />;
  }
);
StatCard.displayName = "StatCard";

export { StatCard, StatCardSkeleton, TrendBadge };
