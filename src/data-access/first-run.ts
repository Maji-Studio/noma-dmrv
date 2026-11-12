import { hashPassword } from "better-auth/crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { SafeError } from "@/lib/errors";
import type { FirstAdminInput } from "@/schemas/first-run";

const FIRST_RUN_LOCK_KEY = "first-platform-admin";
const FIRST_RUN_LOCK_HASH_SEED = 0;
const CREDENTIAL_PROVIDER = "credential";

// org-scope-ok: public first-run routing checks only whether any user exists, before an organization or session exists.
export async function hasAnyUser(): Promise<boolean> {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  return Boolean(user);
}

// org-scope-ok: first-run bootstrap is authorized only while the entire user table is empty, rechecked under a transaction lock.
export async function createFirstPlatformAdmin({ email, password }: FirstAdminInput) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${FIRST_RUN_LOCK_KEY}, ${FIRST_RUN_LOCK_HASH_SEED}))`);
    const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
    if (existing) {
      throw new SafeError("This dMRV is already set up. Sign in instead.");
    }

    const passwordHash = await hashPassword(password);
    const userId = crypto.randomUUID();
    const normalizedEmail = email.trim().toLowerCase();
    await tx.insert(users).values({
      id: userId,
      email: normalizedEmail,
      name: "Admin",
      role: "admin",
      emailVerified: true,
    });
    await tx.insert(accounts).values({
      id: crypto.randomUUID(),
      userId,
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER,
      password: passwordHash,
    });
    return { userId, email: normalizedEmail };
  });
}
