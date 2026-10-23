/**
 * Vehicles and crew list page (Distribution). Protected by the (app) layout's
 * requireAuth guard; every member may manage these records.
 */
import { VehiclesAndCrewPage } from "@/components/vehicles-and-crew";

export default function Page() {
  return <VehiclesAndCrewPage />;
}
