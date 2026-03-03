/**
 * Feedstocks Page
 * Displays feedstock statistics and list with CRUD operations
 */
import { FeedstockList, FeedstockStats } from "@/components/feedstocks";

export default function FeedstocksPage() {
  return (
    <div className="container-max py-32 flex flex-col gap-32">
      <FeedstockList stats={<FeedstockStats />} />
    </div>
  );
}
