/**
 * Production Processes List Page (ADR 0017 Track 1.5)
 * Read-only operator surface for per-feedstock sampling campaigns.
 * Protected by requireAuth guard in the (app) layout.
 */
import { ProductionProcessList } from "@/components/production-processes";

export default function ProductionProcessesPage() {
  return <ProductionProcessList />;
}
