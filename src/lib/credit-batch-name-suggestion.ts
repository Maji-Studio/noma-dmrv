import { CREDIT_BATCH_NAME_MAX_LENGTH } from "@/schemas/credit-batches";

export function nextCreditBatchName(previous: string | null | undefined): string | null {
  const name = previous?.trimEnd();
  const suffix = name?.match(/[0-9]+$/);
  if (!name || !suffix) return null;

  const incremented = (BigInt(suffix[0]) + BigInt(1)).toString().padStart(suffix[0].length, "0");
  const suggestion = name.slice(0, suffix.index) + incremented;
  return suggestion.length <= CREDIT_BATCH_NAME_MAX_LENGTH ? suggestion : null;
}
