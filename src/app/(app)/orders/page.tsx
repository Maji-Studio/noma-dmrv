/**
 * Orders List Page
 * Displays the list of all orders with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { OrderList } from "@/components/orders";

export default function OrdersPage() {
  return <OrderList />;
}
