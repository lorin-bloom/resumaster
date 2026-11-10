import { route } from "@/lib/http";
import { feedback } from "@/lib/memory";
import { interpretPendingNotes, pendingNotesCount } from "@/lib/services";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const GET = route(async () => ({ feedback: feedback.list(), pendingNotes: pendingNotesCount() }));
export const POST = route(async (req: Request) => {
  const b = await req.json();
  if (b.action === "delete") return feedback.remove(Number(b.id));
  if (b.action === "interpret") return interpretPendingNotes(); // explicit, paid (cheap model)
  throw new Error("Unknown action");
});
