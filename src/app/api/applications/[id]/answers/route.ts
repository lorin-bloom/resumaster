import { route, type Ctx } from "@/lib/http";
import { answerCustom } from "@/lib/services";

export const maxDuration = 300;
export const POST = route(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const b = (await req.json()) as { question: string; limitType?: "words" | "chars" | null; limitValue?: number | null; userInput?: string; answerId?: number };
  if (!b.question?.trim()) throw new Error("Question required");
  const id = await answerCustom(Number((await params).id), b.question.trim(), b.limitType ?? null, b.limitValue ? Number(b.limitValue) : null, b.userInput, b.answerId);
  return { id };
});
