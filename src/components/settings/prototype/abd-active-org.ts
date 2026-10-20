/**
 * Throwaway: which organization a prototype variant (A, B, D) is "inside",
 * and the viewer's role there. Each variant keeps its own param (`a-org`,
 * `b-org`, `d-org`) so the switcher never carries one variant's state into
 * another. Nothing here touches the real session.
 */
import { useSearchParams } from "next/navigation";
import {
  fixtures,
  VIEWER_PARAM,
  viewerFromParam,
  type OrgRole,
  type PrototypeViewer,
} from "./abd-fixtures";
import { setSettingsPrototypeParams } from "./use-settings-prototype-variant";

export type ActiveRole = OrgRole | "Platform Admin";

export interface PrototypeActiveOrg {
  id: string;
  name: string;
  role: ActiveRole;
  viewer: PrototypeViewer;
  /** Owner, Admin or Platform Admin. */
  canManage: boolean;
  /** Platform Admins act without a membership. */
  isPlatformAdminInside: boolean;
  user: { name: string; email: string };
}

export function useAbdActiveOrg(param: "a-org" | "b-org" | "d-org"): PrototypeActiveOrg {
  const params = useSearchParams();
  const viewer = viewerFromParam(params.get(VIEWER_PARAM));
  const id = params.get(param) ?? fixtures.activeOrg.id;

  if (viewer === "platform-admin") {
    const org =
      fixtures.organizations.find((o) => o.id === id) ?? fixtures.organizations[0];
    return {
      id: org.id,
      name: org.name,
      role: "Platform Admin",
      viewer,
      canManage: true,
      isPlatformAdminInside: true,
      user: fixtures.platformAdminUser,
    };
  }

  const membership =
    fixtures.memberships.find((m) => m.id === id) ?? fixtures.memberships[0];
  return {
    id: membership.id,
    name: membership.name,
    role: membership.role,
    viewer,
    canManage: membership.role !== "Member",
    isPlatformAdminInside: false,
    user: fixtures.memberUser,
  };
}

export function enterAbdOrg(
  param: "a-org" | "b-org" | "d-org",
  orgId: string,
  extra: Record<string, string | null> = {},
): void {
  setSettingsPrototypeParams({
    [param]: orgId === fixtures.activeOrg.id ? null : orgId,
    ...extra,
  });
}
