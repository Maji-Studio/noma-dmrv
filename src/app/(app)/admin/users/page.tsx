import { redirect } from "next/navigation";
import { SETTINGS_MEMBERS_HREF } from "@/lib/settings/links";

export default function AdminUsersPage() {
  redirect(SETTINGS_MEMBERS_HREF);
}
