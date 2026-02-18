/**
 * Deliveries List Page
 * Displays the list of all deliveries with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { DeliveryList } from "@/components/deliveries";

export default function DeliveriesPage() {
  return <DeliveryList />;
}
