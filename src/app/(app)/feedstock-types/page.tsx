import { FeedstockTypeList } from "@/components/feedstock-types";
import { getOrgContext } from "@/lib/auth/server";

export default async function FeedstockTypesPage() {
  const ctx = await getOrgContext();
  const canManage =
    !!ctx &&
    (ctx.isPlatformAdmin || ctx.orgRole === "owner" || ctx.orgRole === "admin");

  return <FeedstockTypeList canManage={canManage} />;
}
