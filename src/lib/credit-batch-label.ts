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

/** "Name (CODE)" for a named batch, the code alone otherwise: where the name must stay tied to the code. */
export function creditBatchNameWithCode(batch: { code: string; name?: string | null }): string {
  const name = creditBatchName(batch);
  return name ? `${name} (${batch.code})` : batch.code;
}
