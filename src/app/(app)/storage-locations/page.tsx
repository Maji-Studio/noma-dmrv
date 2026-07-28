/**
 * Storage Locations List Page
 * Displays the list of all storage bins with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { StorageLocationList } from "@/components/storage-locations";

export default function StorageLocationsPage() {
  return <StorageLocationList />;
}
