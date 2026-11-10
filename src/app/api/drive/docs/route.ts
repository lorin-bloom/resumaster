import type { NextRequest } from "next/server";
import { route } from "@/lib/http";
import { listDocs } from "@/lib/google/drive";
export const dynamic = "force-dynamic";
export const GET = route(async (req: NextRequest) => ({ files: await listDocs(req.nextUrl.searchParams.get("q") ?? undefined) }));
