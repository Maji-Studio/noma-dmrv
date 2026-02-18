/**
 * Production Runs List Page
 * Displays the list of all production runs with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { ProductionRunList } from "@/components/production-runs";

export default function ProductionRunsPage() {
  return <ProductionRunList />;
}
