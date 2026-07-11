import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  getDocumentById,
  getPublicDocumentById,
} from "@/data-access/documents";
import { getOrgContext } from "@/lib/auth/server";
import { getStorageProvider } from "@/lib/storage";
import { isAllowedRedirectHost } from "@/lib/documents/redirect-allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!idSchema.safeParse(id).success) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // Org-scoped read when the caller has an active organization; signed-out or
  // org-less callers only reach explicitly public documents.
  const orgCtx = await getOrgContext();
  const row = orgCtx
    ? await getDocumentById(orgCtx, id)
    : await getPublicDocumentById(id);
  if (!row) {
    return new NextResponse(orgCtx ? "Not Found" : "Unauthorized", {
      status: orgCtx ? 404 : 401,
    });
  }

  if (row.storageKey) {
    if (row.uploadStatus !== "uploaded") {
      return new NextResponse("Not Found", { status: 404 });
    }
    const provider = getStorageProvider();
    const signed = await provider.createDownloadUrl({ key: row.storageKey });
    return NextResponse.redirect(signed, { status: 302 });
  }

  if (row.fileUrl) {
    if (!URL.canParse(row.fileUrl)) {
      return new NextResponse("Invalid document URL", { status: 500 });
    }
    const parsed = new URL(row.fileUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return new NextResponse("Invalid document URL", { status: 500 });
    }
    // Embedded credentials (user:pass@host) are never legitimate for a
    // document link and are a classic phishing/SSRF dressing — refuse them.
    if (parsed.username || parsed.password) {
      console.error("Refusing document redirect with embedded credentials", {
        id: row.id,
      });
      return new NextResponse("Invalid document URL", { status: 500 });
    }
    // Fail closed: only redirect to our origin, the storage endpoint, or the
    // registry/cloud-storage families (see redirect-allowlist). This stops the
    // route being used as an open redirect that borrows the app's domain trust.
    if (!isAllowedRedirectHost(parsed.hostname)) {
      console.error("Refusing document redirect to non-allowlisted host", {
        id: row.id,
        host: parsed.hostname,
      });
      return new NextResponse("Document URL host not allowed", { status: 502 });
    }
    return NextResponse.redirect(parsed.toString(), { status: 302 });
  }

  console.error("Document has neither storageKey nor fileUrl", { id: row.id });
  return new NextResponse("Internal Server Error", { status: 500 });
}
