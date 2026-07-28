import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getVerifierReportDocument } from "@/data-access/ghg-statement-reports";
import {
  verifyReportCapabilityToken,
} from "@/lib/certification/ghg-statement-report/verifier-url";
import { getStorageProvider } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reportIdSchema = z.string().uuid();

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ reportId: string }> },
): Promise<NextResponse> {
  const { reportId } = await context.params;
  if (!reportIdSchema.safeParse(reportId).success) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const report = await getVerifierReportDocument(reportId);
  if (
    !report ||
    !verifyReportCapabilityToken(
      reportId,
      token,
      report.verifierTokenHash,
    )
  ) {
    return new NextResponse("Not Found", { status: 404 });
  }
  if (!report.storageKey || report.uploadStatus !== "uploaded") {
    return new NextResponse("Not Found", { status: 404 });
  }
  const signedUrl = await getStorageProvider().createDownloadUrl({
    key: report.storageKey,
  });
  const response = NextResponse.redirect(signedUrl, { status: 302 });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
