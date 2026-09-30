import {
  StatusBadge,
  statusLabels,
  type StatusValue,
} from "@/components/ui/status-badge";
import { humanizeEnum } from "@/lib/copy-utils";

/**
 * Status badge for a traceability node (canvas node, sheet and map panel).
 *
 * Node statuses come from several entities. Values the shared StatusBadge
 * vocabulary knows render as their own list badges do, colour included.
 * Anything else falls back to a neutral badge with a readable label.
 */
export function toBadgeProps(status: string): { status: StatusValue; label?: string } {
  if (Object.hasOwn(statusLabels, status)) {
    return { status: status as StatusValue };
  }
  return { status: "draft", label: humanizeEnum(status) };
}

export function ChainStatusBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  if (!status) return null;
  return (
    <StatusBadge
      {...toBadgeProps(status)}
      size="small"
      className={className}
    />
  );
}
