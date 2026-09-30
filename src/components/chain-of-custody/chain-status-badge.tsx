import {
  StatusBadge,
  statusLabels,
  type StatusValue,
} from "@/components/ui/status-badge";

/**
 * Status badge for a traceability node (canvas node, sheet and map panel).
 *
 * Node statuses come from several entities. Values the shared StatusBadge
 * vocabulary knows render as their own list badges do; a feedstock's
 * `missing_data` matches the feedstock list ("Pending" colour, "Missing data"
 * label). Anything else falls back to a neutral badge with a readable label.
 */
function toBadgeProps(status: string): { status: StatusValue; label?: string } {
  if (status === "missing_data") {
    return { status: "pending", label: "Missing data" };
  }
  if (Object.hasOwn(statusLabels, status)) {
    return { status: status as StatusValue };
  }
  const readable = status.replaceAll("_", " ");
  return {
    status: "draft",
    label: readable.charAt(0).toUpperCase() + readable.slice(1),
  };
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
