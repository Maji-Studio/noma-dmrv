/**
 * Credit Batches List Page
 * Displays the list of all credit batches with CRUD operations
 * Protected by requireAuth guard in the (app) layout
 */
import { CreditBatchList } from "@/components/credit-batches";

export default async function CreditBatchesPage() {
  return <CreditBatchList />;
}
