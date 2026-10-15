import { documentReadHandler } from "@/lib/api/document-read-handlers";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = documentReadHandler("delivery", "content");
