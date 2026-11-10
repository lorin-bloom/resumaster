import { route, type Ctx } from "@/lib/http";
import { runAnalysis } from "@/lib/services";

export const maxDuration = 600;
export const POST = route(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const body = await req.json().catch(() => ({}));
  return runAnalysis(Number((await params).id), body.sections);
});
