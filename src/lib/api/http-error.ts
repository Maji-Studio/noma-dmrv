/** Transport refusals, separate from operation/domain failures. */
export class ApiHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly current?: unknown) {
    super(message);
  }
}
