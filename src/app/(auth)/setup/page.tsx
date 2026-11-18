/**
 * First-run setup page
 * Creates the first Platform Admin while no user exists, then sends everyone to sign in.
 */
import { redirect } from "next/navigation";
import { SetupForm } from "@/components/auth";
import { hasAnyUser } from "@/data-access/first-run";

// The user check must run on every request, never at build time.
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");

  return <SetupForm />;
}
