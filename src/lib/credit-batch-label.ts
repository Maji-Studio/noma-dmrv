/** The name an operator gave a credit batch, trimmed, or null when it has none. */
export function creditBatchName(batch: { name?: string | null }): string | null {
  return batch.name?.trim() || null;
}

/**
 * What operators call a credit batch: the name they gave it, else its code.
 * The code stays the system identifier (refusals, record links, the registry).
 */
export function creditBatchLabel(batch: { code: string; name?: string | null }): string {
  return creditBatchName(batch) ?? batch.code;
}
