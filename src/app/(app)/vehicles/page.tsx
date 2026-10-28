/**
 * Vehicles list page (Setup). Protected by the (app) layout's requireAuth
 * guard; every member may manage these records.
 */
import { VehiclesPage } from "@/components/vehicles-and-crew";

export default function Page() {
  return <VehiclesPage />;
}
