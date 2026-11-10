import { route, type Ctx } from "@/lib/http";
import { challenge, decideEdit } from "@/lib/services";

export const maxDuration = 120;
/** PATCH: accept / reject / edit (+ optional note that may become a saved preference). */
export const PATCH = route(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const b = await req.json();
  return decideEdit(Number((await params).id), b.decision, b.finalText, b.note);
});
/** POST: question or challenge a recommendation; the editor answers with independent judgment. */
export const POST = route(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { message } = await req.json();
  if (!message?.trim()) throw new Error("Message required");
  return challenge(Number((await params).id), message);
});
