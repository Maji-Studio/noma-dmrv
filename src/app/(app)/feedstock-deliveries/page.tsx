/**
 * Feedstock Deliveries Page
 * Displays feedstock delivery statistics and list with CRUD operations
 */
import { FeedstockDeliveryList, FeedstockDeliveryStats } from "@/components/feedstock-deliveries";

export default function FeedstockDeliveriesPage() {
  return (
    <div className="container-max py-32 flex flex-col gap-32">
      <FeedstockDeliveryList stats={<FeedstockDeliveryStats />} />
    </div>
  );
}
