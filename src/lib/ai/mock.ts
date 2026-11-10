/**
 * Mock model for UI work and demos without spending credits (RESUMASTER_MOCK_AI=1).
 * Returns the fictional precomputed fixtures, adapted to whatever bullet ids exist.
 */
import * as P from "../demo/precomputed";

export async function mockRunner({ task, user }: { task: string; user: string }): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 300));
  const ids = Array.from(user.matchAll(/\[(p\d+)\|BULLET\]/g)).map((m) => m[1]);
  switch (task) {
    case "jd_analysis": return P.PRECOMPUTED_JDA;
    case "fit_analysis": return P.PRECOMPUTED_FIT;
    case "edit_plan":
      return {
        ...P.PRECOMPUTED_PLAN,
        // keep only refine/remove edits whose ids exist in this resume
        edits: P.PRECOMPUTED_PLAN.edits.filter((e) => e.action !== "reposition").map((e, i) => ({ ...e, bullet_id: ids[i * 2] ?? e.bullet_id, accomplishment_refs: [] })).filter((e) => ids.includes(e.bullet_id)),
      };
    case "edit_challenge": return { stance: "maintain", response: "[mock] The proposed version leads with the result the role cares about.", revised_text: null };
    case "outreach": return { candidates: [{ message: P.PRECOMPUTED_OUTREACH.message, angle: "metrics", specificity: 4, credibility: 4, relevance: 4 }] };
    case "feedback_classify": return { classification: "role_specific", reusable_rule: null, rule_category: "style", applies_to: "resume", confidence: "medium", fact_correction: null, response: "[mock] Noted for this role." };
    case "master_outline": return { roles: [], headings: [] };
    case "resume_extract": return { roles: [], accomplishments: [], skills: [], tools: [], industries: [], education: [], certifications: [] };
    case "bank_reconcile": return { matches: [] };
    case "company_research": return "- [INFERRED] Mock research notes.";
    default:
      if (task.startsWith("answer_")) return { answer: task.includes("why") ? P.PRECOMPUTED_ANSWERS.why_company : P.PRECOMPUTED_ANSWERS.fit, reasons_used: [], assumptions: ["[mock answer]"], needs_input_question: null };
      throw new Error(`mock: unknown task ${task}`);
  }
}
