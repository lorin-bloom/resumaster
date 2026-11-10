import { NextResponse, type NextRequest } from "next/server";
import { handleCallback } from "@/lib/google/auth";
import { deleteSetting, getSetting } from "@/lib/db";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = getSetting<string>("oauth_state");
  const back = new URL("/setup", req.nextUrl.origin);
  if (!code || !state || state !== expected) {
    back.searchParams.set("error", req.nextUrl.searchParams.get("error") ?? "OAuth state mismatch");
    return NextResponse.redirect(back);
  }
  deleteSetting("oauth_state");
  try {
    await handleCallback(code);
  } catch (e) {
    back.searchParams.set("error", (e as Error).message);
  }
  return NextResponse.redirect(back);
}
