import { StatusBadge } from "@/components/ui/status-badge";

/** Chip for a biochar bin that holds uncarbonized material (a failed run's output). */
export function UncarbonizedBadge({ size = "small", className }: { size?: "default" | "small" | "large"; className?: string }) {
  return <StatusBadge status="pending" label="Uncarbonized" size={size} className={className} />;
}
