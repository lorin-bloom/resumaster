import type { NextRequest } from "next/server";
import { route } from "@/lib/http";
import { aiConfigured } from "@/lib/ai/client";
import { precomputedResult, runLiveDemo } from "@/lib/demo/run";
import { DEMO_BANK, DEMO_PREFERENCES, DEMO_RESUME, SAMPLE_JD } from "@/lib/demo/fixtures";
import { RECIPIENT_GUIDE, type RecipientType } from "@/lib/ai/tasks";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Public deployments: live AI only when explicitly enabled (DEMO_LIVE=1). Private/local: allowed. */
const liveAllowed = () => aiConfigured() && (process.env.RESUMASTER_PUBLIC_DEMO === "1" ? process.env.DEMO_LIVE === "1" : process.env.DEMO_LIVE !== "0");

// Simple in-memory rate limit for the public demo: N live runs per IP per hour.
const hits = new Map<string, number[]>();
const PER_HOUR = Number(process.env.DEMO_RUNS_PER_HOUR ?? 3);

export const GET = route(async () => ({
  liveAvailable: liveAllowed(),
  sampleJD: SAMPLE_JD,
  resume: DEMO_RESUME.paragraphs.map((p) => ({ id: p.id, text: p.text, isBullet: p.isBullet, heading: p.namedStyle.startsWith("HEADING") || p.allBold })),
  bank: DEMO_BANK,
  preferences: DEMO_PREFERENCES,
  example: precomputedResult(),
}));

export const POST = route(async (req: NextRequest) => {
  if (!liveAllowed()) throw Object.assign(new Error("Live AI is turned off on this deployment, so only the precomputed example is available."), { response: { status: 503 } });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_HOUR) throw Object.assign(new Error(`Demo limit: ${PER_HOUR} live runs per hour.`), { response: { status: 429 } });
  const { jd, recipientType } = (await req.json()) as { jd: string; recipientType?: RecipientType };
  if (!jd || jd.length < 200) throw Object.assign(new Error("Paste a complete job description."), { response: { status: 400 } });
  if (jd.length > 20000) throw Object.assign(new Error("Job description is too long for the demo."), { response: { status: 400 } });
  recent.push(now);
  hits.set(ip, recent);
  return runLiveDemo(jd, recipientType && recipientType in RECIPIENT_GUIDE ? recipientType : "recruiter");
});
