import { redirect } from "next/navigation";
import { CREDIT_BATCH_DEEP_LINK_PARAM } from "@/lib/credit-batch-links";

/**
 * The credit-batch detail page was retired in favour of the list's view side
 * sheet — old links land there via `?batch=<id>` (production-run pattern).
 */
interface CreditBatchRedirectPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CreditBatchRedirectPage({
  params,
  searchParams,
}: CreditBatchRedirectPageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(sp)) {
    if (key === CREDIT_BATCH_DEEP_LINK_PARAM) continue;
    if (Array.isArray(value)) {
      for (const entry of value) nextParams.append(key, entry);
    } else if (value !== undefined) {
      nextParams.set(key, value);
    }
  }

  nextParams.set(CREDIT_BATCH_DEEP_LINK_PARAM, id);

  redirect(`/credit-batches?${nextParams.toString()}`);
}
