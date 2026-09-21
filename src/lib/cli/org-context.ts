/**
 * The CLI org-context seam: the only writer of the org context that
 * `resolveOrgContext` reads when there is no request session. It exists so a
 * CLI (today the Mafinga seed) can call real server actions. Request code must
 * never use it.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { DEV_BOOTSTRAP_OVERRIDE, PRODUCTION_NODE_ENV } from "@/config/bootstrap";
import { cliOrgContextStore } from "@/lib/auth/cli-org-context-store";
import type { OrgContext } from "@/lib/auth/server";

const PLATFORM_ADMIN_ROLE = "admin";

/** Identities the CLI acts as. Only IDs: authority is verified here, not passed in. */
export type CliIdentity = {
  userId: string;
  organizationId: string;
};

/**
 * Missing or unusable bootstrap identities. The message is authored here, so a
 * CLI may print it; every other failure stays unprinted.
 */
export class CliBootstrapError extends Error {}

async function requirePlatformAdminUser(userId: string): Promise<string> {
  const [admin] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.id, userId), eq(users.role, PLATFORM_ADMIN_ROLE))).limit(1);
  if (!admin) {
    throw new CliBootstrapError("the CLI org context requires an existing Platform Admin user");
  }
  return admin.id;
}

async function requireOrganization(organizationId: string): Promise<string> {
  const [organization] = await db.select({ id: organizations.id }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1);
  if (!organization) {
    throw new CliBootstrapError("the CLI org context requires an existing organization");
  }
  return organization.id;
}

/**
 * Find the bootstrap Platform Admin for an organization that already exists.
 * A CLI calls this once and hands the result to `runWithCliOrgContext`.
 */
export async function resolveCliAdminIdentity(organizationId: string): Promise<CliIdentity> {
  const [admin] = await db.select({ id: users.id }).from(users)
    .where(eq(users.role, PLATFORM_ADMIN_ROLE)).limit(1);
  if (!admin) {
    throw new CliBootstrapError("run the admin and organization bootstrap (pnpm db:ensure-admin) first");
  }
  return { userId: admin.id, organizationId: await requireOrganization(organizationId) };
}

/**
 * Run `fn` as the given identity, with the org context every server action
 * resolves. The production refusal and the identity checks are the whole
 * security value of this seam, so it re-verifies whatever it is handed.
 */
export async function runWithCliOrgContext<T>(
  identity: CliIdentity,
  fn: () => Promise<T>,
): Promise<T> {
  if (
    process.env.NODE_ENV === PRODUCTION_NODE_ENV &&
    process.env.ALLOW_DEV_BOOTSTRAP !== DEV_BOOTSTRAP_OVERRIDE
  ) {
    throw new Error("CLI org context requires ALLOW_DEV_BOOTSTRAP=1 in production.");
  }
  const ctx: OrgContext = {
    userId: await requirePlatformAdminUser(identity.userId),
    organizationId: await requireOrganization(identity.organizationId),
    orgRole: "owner",
    isPlatformAdmin: true,
  };
  return cliOrgContextStore.run(ctx, fn);
}
