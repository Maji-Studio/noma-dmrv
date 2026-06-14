/**
 * Energy Summary Page
 * Facility electricity + diesel rollup with the per-stage Isometric
 * submission preview. Protected by requireAuth guard in the (app) layout.
 */
import { EnergySummary } from "@/components/energy/energy-summary";

export default function EnergyPage() {
  return (
    <div className="container-max page-shell">
      <EnergySummary />
    </div>
  );
}
