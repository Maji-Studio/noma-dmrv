import { oauthProtectedResourceDiscovery } from "@/lib/auth/oauth-discovery";

export async function GET() {
  return oauthProtectedResourceDiscovery("mcp");
}
