/**
 * Vehicles and crew list page (Distribution). Protected by the (app) layout's
 * requireAuth guard; every member may manage these records.
 */
import { VehiclesAndCrewList } from "@/components/settings";

export default function VehiclesAndCrewPage() {
  return <VehiclesAndCrewList />;
}
