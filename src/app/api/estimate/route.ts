import type { NextRequest } from "next/server";
import { route } from "@/lib/http";
import { estimateOp } from "@/lib/services";
import { monthSpend, perAppLimit, spendLimit } from "@/lib/ai/client";
import { getSetting } from "@/lib/db";

export const dynamic = "force-dynamic";
/** Free: estimates the cost of an operation from real history (or defaults) before it runs. */
export const GET = route(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const appId = sp.get("appId") ? Number(sp.get("appId")) : undefined;
  const e = estimateOp(sp.get("op") ?? "", { appId, docs: sp.get("docs") ? Number(sp.get("docs")) : undefined });
  const month = monthSpend();
  return {
    ...e,
    warnAbove: getSetting<number>("warn_threshold_usd") ?? 0.1,
    monthSpent: month,
    monthLimit: spendLimit(),
    perAppLimit: perAppLimit(),
    wouldExceed: month + e.usd > spendLimit() || (e.appSpent != null && e.appSpent + e.usd > perAppLimit()),
  };
});
