import { APIError } from "better-auth/api";
import { orgRoleSchema } from "@/schemas/organizations";

export const LAST_ADMIN_MESSAGE =
  "An organization must keep at least one Admin. Make another member an Admin first.";

const ROLE_WRITE_PATHS = new Set([
  "/organization/update-member-role",
  "/organization/invite-member",
]);
const LAST_ADMIN_ERROR_CODES = new Set([
  "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
  "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER",
]);

/** Better Auth merges built-in roles with custom roles, so its validation alone
 * still accepts owner and comma-separated multi-role grants. noma has one role. */
export function validateOrganizationRoleInput(path: string | undefined, body: unknown) {
  if (!path || !ROLE_WRITE_PATHS.has(path)) return;
  const role = body && typeof body === "object" && "role" in body ? body.role : undefined;
  assertOrganizationRole(role);
}

export function assertOrganizationRole(role: unknown) {
  if (!orgRoleSchema.safeParse(role).success) {
    throw new APIError("BAD_REQUEST", { message: "Choose Admin or Member." });
  }
}

/** Keep the upstream codes internal; creatorRole makes these Admin refusals. */
export function translateLastAdminError(result: unknown, actingRole?: string) {
  if (!(result instanceof APIError)) return;
  if (result.body?.code && LAST_ADMIN_ERROR_CODES.has(result.body.code)) {
    if (result.body.code === "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER" && actingRole !== "admin") {
      throw new APIError("BAD_REQUEST", { code: "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER", message: "You are not allowed to remove this member." });
    }
    throw new APIError("BAD_REQUEST", {
      code: "LAST_ADMIN",
      message: LAST_ADMIN_MESSAGE,
    });
  }
}

/** PostgreSQL check violation from the members trigger, possibly wrapped by Drizzle. */
export function isLastAdminDatabaseError(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    if ("code" in error && error.code === "23514" &&
        "constraint" in error && error.constraint === "members_last_admin") return true;
    error = "cause" in error ? error.cause : undefined;
  }
  return false;
}
