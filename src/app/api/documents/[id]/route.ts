import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  getDocumentById,
  getPublicDocumentById,
} from "@/data-access/documents";
import { getUser } from "@/lib/auth/server";
import { getStorageProvider } from "@/lib/storage";

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

  const user = await getUser();
  const row = user?.id
    ? await getDocumentById(user.id, id)
    : await getPublicDocumentById(id);
  if (!row) {
    return new NextResponse(user?.id ? "Not Found" : "Unauthorized", {
      status: user?.id ? 404 : 401,
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
    let parsed: URL;
    try {
      parsed = new URL(row.fileUrl);
    } catch {
      return new NextResponse("Invalid document URL", { status: 500 });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return new NextResponse("Invalid document URL", { status: 500 });
    }
    return NextResponse.redirect(parsed.toString(), { status: 302 });
  }

  console.error("Document has neither storageKey nor fileUrl", { id: row.id });
  return new NextResponse("Internal Server Error", { status: 500 });
}
