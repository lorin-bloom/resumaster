import { route } from "@/lib/http";
import { heuristicClassify, learnFromNote } from "@/lib/services";
import { prefs } from "@/lib/memory";

/**
 * Free-form instruction ("never use filler words"). Clearly general rules are saved directly
 * with no AI call. Ambiguous ones go to the low-cost model, since the user explicitly asked.
 */
export const POST = route(async (req: Request) => {
  const { text } = await req.json();
  if (!text?.trim()) throw new Error("Text required");
  const t: string = text.trim();
  if (heuristicClassify(t) === "global_preference") {
    const rule = t.replace(/^./, (c) => c.toUpperCase()).replace(/([^.!?])$/, "$1.");
    const p = prefs.add(rule, "style", "all", "explicit");
    return { learned: { classification: "global_preference", response: "Saved.", savedRule: { id: p.id, rule: p.rule } } };
  }
  return learnFromNote(null, { action: "general instruction", note: t, target: "general" });
});
