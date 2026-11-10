import { callStructured, callText } from "./client";
import { CLASSIFIER, EDITOR, EXTRACTOR, STRATEGIST, WRITER } from "./prompts";
import * as S from "./schemas";
import {
  AI_CLICHES, BANNED_OUTREACH, LINKEDIN_MAX, bannedHits, charCount, cleanMessage, enforceLinkedIn, trimToChars, trimToWords, wordCount, withinLimit,
} from "../limits";

/** Everything the model may know about the candidate. Built from the DB (private) or fixtures (demo). */
export interface CareerContext {
  resumeAnnotated: string;          // master resume with [pN|BULLET] ids
  bulletIds: string[];
  bulletRole: Record<string, number>; // bullet id -> role index (for reposition validation)
  bankText: string;                 // retrieved accomplishments
  bankStatus: Record<string, "unverified" | "verified" | "disputed">; // "A7" -> status
  preferences: { resume: string; answers: string; outreach: string };
  feedback: { resume: string; answers: string; outreach: string };
  careerDirection: string;
}

/**
 * Context is assembled per task so each call carries only what it needs:
 *  - "fit": resume + retrieved evidence (no editorial history - it doesn't change positioning)
 *  - "resume": + resume writing rules + relevant past editorial decisions
 *  - "answers": + answer rules, answer feedback, career direction
 */
function contextBlock(ctx: CareerContext, target: "fit" | "resume" | "answers") {
  if (target === "fit")
    return `<master_resume>
${ctx.resumeAnnotated}
</master_resume>

<accomplishment_bank>
${ctx.bankText}
</accomplishment_bank>`;
  return `<master_resume>
${ctx.resumeAnnotated}
</master_resume>

<accomplishment_bank>
${ctx.bankText}
</accomplishment_bank>

${target === "answers" ? `<candidate_direction>
${ctx.careerDirection || "Not provided."}
</candidate_direction>
` : ""}
<writing_preferences>
These are the candidate's saved rules. Apply them automatically.
${ctx.preferences[target]}
</writing_preferences>

<past_editorial_feedback>
${ctx.feedback[target] || "None yet."}
</past_editorial_feedback>`;
}

/** Resolve evidence refs (pN bullets, An bank items) to their verified text — the only facts outreach needs. */
export function resolveEvidence(ctx: CareerContext, refs: string[]): string[] {
  const out: string[] = [];
  for (const ref of refs) {
    const r = ref.trim();
    if (/^p\d+$/i.test(r)) {
      const m = ctx.resumeAnnotated.match(new RegExp(`\\[${r}\\|[A-Z]+\\] (.+)`));
      if (m) out.push(m[1]);
    } else if (/^A\d+$/i.test(r)) {
      const m = ctx.bankText.match(new RegExp(`\\[${r.toUpperCase()}\\] \\((VERIFIED|UNVERIFIED)\\)[^\\n]*\\n\\s+What happened: (.+)`));
      if (m) out.push(m[2]);
    }
  }
  return out;
}

export async function analyzeJD(jd: string) {
  return callStructured({
    task: "jd_analysis",
    system: STRATEGIST,
    user: `Analyze this job description the way an experienced recruiter and the hiring manager would before reading any resume. Identify what they actually care about, not just what is listed.

<job_description>
${jd}
</job_description>`,
    schema: S.JDAnalysis,
    schemaName: "JDAnalysis",
  });
}

export async function analyzeFit(jd: string, jda: S.JDAnalysis, ctx: CareerContext) {
  return callStructured({
    task: "fit_analysis",
    system: STRATEGIST,
    context: contextBlock(ctx, "fit"),
    user: `<job_description>
${jd}
</job_description>

<role_analysis>
${JSON.stringify(jda)}
</role_analysis>

Compare this role against the candidate's ENTIRE verified history (master resume + accomplishment bank). Build the requirement-to-evidence map for the hiring priorities and required qualifications (cite bullet ids like p12 or bank ids like A7). Identify the most persuasive accomplishments, honest gaps, and the positioning that gives this candidate the best truthful shot. Evaluate as the recruiter (is it obvious in 30 seconds?) and as the hiring manager (would this person succeed?).`,
    schema: S.FitAnalysis,
    schemaName: "FitAnalysis",
  });
}

