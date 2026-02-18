/**
 * Facilities List Page
 * Displays the list of all facilities with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { FacilityList } from "@/components/facilities";

export default function FacilitiesPage() {
  return <FacilityList />;
}
