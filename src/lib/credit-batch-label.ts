/**
 * What operators call a credit batch: the name they gave it, else its code.
 * The code stays the system identifier (refusals, record links, the registry).
 */
export function creditBatchLabel(batch: { code: string; name?: string | null }): string {
  return batch.name?.trim() || batch.code;
}
