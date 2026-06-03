/**
 * Certification → Removals tab
 * Lists every Removal for the selected facility in the app-native DataTable
 * idiom, with a `?removal=<id>` side-sheet quick view and ungrouped-batch
 * grouping. Protected by the requireAuth guard in the (app) layout.
 */
import { RemovalsList } from "@/components/certification/removals-list";

export default function CertificationRemovalsPage() {
  return <RemovalsList />;
}
