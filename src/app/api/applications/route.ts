import { route } from "@/lib/http";
import { createApplication, listApplications } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = route(async () => ({ applications: listApplications() }));
export const POST = route(async (req: Request) => {
  const { jd, force } = (await req.json()) as { jd: string; force?: boolean };
  if (!jd || jd.trim().length < 200) throw Object.assign(new Error("Paste the complete job description (it looks too short)."), { response: { status: 400 } });
  return createApplication(jd.trim(), { force });
});
