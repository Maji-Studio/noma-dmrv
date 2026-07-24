/**
 * Samples Page
 * Lab sample tracking linked to production runs
 * Route: /samples
 */

import { SampleList } from "@/components/samples";
import { SAMPLE_CREATE_CREDIT_BATCH_PARAM } from "@/lib/sample-create-intent";
import {
  CREATE_INTENT_PARAM,
  isCreateIntentValue,
} from "@/lib/create-intent";

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
  const requestedCreditBatch = query[SAMPLE_CREATE_CREDIT_BATCH_PARAM];
  const creditBatch = Array.isArray(requestedCreditBatch)
    ? requestedCreditBatch[0]
    : requestedCreditBatch;

  return (
    <SampleList
      initialCreate={isCreateIntentValue(query[CREATE_INTENT_PARAM])}
      initialCreditBatchId={creditBatch}
    />
  );
}
