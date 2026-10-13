import { StatusBadge } from "@/components/ui/status-badge";

/** Marks a supplier or customer's default location in a location row. */
export function DefaultLocationBadge() {
  return <StatusBadge status="active" label="Default" size="small" className="shrink-0" />;
}
