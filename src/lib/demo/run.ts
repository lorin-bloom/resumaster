import * as T from "../ai/tasks";
import { bankForPrompt, retrieve } from "../knowledge";
import { bullets, structureToAnnotated } from "../google/structure";
import { simulate, type ApprovedEdit } from "../google/apply-edits";
import { charCount } from "../limits";
import { DEMO_BANK, DEMO_DIRECTION, DEMO_PREFERENCES, DEMO_RESUME } from "./fixtures";
import * as P from "./precomputed";
import type { EditPlan } from "../ai/schemas";

/** Career context built ONLY from fictional fixtures. Never touches private tables. */
export function demoContext(query: string[]): T.CareerContext {
  const roleOf: Record<string, number> = {};
  let role = -1;
  for (const p of DEMO_RESUME.paragraphs) {
    if (!p.isBullet && /—/.test(p.text) && p.allBold) role++;
    if (p.isBullet) roleOf[p.id] = role;
  }
  const bankStatus: T.CareerContext["bankStatus"] = {};
  for (const a of DEMO_BANK) bankStatus[`A${a.id}`] = a.status;
  const prefs = DEMO_PREFERENCES.map((r, i) => `- [P${i + 1}] ${r}`).join("\n");
  return {
    resumeAnnotated: structureToAnnotated(DEMO_RESUME),
    bulletIds: bullets(DEMO_RESUME).map((b) => b.id),
    bulletRole: roleOf,
    bankText: bankForPrompt(retrieve(DEMO_BANK, query, 40)),
    bankStatus,
    preferences: { resume: prefs, answers: prefs, outreach: prefs },
    feedback: { resume: "", answers: "", outreach: "" },
    careerDirection: DEMO_DIRECTION,
  };
}

export function previewFromPlan(plan: EditPlan) {
  const approved: ApprovedEdit[] = plan.edits.map((e) => {
    const original = DEMO_RESUME.paragraphs.find((p) => p.id === e.bullet_id)!.text;
    if (e.action === "remove") return { kind: "remove", bulletId: e.bullet_id, originalText: original };
    if (e.action === "reposition" && e.move_before_bullet_id) return { kind: "move", bulletId: e.bullet_id, originalText: original, newText: e.proposed_text ?? original, beforeBulletId: e.move_before_bullet_id };
    return { kind: "replace_text", bulletId: e.bullet_id, originalText: original, newText: e.proposed_text ?? original };
  });
  return simulate(DEMO_RESUME, approved);
}

export function precomputedResult() {
  return {
    source: "precomputed" as const,
    analysis: P.PRECOMPUTED_JDA,
    fit: P.PRECOMPUTED_FIT,
    plan: P.PRECOMPUTED_PLAN,
    answers: [
      { kind: "fit", question: "Why are you a good fit for this role?", answer: P.PRECOMPUTED_ANSWERS.fit, assumptions: [] },
      { kind: "why_company", question: "Why do you want to work at Northwind Labs?", answer: P.PRECOMPUTED_ANSWERS.why_company, assumptions: P.PRECOMPUTED_ANSWERS.why_company_assumptions },
    ],
    outreach: { recipientType: P.PRECOMPUTED_OUTREACH.recipientType, message: P.PRECOMPUTED_OUTREACH.message, chars: charCount(P.PRECOMPUTED_OUTREACH.message), alternatives: [] },
    preview: previewFromPlan(P.PRECOMPUTED_PLAN),
  };
}

export async function runLiveDemo(jd: string, recipientType: T.RecipientType = "recruiter") {
  const jda = await T.analyzeJD(jd);
  const ctx = demoContext([...jda.keywords.map((k) => k.term), ...jda.hiring_priorities.map((p) => p.priority)]);
  const fit = await T.analyzeFit(jd, jda, ctx);
  const [plan, a1, a2, out] = await Promise.all([
    T.planEdits(jd, jda, fit, ctx),
    T.writeAnswer({ kind: "fit", question: "Why are you a good fit for this role?", jd, jda, fit, ctx }),
    T.writeAnswer({ kind: "why_company", question: `Why do you want to work at ${jda.company}?`, jd, jda, fit, ctx }),
    T.writeOutreach({ recipientType, jd, jda, fit, ctx }),
  ]);
  return {
    source: "live" as const,
    analysis: jda,
    fit,
    plan,
    answers: [
      { kind: "fit", question: "Why are you a good fit for this role?", answer: a1.answer, assumptions: a1.assumptions },
      { kind: "why_company", question: `Why do you want to work at ${jda.company}?`, answer: a2.answer, assumptions: a2.assumptions, needsInput: a2.needs_input_question },
    ],
    outreach: { recipientType, message: out.best.message, chars: out.best.chars, alternatives: out.alternatives.map((a) => ({ message: a.message, chars: a.chars })) },
    preview: previewFromPlan(plan),
  };
}
