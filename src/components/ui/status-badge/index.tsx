import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import {
  STATUS_STATE_BADGE_CLASSES,
  getStatusState,
  type SemanticEntityStatus,
} from "@/lib/status-state"

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
      stateClass: STATUS_STATE_BADGE_CLASSES,
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
      stateClass: "neutral",
      size: "default",
    },
  }
)

// Status display labels (maps status value to human-readable text)
const statusLabels = {
  draft: "Draft",
  superseded: "Superseded",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
  void: "Void",
  method_a: "Method A",
  method_b: "Method B",
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
} as const satisfies Partial<Record<SemanticEntityStatus, string>>

export type StatusValue = keyof typeof statusLabels

export interface StatusBadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    Omit<VariantProps<typeof statusBadgeVariants>, "stateClass"> {
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
    const stateClass = getStatusState(status)

    return (
      <span
        ref={ref}
        className={cn(
          statusBadgeVariants({ stateClass, size, className }),
          status === "superseded" ? "line-through" : undefined,
          icon ? "gap-4" : undefined
        )}
        {...props}
        data-status={status}
        data-status-state={stateClass}
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