export async function planEdits(jd: string, jda: S.JDAnalysis, fit: S.FitAnalysis, ctx: CareerContext) {
  const plan = await callStructured({
    task: "edit_plan",
    system: EDITOR,
    context: contextBlock(ctx, "resume"),
    user: `<job_description>
${jd}
</job_description>

<role_analysis>
${JSON.stringify({ priorities: jda.hiring_priorities, keywords: jda.keywords, seniority: jda.seniority })}
</role_analysis>

<fit_analysis>
${JSON.stringify({ positioning: fit.positioning, requirement_map: fit.requirement_map, emphasize: fit.accomplishments_to_emphasize, terms_supported: fit.jd_terms_supported, terms_unsupported: fit.jd_terms_unsupported })}
</fit_analysis>

Review every BULLET in the master resume for this role. Return only the bullets that should change (refine / reposition / replace / remove). Everything you do not list is kept unchanged. If the resume is already strong for this role, return few or no edits and say so.`,
    schema: S.EditPlan,
    schemaName: "EditPlan",
  });
  return sanitizeEdits(plan, ctx);
}

/** Programmatic guardrails on model output: never trust ids, positions, or verification flags. */
export function sanitizeEdits(plan: S.EditPlan, ctx: CareerContext): S.EditPlan & { dropped: string[] } {
  const ids = new Set(ctx.bulletIds);
  const seen = new Set<string>();
  const dropped: string[] = [];
  const edits = plan.edits.filter((e) => {
    if (!ids.has(e.bullet_id)) return dropped.push(`${e.bullet_id}: unknown bullet id`), false;
    if (seen.has(e.bullet_id)) return dropped.push(`${e.bullet_id}: duplicate`), false;
    if (e.action !== "remove" && !e.proposed_text?.trim()) return dropped.push(`${e.bullet_id}: missing text`), false;
    if (e.action === "reposition") {
      const t = e.move_before_bullet_id;
      if (!t || !ids.has(t) || t === e.bullet_id || ctx.bulletRole[t] !== ctx.bulletRole[e.bullet_id])
        return dropped.push(`${e.bullet_id}: invalid reposition target`), false;
    }
    seen.add(e.bullet_id);
    return true;
  });
  for (const e of edits) {
    if (e.proposed_text) e.proposed_text = e.proposed_text.replace(/\s*\n+\s*/g, " ").replace(/^[•\-–*]\s*/, "").trim();
    // Disputed facts may never be used; unverified must be flagged regardless of what the model claims.
    const statuses = e.accomplishment_refs.map((r) => ctx.bankStatus[r.toUpperCase()]);
    if (statuses.includes("unverified")) e.uses_unverified = true;
  }
  const safe = edits.filter((e) => {
    const disputed = e.accomplishment_refs.some((r) => ctx.bankStatus[r.toUpperCase()] === "disputed");
    if (disputed) dropped.push(`${e.bullet_id}: used a disputed accomplishment`);
    return !disputed;
  });
  return { ...plan, edits: safe, dropped };
}

const ANSWER_DEFAULT_WORDS: [number, number] = [100, 150];

export async function writeAnswer(opts: {
  kind: "fit" | "why_company" | "custom";
  question: string;
  limitType?: "words" | "chars" | null;
  limitValue?: number | null;
  jd: string;
  jda: S.JDAnalysis;
  fit: S.FitAnalysis;
  ctx: CareerContext;
  companyNotes?: string | null;
  userInput?: string | null;
  cache?: boolean;
}) {
  const lengthRule =
    opts.limitType && opts.limitValue
      ? `Hard limit: ${opts.limitValue} ${opts.limitType === "chars" ? "characters including spaces" : "words"}. Aim for 85-95% of it.`
      : `Length: ${ANSWER_DEFAULT_WORDS[0]}–${ANSWER_DEFAULT_WORDS[1]} words.`;
  const kindGuide = {
    fit: "Answer 'Why are you a good fit for this role?' Emphasize the strongest two or three reasons, tied to verified accomplishments and the role's top priorities. State the value the candidate would bring. Do not summarize the resume.",
    why_company:
      "Answer 'Why do you want to work at this company?' Connect the company's product, mission, market, stage, and the specific role to the candidate's stated direction and experience. Use only facts present in the company notes or the JD; anything inferred must be listed in assumptions. Never invent personal enthusiasm, product usage, or connections. If the candidate's direction is missing and you cannot write a genuine answer without inventing motivation, still draft the best honest answer, and set needs_input_question to ONE focused question.",
    custom: "Answer the application question below using the candidate's verified history, the JD, and the company context.",
  }[opts.kind];

  const user = `<job_description>
${opts.jd}
</job_description>

<role_analysis>
${JSON.stringify({ company: opts.jda.company, title: opts.jda.job_title, context: opts.jda.business_context, priorities: opts.jda.hiring_priorities, problems: opts.jda.business_problems })}
</role_analysis>

<fit_summary>
${JSON.stringify({ positioning: opts.fit.positioning, strengths: opts.fit.strengths, emphasize: opts.fit.accomplishments_to_emphasize })}
</fit_summary>

<company_notes>
${opts.companyNotes || "No external research. Use only what the JD states about the company."}
</company_notes>
${opts.userInput ? `\n<candidate_input>\n${opts.userInput}\n</candidate_input>\n` : ""}
${kindGuide}

Question: ${opts.question}
${lengthRule}`;

  let res = await callStructured({ task: `answer_${opts.kind}`, system: WRITER, context: contextBlock(opts.ctx, "answers"), user, schema: S.Answer, schemaName: "Answer", cache: opts.cache });

  // Programmatic length enforcement: one corrective retry, then sentence-boundary trim.
  const lt = opts.limitType ?? "words";
  const lv = opts.limitValue ?? ANSWER_DEFAULT_WORDS[1] + 10;
  if (!withinLimit(res.answer, lt, lv)) {
    const n = lt === "chars" ? charCount(res.answer) : wordCount(res.answer);
    res = await callStructured({
      task: `answer_${opts.kind}_shorten`,
      system: WRITER,
      context: contextBlock(opts.ctx, "answers"),
      user: `${user}\n\nYour previous draft was ${n} ${lt}, over the ${lv} ${lt} limit. Rewrite it within the limit, keeping the strongest points:\n${res.answer}`,
      schema: S.Answer,
      schemaName: "Answer",
      cache: false,
    });
    if (!withinLimit(res.answer, lt, lv)) res.answer = lt === "chars" ? trimToChars(res.answer, lv) : trimToWords(res.answer, lv);
  }
  return { ...res, cliches: bannedHits(res.answer, AI_CLICHES) };
}

