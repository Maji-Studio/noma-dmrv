const deadlines = new WeakMap<object, number>();

/** Shares the runner's budget with bounded external reads inside its transaction. */
export function setTransactionDeadline(tx: object, deadlineAt: number): void {
  deadlines.set(tx, deadlineAt);
}

export function getTransactionDeadline(tx: object): number | undefined {
  return deadlines.get(tx);
}
