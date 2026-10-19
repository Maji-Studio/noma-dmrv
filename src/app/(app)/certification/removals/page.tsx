/**
 * Certification → Removals tab
 * Lists every Removal for the selected facility in the app-native DataTable
 * idiom, with a `?removal=<id>` side-sheet quick view and ungrouped-batch
 * grouping. Protected by the requireAuth guard in the (app) layout.
 */
import { RemovalsList } from "@/components/certification/removals-list";
import { CREATE_INTENT_PARAM, isCreateIntentValue } from "@/lib/create-intent";

export default async function CertificationRemovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return <RemovalsList initialCreate={isCreateIntentValue(query[CREATE_INTENT_PARAM])} />;
}
