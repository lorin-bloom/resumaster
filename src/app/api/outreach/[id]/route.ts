import { route, type Ctx } from "@/lib/http";
import { saveOutreach } from "@/lib/services";

/** Save a hand-edited LinkedIn message. No AI; 300-char limit enforced here. */
export const PATCH = route(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { message } = await req.json();
  return saveOutreach(Number((await params).id), String(message ?? ""));
});
