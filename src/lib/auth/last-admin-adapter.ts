import type { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { isLastAdminDatabaseError, LAST_ADMIN_MESSAGE } from "./organization-role-policy";

type AdapterFactory = ReturnType<typeof drizzleAdapter>;
type Adapter = ReturnType<AdapterFactory>;
type TransactionAdapter = Omit<Adapter, "transaction">;

async function guard<Result>(operation: Promise<Result>): Promise<Result> {
  try {
    return await operation;
  } catch (error) {
    if (isLastAdminDatabaseError(error)) {
      throw new APIError("BAD_REQUEST", { code: "LAST_ADMIN", message: LAST_ADMIN_MESSAGE });
    }
    throw error;
  }
}

function wrap(adapter: TransactionAdapter): TransactionAdapter {
  const update = adapter.update.bind(adapter);
  const updateMany = adapter.updateMany.bind(adapter);
  const remove = adapter.delete.bind(adapter);
  const deleteMany = adapter.deleteMany.bind(adapter);
  // Better Auth registers schema checks in a WeakMap keyed by this instance.
  // Preserve its identity while decorating the mutation methods.
  adapter.update = <T>(args: Parameters<Adapter["update"]>[0]) => guard(update<T>(args));
  adapter.updateMany = args => guard(updateMany(args));
  adapter.delete = args => guard(remove(args));
  adapter.deleteMany = args => guard(deleteMany(args));
  return adapter;
}

/** Raw database errors bypass Better Auth after hooks. Translate at the adapter
 * boundary, including adapters supplied to a plugin transaction. */
export function withLastAdminGuard(factory: AdapterFactory): AdapterFactory {
  return options => {
    const adapter = factory(options);
    const transaction = adapter.transaction.bind(adapter);
    wrap(adapter);
    adapter.transaction = callback => guard(transaction(tx => callback(wrap(tx))));
    return adapter;
  };
}
