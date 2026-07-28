/**
 * Storage Locations List Page
 * Displays the list of all storage locations with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { Suspense } from "react";
import { StorageLocationList } from "@/components/storage-locations";

export default function StorageLocationsPage() {
  // Suspense boundary: the list reads the throwaway `?variant=` prototype param
  // via useSearchParams. Remove with the prototype.
  return (
    <Suspense>
      <StorageLocationList />
    </Suspense>
  );
}
