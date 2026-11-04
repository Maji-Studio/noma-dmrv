/**
 * Crew list page (Setup): drivers and operators. Protected by the (app)
 * layout's requireAuth guard; every member may manage these records.
 */
import { CrewPage } from "@/components/vehicles-and-crew";

export default function Page() {
  return <CrewPage />;
}
