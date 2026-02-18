/**
 * Reactors List Page
 * Displays the list of all reactors with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { ReactorList } from "@/components/reactors";

export default function ReactorsPage() {
  return <ReactorList />;
}
