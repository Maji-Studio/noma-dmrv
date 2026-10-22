/**
 * Vehicles and crew list page (Distribution). Protected by the (app) layout's
 * requireAuth guard; every member may manage these records.
 */
import { VehiclesAndCrewPage as VehiclesAndCrewList } from "@/components/vehicles-and-crew/vehicles-and-crew-page";

export default function VehiclesAndCrewPage() {
  return <VehiclesAndCrewList />;
}
