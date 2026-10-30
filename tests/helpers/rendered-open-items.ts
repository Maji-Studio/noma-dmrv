import { openItemText, type CreditBatchOpenItem } from "@/lib/credit-batches/open-items";

/**
 * The to-dos as an editable batch reads them: each item's `detail` and
 * `instruction` joined into the one text the page renders. Lets a test assert
 * the rendered copy while the builder keeps the two apart.
 */
export function renderedOpenItems<T extends { blocking: CreditBatchOpenItem[]; check: CreditBatchOpenItem[] }>(result: T): T {
  const join = (item: CreditBatchOpenItem): CreditBatchOpenItem => {
    const joined: CreditBatchOpenItem = { ...item, detail: openItemText(item) };
    delete joined.instruction;
    return joined;
  };
  return { ...result, blocking: result.blocking.map(join), check: result.check.map(join) };
}
