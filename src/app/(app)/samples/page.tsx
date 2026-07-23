/**
 * Samples Page
 * Lab sample tracking linked to production runs
 * Route: /samples
 */

import { SampleList } from "@/components/samples";
import { isCreateIntentValue } from "@/lib/create-intent";

export const metadata = {
  title: "Lab Samples | Maji dMRV",
  description: "Lab sample tracking for biochar quality analysis linked to production runs",
};

export default async function SamplesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const creditBatch = Array.isArray(query.creditBatch)
    ? query.creditBatch[0]
    : query.creditBatch;

  return (
    <SampleList
      initialCreate={isCreateIntentValue(query.create)}
      initialCreditBatchId={creditBatch}
    />
  );
}
