/**
 * Counts every statement the app sends through `pg`. Import this module
 * before `@/db` (or anything that imports it): the pool wraps
 * `Client.prototype.query` when a client is constructed, so the patch has to
 * be in place before the first connection. Transaction control statements
 * (`begin`, `set transaction`, `commit`) count as round trips too, because
 * that is what they cost.
 */
import { Client } from "pg";

let counting = false;
let total = 0;

const originalQuery = Client.prototype.query;
Client.prototype.query = function patchedQuery(
  this: Client,
  ...args: unknown[]
) {
  if (counting) total += 1;
  return Reflect.apply(originalQuery, this, args);
} as Client["query"];

/** Run `fn` and return its result together with the number of statements sent. */
export async function countQueries<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; queries: number }> {
  if (counting) throw new Error("countQueries does not nest");
  counting = true;
  total = 0;
  try {
    const result = await fn();
    return { result, queries: total };
  } finally {
    counting = false;
  }
}
