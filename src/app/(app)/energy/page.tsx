/**
 * Energy page: where the facility's energy went over a period, and which
 * records used it (ADR 0031). Protected by the requireAuth guard in the (app)
 * layout.
 */
import { EnergyPage } from "@/components/energy";

export default function EnergyRoute() {
  return <EnergyPage />;
}
