/**
 * Applications List Page
 * Displays the list of all field applications with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { ApplicationList } from "@/components/applications";

export default function ApplicationsPage() {
  return <ApplicationList />;
}
