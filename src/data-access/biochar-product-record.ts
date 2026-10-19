import type { BiocharProduct, BiocharProductRecord } from "@/db/schema";

/** Drops the internal posting sequence, a bigint that write results cannot serialize. */
export function toBiocharProductRecord(product: BiocharProduct): BiocharProductRecord {
  const record: Partial<BiocharProduct> = { ...product };
  delete record.stockPostingSequence;
  return record as BiocharProductRecord;
}
