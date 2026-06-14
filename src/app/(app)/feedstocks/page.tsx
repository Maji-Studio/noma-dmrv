/**
 * Feedstocks Page
 * Displays feedstock statistics and list with CRUD operations
 */
import { FeedstockList, FeedstockStats } from "@/components/feedstocks";

export default function FeedstocksPage() {
  return (
    <div className="container-max page-shell">
      <FeedstockList stats={<FeedstockStats />} />
    </div>
  );
}