export const RECIPIENT_GUIDE = {
  recruiter: "Recipient is a RECRUITER. Focus on the specific role applied for and the one or two qualifications that map most directly to the requirements, so they can route the application.",
  hiring_manager: "Recipient is the HIRING MANAGER. Lead with a relevant accomplishment and the business problem the candidate can help solve. Peer-to-peer tone.",
  team_member: "Recipient is a TEAM MEMBER. Establish a credible, specific connection to their work and a natural reason to connect. Do not ask for a referral outright.",
  senior_leader: "Recipient is a SENIOR LEADER. Strategic relevance in one line, concise credibility, no ask beyond connecting.",
} as const;
export type RecipientType = keyof typeof RECIPIENT_GUIDE;

export async function writeOutreach(opts: {
  recipientType: RecipientType;
  recipientContext?: string | null;
  jd: string;
  jda: S.JDAnalysis;
  fit: S.FitAnalysis;
  ctx: CareerContext;
  cache?: boolean;
}) {
  const user = `<role>
${opts.jda.company} — ${opts.jda.job_title}. Priorities: ${opts.jda.hiring_priorities.map((p) => p.priority).join("; ")}
</role>

<positioning>
${opts.fit.positioning}
</positioning>

<verified_evidence>
${resolveEvidence(opts.ctx, opts.fit.accomplishments_to_emphasize.map((a) => a.ref)).map((t) => `- ${t}`).join("\n") || opts.fit.strengths.map((t) => `- ${t}`).join("\n")}
</verified_evidence>

<writing_rules>
${opts.ctx.preferences.outreach}
</writing_rules>

<recipient_context>
${opts.recipientContext?.trim() || "None provided. Do not invent a name or any familiarity."}
</recipient_context>

Write LinkedIn connection-request notes. ${RECIPIENT_GUIDE[opts.recipientType]}
Requirements:
- HARD MAXIMUM ${LINKEDIN_MAX} characters including spaces. Target 220–280.
- Mention the role applied for. Establish relevance immediately. One or two concrete qualifications taken ONLY from verified_evidence (prefer a number).
- A concise, natural reason to connect.
- Use recipient context only if it genuinely improves the note; never imply you know them.
- Avoid: "passionate about your mission", "pick your brain", "great fit", "excited to leverage", "hope this finds you well", generic templates.
- If a name is given, use the first name only, with "Hi <name>," — otherwise start directly.
Produce 3 candidates with different angles, and score each honestly (1–5) for specificity, credibility, and relevance.`;

  const res = await callStructured({ task: "outreach", system: WRITER, user, schema: S.Outreach, schemaName: "Outreach", cache: opts.cache });

  const evaluated = res.candidates.map((c) => {
    const cleaned = cleanMessage(c.message);
    const over = charCount(cleaned) > LINKEDIN_MAX;
    const message = enforceLinkedIn(cleaned);
    const banned = bannedHits(message, BANNED_OUTREACH);
    const score = c.specificity + c.credibility + c.relevance - banned.length * 5 - (over ? 2 : 0);
    return { ...c, message, chars: charCount(message), wasTrimmed: over, banned, score };
  });
  evaluated.sort((a, b) => b.score - a.score);
  const best = evaluated[0];
  if (!best) throw new Error("No outreach candidates returned.");
  return { best, alternatives: evaluated.slice(1) };
}

