import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Status Badge Component
 *
 * Color-coded status badge component with variants for:
 * - Production run status: draft, running, complete, failed, cancelled
 * - Delivery status: upcoming, delivered
 * - Application status: delivered, applied
 * - Credit batch status: draft, pending, verified, issued, rejected
 *
 * Follows design system color tokens.
 */

const statusBadgeVariants = cva(
  // Square corners — Maji DS brutalist rule; chips/pills never get radii.
  "inline-flex items-center justify-center whitespace-nowrap body-caption-fit font-medium border transition-colors",
  {
    variants: {
      /**
       * Status determines the color scheme of the badge
       */
      /**
       * All states map onto the design-system status ramp
       * (--st-ok / --st-run / --st-wait / --st-off / --st-bad).
       */
      status: {
        // Off / inactive states — muted (st-off)
        draft: "bg-[var(--st-off-bg)] text-[var(--color-text-secondary)] border-[var(--st-off-border)]",

        // Superseded / replaced states - muted with strikethrough, distinct from draft
        superseded: "bg-[var(--st-off-bg)] text-[var(--color-text-tertiary)] border-[var(--st-off-border)] line-through",

        // In-progress / Active states (st-run)
        running: "bg-[var(--st-run-bg)] text-[var(--st-run)] border-[var(--st-run-border)]",
        sold: "bg-[var(--st-run-bg)] text-[var(--st-run)] border-[var(--st-run-border)]",

        // Pending / Upcoming / attention states (st-wait)
        pending: "bg-[var(--st-wait-bg)] text-[var(--st-wait)] border-[var(--st-wait-border)]",
        upcoming: "bg-[var(--st-wait-bg)] text-[var(--st-wait)] border-[var(--st-wait-border)]",
        testing: "bg-[var(--st-wait-bg)] text-[var(--st-wait)] border-[var(--st-wait-border)]",

        // Success / Complete states (st-ok)
        complete: "bg-[var(--st-ok-bg)] text-[var(--st-ok)] border-[var(--st-ok-border)]",
        delivered: "bg-[var(--st-ok-bg)] text-[var(--st-ok)] border-[var(--st-ok-border)]",
        applied: "bg-[var(--st-ok-bg)] text-[var(--st-ok)] border-[var(--st-ok-border)]",
        verified: "bg-[var(--st-ok-bg)] text-[var(--st-ok)] border-[var(--st-ok-border)]",
        issued: "bg-[var(--st-ok-bg)] text-[var(--st-ok)] border-[var(--st-ok-border)]",
        ready: "bg-[var(--st-ok-bg)] text-[var(--st-ok)] border-[var(--st-ok-border)]",

        // Error / Void / Rejected states (st-bad)
        void: "bg-[var(--st-bad-bg)] text-[var(--st-bad)] border-[var(--st-bad-border)]",
        failed: "bg-[var(--st-bad-bg)] text-[var(--st-bad)] border-[var(--st-bad-border)]",
        cancelled: "bg-[var(--st-bad-bg)] text-[var(--st-bad)] border-[var(--st-bad-border)]",
        rejected: "bg-[var(--st-bad-bg)] text-[var(--st-bad)] border-[var(--st-bad-border)]",
      },
      /**
       * Size variants
       */
      size: {
        default: "h-[24px] px-8 py-4",
        small: "h-[20px] px-6 py-2 text-[10px]",
        large: "h-[28px] px-12 py-6",
      },
    },
    defaultVariants: {
      status: "draft",
      size: "default",
    },
  }
)

// All possible status values
export type StatusValue =
  // Production run status
  | "draft"
  | "superseded"
  | "running"
  | "complete"
  | "failed"
  | "cancelled"
  | "void"
  // Delivery status
  | "upcoming"
  | "delivered"
  // Application status
  | "applied"
  // Product status
  | "testing"
  | "ready"
  | "sold"
  // Credit batch status
  | "pending"
  | "verified"
  | "issued"
  | "rejected"

// Status display labels (maps status value to human-readable text)
const statusLabels: Record<StatusValue, string> = {
  draft: "Draft",
  superseded: "Superseded",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
  void: "Void",
  upcoming: "Upcoming",
  delivered: "Delivered",
  applied: "Applied",
  testing: "Testing",
  ready: "Ready",
  sold: "Sold",
  pending: "Pending",
  verified: "Verified",
  issued: "Issued",
  rejected: "Rejected",
}

export interface StatusBadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    VariantProps<typeof statusBadgeVariants> {
  /**
   * The status value to display.
   * Determines both the label and the color scheme.
   */
  status: StatusValue
  /**
   * Optional custom label to override the default status label
   */
  label?: string
  /**
   * Optional leading icon (typically a 14px Phosphor icon).
   * Inherits the badge's text color.
   */
  icon?: React.ReactNode
}

/**
 * StatusBadge - A color-coded badge component for displaying various status types.
 *
 * @example
 * // Production run status
 * <StatusBadge status="running" />
 * <StatusBadge status="complete" />
 *
 * @example
 * // Delivery status
 * <StatusBadge status="upcoming" />
 * <StatusBadge status="delivered" />
 *
 * @example
 * // Application status
 * <StatusBadge status="applied" />
 *
 * @example
 * // Credit batch status
 * <StatusBadge status="pending" />
 * <StatusBadge status="verified" />
 * <StatusBadge status="issued" />
 * <StatusBadge status="rejected" />
 *
 * @example
 * // With custom label
 * <StatusBadge status="complete" label="Completed Successfully" />
 *
 * @example
 * // Different sizes
 * <StatusBadge status="running" size="small" />
 * <StatusBadge status="running" size="large" />
 */
const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ className, status, size, label, icon, ...props }, ref) => {
    const displayLabel = label ?? statusLabels[status]

    return (
      <span
        ref={ref}
        className={cn(
          statusBadgeVariants({ status, size, className }),
          icon ? "gap-4" : undefined
        )}
        data-status={status}
        {...props}
      >
        {icon && (
          <span aria-hidden className="shrink-0 inline-flex">
            {icon}
          </span>
        )}
        {displayLabel}
      </span>
    )
  }
)
StatusBadge.displayName = "StatusBadge"

export { StatusBadge, statusBadgeVariants, statusLabels }
