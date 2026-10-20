/** Revalidate the reviewed set under the entry locks; new rows never join this attempt. */
export function emissionEntryCanBeReserved(args: {
  entry: { id: string; creditBatchId: string; contentRevision: number; deletedAt: Date | null;
    kind: "value" | "zero"; confirmedForRemovalId: string | null; sentByRemovalId: string | null; sendReservedBySubmissionId: string | null };
  expectedRevision: number | undefined;
  memberBatchIds: readonly string[];
  removalId: string;
  submissionId: string;
  priorReservationTransferable: boolean;
}): boolean {
  const { entry } = args;
  return !entry.deletedAt && entry.contentRevision === args.expectedRevision && args.memberBatchIds.includes(entry.creditBatchId) &&
    (!entry.sentByRemovalId || entry.sentByRemovalId === args.removalId) &&
    (entry.kind !== "zero" || entry.confirmedForRemovalId === args.removalId) &&
    (!entry.sendReservedBySubmissionId || entry.sendReservedBySubmissionId === args.submissionId || args.priorReservationTransferable);
}
