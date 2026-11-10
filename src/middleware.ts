import { NextResponse, type NextRequest } from "next/server";

/**
 * Public portfolio deployments set RESUMASTER_PUBLIC_DEMO=1. In that mode every private
 * page and API is unreachable — only the demo (fictional data) is served.
 */
export function middleware(req: NextRequest) {
  if (process.env.RESUMASTER_PUBLIC_DEMO !== "1") return NextResponse.next();
  const p = req.nextUrl.pathname;
  if (p === "/demo" || p.startsWith("/demo/") || p === "/api/demo") return NextResponse.next();
  if (p.startsWith("/api/")) return NextResponse.json({ error: "Not available in the public demo" }, { status: 404 });
  return NextResponse.redirect(new URL("/demo", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
