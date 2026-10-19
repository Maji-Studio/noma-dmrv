import { formatFacilityDateTime } from './format-utils';

/** Shared refusal copy for feedstock and output stock history and commands. */
export const ALREADY_CORRECTED_MESSAGE = 'This entry has already been corrected. Open its correction instead.';
export const ALREADY_DELETED_MESSAGE = 'This entry has already been deleted.';

/** What cancelled a crossed-out stock entry: its replacement (an edit) or a lone reversal (a delete). */
export interface StockEntryReversal {
  recordedAt: string;
  actorName: string | null;
  replaced: boolean;
}

/** The caption under a crossed-out stock entry, shared by the feedstock and output stock histories. */
export function reversalCaption(reversal: StockEntryReversal | null, timeZone: string): string {
  const cause = !reversal ? 'Reversed.'
    : reversal.replaced ? `Replaced by the correction recorded ${formatFacilityDateTime(reversal.recordedAt, timeZone)}.`
      : `Deleted ${formatFacilityDateTime(reversal.recordedAt, timeZone)}${reversal.actorName ? ` by ${reversal.actorName}` : ''}.`;
  return `${cause} It no longer counts toward the stock.`;
}
