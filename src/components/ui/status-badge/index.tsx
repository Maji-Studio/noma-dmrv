import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Status Badge Component
 *
 * Color-coded status badge component with variants for:
 * - Production run status: draft, running, complete, void
 * - Delivery status: upcoming, delivered
 * - Application status: delivered, applied
 * - Credit batch status: draft, pending, verified, issued, rejected
 *
 * Follows design system color tokens.
 */

const statusBadgeVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap body-caption-fit font-medium rounded-[4px] border transition-colors",
  {
    variants: {
      /**
       * Status determines the color scheme of the badge
       */
      status: {
        // Neutral / Draft states - gray
        draft: "bg-[var(--color-background-medium)] text-[var(--color-text-secondary)] border-[var(--color-border-secondary)]",

        // Superseded / replaced states - muted with strikethrough, distinct from draft
        superseded: "bg-[var(--color-background-light)] text-[var(--color-text-tertiary)] border-[var(--color-border-tertiary)] line-through",

        // In-progress / Active states - purple/brand
        running: "bg-[var(--clr-purple-10)] text-[var(--clr-purple)] border-[var(--clr-purple-40)]",

        // Pending / Upcoming states - orange/warning
        pending: "bg-[var(--clr-orange-10)] text-[var(--color-signal-orange)] border-[var(--clr-orange-40)]",
        upcoming: "bg-[var(--clr-orange-10)] text-[var(--color-signal-orange)] border-[var(--clr-orange-40)]",

        // Success / Complete states - green
        complete: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] border-[var(--color-status-success-border)]",
        delivered: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] border-[var(--color-status-success-border)]",
        applied: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] border-[var(--color-status-success-border)]",
        verified: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] border-[var(--color-status-success-border)]",
        issued: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] border-[var(--color-status-success-border)]",

        // Testing / Ready states
        testing: "bg-[var(--clr-orange-10)] text-[var(--color-signal-orange)] border-[var(--clr-orange-40)]",
        ready: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] border-[var(--color-status-success-border)]",
        sold: "bg-[var(--clr-purple-10)] text-[var(--clr-purple)] border-[var(--clr-purple-40)]",

        // Error / Void / Rejected states - red
        void: "bg-[var(--clr-red-10)] text-[var(--clr-red)] border-[var(--clr-red-40)]",
        rejected: "bg-[var(--clr-red-10)] text-[var(--clr-red)] border-[var(--clr-red-40)]",
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
  ({ className, status, size, label, ...props }, ref) => {
    const displayLabel = label ?? statusLabels[status]

    return (
      <span
        ref={ref}
        className={cn(statusBadgeVariants({ status, size, className }))}
        data-status={status}
        {...props}
      >
        {displayLabel}
      </span>
    )
  }
)
StatusBadge.displayName = "StatusBadge"

export { StatusBadge, statusBadgeVariants, statusLabels }
