import type { OrgRole } from "@/lib/auth/server";

/**
 * Lowest organization role that may delete a Removal once its registry
 * boundary opened (decision of 2026-09-29, issue #746). Below it, members may
 * delete only a Removal that never touched the registry. Platform Admins
 * always pass. Change the floor here; call sites read this constant.
 */
export const REMOVAL_REGISTRY_DELETION_MIN_ROLE: OrgRole = "admin";
