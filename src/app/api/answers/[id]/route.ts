import { route, type Ctx } from "@/lib/http";
import { getDb } from "@/lib/db";
import { feedback } from "@/lib/memory";
import { noteToMemory } from "@/lib/services";

/** Save a user-edited answer (no AI). The diff becomes editorial feedback for future answers. */
export const PATCH = route(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const id = Number((await params).id);
  const { answer, note } = (await req.json()) as { answer: string; note?: string };
  const db = getDb();
  const cur = db.prepare("SELECT a.*, ap.company, ap.job_title FROM answers a JOIN applications ap ON ap.id=a.application_id WHERE a.id=?").get(id) as {
    application_id: number; answer: string; company: string; job_title: string;
  };
  if (!cur) throw new Error("Answer not found");
  db.prepare("UPDATE answers SET answer=?, saved=1, updated_at=datetime('now') WHERE id=?").run(answer, id);
  if (answer.trim() === cur.answer.trim() && !note) return { learned: null };
  const fbId = feedback.add({ application_id: cur.application_id, edit_id: null, target: "answer", action: answer.trim() === cur.answer.trim() ? "accepted" : "edited", original_text: null, proposed_text: cur.answer, final_text: answer, user_note: note ?? null, classification: null, ai_response: null });
  return { learned: noteToMemory(fbId, note) }; // no AI call on save
});
export const DELETE = route(async (_: Request, { params }: Ctx<{ id: string }>) => {
  getDb().prepare("DELETE FROM answers WHERE id=?").run(Number((await params).id));
});
