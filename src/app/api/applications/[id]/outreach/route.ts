import { route, type Ctx } from "@/lib/http";
import { generateOutreach } from "@/lib/services";
import { RECIPIENT_GUIDE, type RecipientType } from "@/lib/ai/tasks";

export const maxDuration = 300;
export const POST = route(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const b = (await req.json()) as { recipientType: RecipientType; recipientContext?: string };
  if (!(b.recipientType in RECIPIENT_GUIDE)) throw new Error("Invalid recipient type");
  return { id: await generateOutreach(Number((await params).id), b.recipientType, b.recipientContext?.trim() || null) };
});
