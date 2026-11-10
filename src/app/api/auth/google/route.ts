import crypto from "crypto";
import { NextResponse } from "next/server";
import { authUrl } from "@/lib/google/auth";
import { setSetting } from "@/lib/db";
import { fail } from "@/lib/http";

export async function GET() {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    setSetting("oauth_state", state);
    return NextResponse.redirect(authUrl(state));
  } catch (e) {
    return fail(e);
  }
}