export async function classifyFeedback(opts: { action: string; original?: string | null; proposed?: string | null; final?: string | null; note: string; company?: string | null; title?: string | null }) {
  return callStructured({
    task: "feedback_classify",
    system: CLASSIFIER,
    user: `Application: ${opts.company ?? "?"} — ${opts.title ?? "?"}
User action: ${opts.action}
${opts.original ? `Original text: "${opts.original}"\n` : ""}${opts.proposed ? `AI proposal: "${opts.proposed}"\n` : ""}${opts.final ? `User's final text: "${opts.final}"\n` : ""}User said: "${opts.note}"`,
    schema: S.FeedbackClass,
    schemaName: "FeedbackClass",
    cache: false,
  });
}

export async function challengeEdit(opts: { original: string; proposed: string | null; rationale: string; userMessage: string; jda: S.JDAnalysis; ctx: CareerContext }) {
  return callStructured({
    task: "edit_challenge",
    system: EDITOR,
    context: contextBlock(opts.ctx, "resume"),
    user: `Role: ${opts.jda.company} — ${opts.jda.job_title}. Priorities: ${opts.jda.hiring_priorities.map((p) => p.priority).join("; ")}

You proposed an edit:
Original: "${opts.original}"
Proposed: "${opts.proposed ?? "(remove bullet)"}"
Your rationale: ${opts.rationale}

The candidate responded: "${opts.userMessage}"

Use independent judgment. If their point is right, revise or withdraw. If your recommendation is stronger, maintain it and explain why in one or two sentences. If they suggest alternate wording, judge whether it is better, equivalent (stylistic), or weaker — and say which. Do not simply agree.`,
    schema: S.Challenge,
    schemaName: "Challenge",
    cache: false,
  });
}

export async function outlineMaster(annotated: string) {
  return callStructured({
    task: "master_outline",
    system: EXTRACTOR,
    user: `Identify the section headings and each role (employer, title, dates exactly as written) in this resume, and which BULLET ids belong to each role. Ids appear as [pN|TYPE].\n\n${annotated}`,
    schema: S.MasterOutline,
    schemaName: "MasterOutline",
  });
}

export async function extractResume(text: string) {
  return callStructured({
    task: "resume_extract",
    system: EXTRACTOR,
    user: `Extract every role and every accomplishment bullet from this resume.\n\n<resume>\n${text}\n</resume>`,
    schema: S.ResumeExtract,
    schemaName: "ResumeExtract",
    maxTokens: 16000,
  });
}

export async function reconcile(newItems: { employer: string; canonical: string; metrics: { value: string; context: string }[]; verbatim: string }[], existing: { id: number; employer: string; canonical: string; metrics: string }[]) {
  if (!existing.length) return { matches: newItems.map((_, i) => ({ new_index: i, existing_id: null, discrepancy: null })) };
  return callStructured({
    task: "bank_reconcile",
    system: `${EXTRACTOR}\nYou match newly extracted accomplishments to an existing accomplishment bank. Two items match only if they describe the SAME real-world achievement (same employer, same project/result), even if framed differently. When they match but disagree on a metric, ownership ("led" vs "supported"), or scope, report a discrepancy. Never decide which version is true.`,
    user: `<existing_bank>\n${existing.map((e) => `[${e.id}] ${e.employer}: ${e.canonical} | metrics: ${e.metrics}`).join("\n")}\n</existing_bank>\n\n<new_items>\n${newItems
      .map((n, i) => `(${i}) ${n.employer}: ${n.canonical} | metrics: ${n.metrics.map((m) => `${m.value} ${m.context}`).join("; ")} | wording: "${n.verbatim}"`)
      .join("\n")}\n</new_items>\n\nReturn one entry per new item.`,
    schema: S.Reconcile,
    schemaName: "Reconcile",
  });
}

export async function researchCompany(company: string, jd: string): Promise<string> {
  return callText({
    task: "company_research",
    system: "You research companies for a job applicant. Use web search. Report only facts from reliable sources (company site, reputable press). Be concise.",
    user: `Company: ${company}\nRole context (JD excerpt): ${jd.slice(0, 1500)}\n\nReturn 6-10 terse bullet points covering: product(s), mission, market, stage/funding/scale, recent notable news (last 12 months), and what this team likely works on. Mark each bullet [VERIFIED: source domain] or [INFERRED]. Nothing else.`,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }],
  });
}
