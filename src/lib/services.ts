import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb, getSetting, j, setSetting } from "./db";
import { bank, bankForPrompt, retrieve } from "./knowledge";
import { feedback, prefs, preferencesBlock } from "./memory";
import * as T from "./ai/tasks";
import { appSpend, estimate, withApp } from "./ai/client";
import type * as S from "./ai/schemas";
import { bullets, looksLikeHeading, structureToAnnotated, structureToText, type ResumeStructure } from "./google/structure";
import type { ApprovedEdit } from "./google/apply-edits";
import { createTailoredDoc, exportPdf, readStructure } from "./google/drive";
import { extractPdf, validatePdf } from "./pdf/validate";

// ---------- types ----------
export interface SourceDoc {
  id: number;
  google_doc_id: string;
  title: string;
  kind: "master" | "previous";
  revision_id: string | null;
  text: string | null;
  structure_json: string | null;
  outline_json: string | null;
  imported_at: string | null;
}
export interface ApplicationRow {
  id: number;
  company: string | null;
  job_title: string | null;
  jd_text: string;
  jd_hash: string;
  analysis_json: string | null;
  fit_json: string | null;
  edits_meta_json: string | null;
  master_document_id: number | null;
  master_revision_id: string | null;
  revision: number;
  parent_id: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}
export interface EditRow {
  id: number;
  application_id: number;
  bullet_id: string;
  action: "refine" | "reposition" | "replace" | "remove";
  original_text: string;
  proposed_text: string | null;
  move_before_bullet_id: string | null;
  rationale: string;
  impact: string;
  substantive: number;
  jd_terms_json: string;
  accomplishment_ids_json: string;
  uses_unverified: number;
  decision: "pending" | "accepted" | "rejected" | "edited";
  final_text: string | null;
}

const db = () => getDb();

export class ConflictError extends Error {
  response = { status: 409 };
}
const running = new Set<string>();
/** Prevents the same paid operation from running twice at once (double-clicks, two tabs). */
async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (running.has(key)) throw new ConflictError("That operation is already running for this application.");
  running.add(key);
  try {
    return await fn();
  } finally {
    running.delete(key);
  }
}
export const hashJD = (jd: string) => crypto.createHash("sha256").update(jd.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");

// ---------- master resume ----------
export function getMaster(): SourceDoc | null {
  return (db().prepare("SELECT * FROM source_documents WHERE kind='master' ORDER BY id DESC LIMIT 1").get() as SourceDoc) ?? null;
}

export async function setMaster(googleDocId: string) {
  const s = await readStructure(googleDocId);
  const d = db();
  d.prepare("UPDATE source_documents SET kind='previous' WHERE kind='master' AND google_doc_id != ?").run(googleDocId);
  d.prepare(
    `INSERT INTO source_documents (google_doc_id, title, kind, revision_id, text, structure_json)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(google_doc_id) DO UPDATE SET kind='master', title=excluded.title, revision_id=excluded.revision_id, text=excluded.text, structure_json=excluded.structure_json, outline_json=NULL`,
  ).run(googleDocId, s.title, "master", s.revisionId, structureToText(s), JSON.stringify(s));
  const r = await refreshMaster(true);
  // the master is also evidence for the accomplishment bank
  const ingest = await ingestResumeText(structureToText(s), r.doc.id);
  return { ...r, ingest };
}

/** Re-read the master if its Google revision changed. Parsed structure + outline are cached per revision. */
export async function refreshMaster(force = false): Promise<{ doc: SourceDoc; structure: ResumeStructure; outline: S.MasterOutline }> {
  let m = getMaster();
  if (!m) throw new Error("No master resume selected. Choose one in Setup.");
  let structure = j.parse<ResumeStructure | null>(m.structure_json, null);
  try {
    const live = await readStructure(m.google_doc_id);
    if (force || !structure || live.revisionId !== m.revision_id) {
      structure = live;
      db().prepare("UPDATE source_documents SET revision_id=?, text=?, structure_json=?, outline_json=NULL, title=? WHERE id=?").run(live.revisionId, structureToText(live), JSON.stringify(live), live.title, m.id);
      m = getMaster()!;
    }
  } catch (e) {
    if (!structure) throw e; // offline: fall back to cached structure
  }
  let outline = j.parse<S.MasterOutline | null>(m.outline_json, null);
  if (!outline) {
    outline = await T.outlineMaster(structureToAnnotated(structure!));
    db().prepare("UPDATE source_documents SET outline_json=? WHERE id=?").run(JSON.stringify(outline), m.id);
    // the master's roles are career facts too
    for (const r of outline.roles) bank.upsertRole({ employer: r.employer, title: r.title, ...splitDates(r.dates) });
  }
  return { doc: m, structure: structure!, outline };
}

function splitDates(d: string): { start_date: string | null; end_date: string | null } {
  const parts = d.split(/\s*[–—-]\s*|\s+to\s+/i);
  return { start_date: parts[0]?.trim() || null, end_date: parts[1]?.trim() || null };
}

async function masterPageCount(m: SourceDoc): Promise<number | null> {
  const key = `master_pages:${m.google_doc_id}:${m.revision_id}`;
  const cached = getSetting<number>(key);
  if (cached) return cached;
  try {
    const { totalPages } = await extractPdf(await exportPdf(m.google_doc_id));
    setSetting(key, totalPages);
    return totalPages;
  } catch {
    return null;
  }
}

// ---------- career context ----------
export function buildContext(structure: ResumeStructure, outline: S.MasterOutline, query: string[], k = 25): T.CareerContext {
  const all = bank.list();
  const picked = retrieve(all, query, k); // only the most relevant evidence, never the whole library
  const bulletRole: Record<string, number> = {};
  outline.roles.forEach((r, i) => r.bullet_ids.forEach((b) => (bulletRole[b] = i)));
  // bullets the outline missed still need a role key: group by nearest preceding non-bullet line
  let group = 1000;
  for (const p of structure.paragraphs) {
    if (!p.isBullet) group++;
    else if (bulletRole[p.id] === undefined) bulletRole[p.id] = group;
  }
  const bankStatus: T.CareerContext["bankStatus"] = {};
  for (const a of all) bankStatus[`A${a.id}`] = a.status;
  return {
    resumeAnnotated: structureToAnnotated(structure),
    bulletIds: bullets(structure).map((b) => b.id),
    bulletRole,
    bankText: bankForPrompt(picked),
    bankStatus,
    preferences: { resume: preferencesBlock("resume"), answers: preferencesBlock("answers"), outreach: preferencesBlock("outreach") },
    feedback: { resume: feedback.digest("resume"), answers: feedback.digest("answer"), outreach: feedback.digest("outreach") },
    careerDirection: getSetting<string>("career_direction") ?? "",
  };
}

// ---------- applications ----------
export function getApplication(id: number) {
  const app = db().prepare("SELECT * FROM applications WHERE id=?").get(id) as ApplicationRow | undefined;
  if (!app) return null;
  const edits = db().prepare("SELECT * FROM edits WHERE application_id=? ORDER BY id").all(id) as EditRow[];
  const answers = db().prepare("SELECT * FROM answers WHERE application_id=? ORDER BY id").all(id);
  const outreach = db().prepare("SELECT * FROM outreach WHERE application_id=? ORDER BY id DESC").all(id);
  const docs = db().prepare("SELECT * FROM application_docs WHERE application_id=? ORDER BY revision DESC").all(id);
  const siblings = db()
    .prepare("SELECT id, revision, created_at, status FROM applications WHERE jd_hash=? OR (company=? AND job_title=?) ORDER BY revision")
    .all(app.jd_hash, app.company, app.job_title);
  const cost = db().prepare("SELECT COALESCE(SUM(cost_usd),0) cost, COUNT(*) calls, COALESCE(SUM(cached_hit),0) cached FROM ai_calls WHERE application_id=?").get(id);
  return {
    app,
    cost,
    research: getSetting<string>(`research:${id}`) ?? null,
    analysis: j.parse<S.JDAnalysis | null>(app.analysis_json, null),
    fit: j.parse<S.FitAnalysis | null>(app.fit_json, null),
    editsMeta: j.parse<{ verdict: string; summary: string; keep_count: number; dropped?: string[] } | null>(app.edits_meta_json, null),
    edits,
    answers,
    outreach,
    docs,
    siblings,
  };
}

export function listApplications() {
  return db()
    .prepare(
      `SELECT a.id, a.company, a.job_title, a.status, a.revision, a.created_at, a.updated_at,
        (SELECT COUNT(*) FROM edits e WHERE e.application_id=a.id) AS edit_count,
        (SELECT doc_url FROM application_docs d WHERE d.application_id=a.id ORDER BY revision DESC LIMIT 1) AS doc_url,
        json_extract(a.fit_json, '$.fit_level') AS fit_level,
        (SELECT COALESCE(SUM(cost_usd),0) FROM ai_calls c WHERE c.application_id=a.id) AS cost_usd
       FROM applications a ORDER BY a.id DESC`,
    )
    .all();
}

export function findExisting(jd: string, company?: string, title?: string) {
  return db()
    .prepare("SELECT id, company, job_title, revision, created_at FROM applications WHERE jd_hash=? OR (lower(company)=lower(?) AND lower(job_title)=lower(?)) ORDER BY revision DESC")
    .all(hashJD(jd), company ?? "", title ?? "") as { id: number; company: string; job_title: string; revision: number; created_at: string }[];
}

/** Step 1: create the application record and analyze the JD (cached by JD content). */
export async function createApplication(jd: string, opts: { force?: boolean } = {}) {
  const jda = await T.analyzeJD(jd);
  const existing = findExisting(jd, jda.company, jda.job_title);
  if (existing.length && !opts.force) return { duplicate: existing, analysis: jda };
  const revision = existing.length ? Math.max(...existing.map((e) => e.revision)) + 1 : 1;
  const info = db()
    .prepare("INSERT INTO applications (company, job_title, jd_text, jd_hash, analysis_json, revision, parent_id) VALUES (?,?,?,?,?,?,?)")
    .run(jda.company, jda.job_title, jd, hashJD(jd), JSON.stringify(jda), revision, existing[0]?.id ?? null);
  const newId = Number(info.lastInsertRowid);
  db().prepare("UPDATE ai_calls SET application_id=? WHERE id=(SELECT MAX(id) FROM ai_calls WHERE task='jd_analysis' AND application_id IS NULL)").run(newId);
  return { id: newId };
}

/** Steps 2–3 + answers + outreach. Each section can also be regenerated on its own. */
export async function runAnalysis(id: number, sections: ("fit" | "edits" | "answers" | "outreach")[] = ["fit", "edits", "answers", "outreach"]) {
  return exclusive(`analyze:${id}`, () => withApp(id, () => runAnalysisInner(id, sections)));
}

async function runAnalysisInner(id: number, sections: ("fit" | "edits" | "answers" | "outreach")[]) {
  const g = getApplication(id);
  if (!g?.analysis) throw new Error("Application not found");
  const { doc, structure, outline } = await refreshMaster();
  const jda = g.analysis;
  const query = [...jda.keywords.map((k) => k.term), ...jda.hiring_priorities.map((p) => p.priority), ...jda.required_qualifications];
  const ctx = buildContext(structure, outline, query);
  db().prepare("UPDATE applications SET master_document_id=?, master_revision_id=?, updated_at=datetime('now') WHERE id=?").run(doc.id, structure.revisionId, id);

  let fit = g.fit;
  if (sections.includes("fit") || !fit) {
    fit = await T.analyzeFit(g.app.jd_text, jda, ctx);
    db().prepare("UPDATE applications SET fit_json=? WHERE id=?").run(JSON.stringify(fit), id);
  }

  const jobs: Promise<unknown>[] = [];
  if (sections.includes("edits")) {
    jobs.push(
      T.planEdits(g.app.jd_text, jda, fit, ctx).then((plan) => {
        const byId = new Map(structure.paragraphs.map((p) => [p.id, p]));
        const tx = db().transaction(() => {
          db().prepare("DELETE FROM edits WHERE application_id=? AND decision='pending'").run(id);
          const decided = new Set((db().prepare("SELECT bullet_id FROM edits WHERE application_id=?").all(id) as { bullet_id: string }[]).map((r) => r.bullet_id));
          for (const e of plan.edits) {
            if (decided.has(e.bullet_id)) continue; // keep user's decisions stable across regenerations
            db()
              .prepare(
                `INSERT INTO edits (application_id, bullet_id, action, original_text, proposed_text, move_before_bullet_id, rationale, impact, substantive, jd_terms_json, accomplishment_ids_json, uses_unverified)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .run(id, e.bullet_id, e.action, byId.get(e.bullet_id)!.text, e.proposed_text, e.move_before_bullet_id, e.rationale, e.impact, e.substantive ? 1 : 0, JSON.stringify(e.jd_terms_used), JSON.stringify(e.accomplishment_refs), e.uses_unverified ? 1 : 0);
          }
          db().prepare("UPDATE applications SET edits_meta_json=? WHERE id=?").run(JSON.stringify({ ...plan.overall, dropped: plan.dropped }), id);
        });
        tx();
      }),
    );
  }
  if (sections.includes("answers")) {
    jobs.push(generateStandardAnswers(id, g.app.jd_text, jda, fit, ctx));
  }
  if (sections.includes("outreach")) {
    jobs.push(generateOutreach(id, "recruiter", null, ctx));
  }
  const results = await Promise.allSettled(jobs);
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => String(r.reason?.message ?? r.reason));
  return { errors };
}

/** Company research is never automatic: it is stored only after the user explicitly asks for it. */
function companyNotes(appId: number): string | null {
  return getSetting<string>(`research:${appId}`) ?? null;
}

export async function researchAndRewrite(id: number) {
  return exclusive(`research:${id}`, () =>
    withApp(id, async () => {
      const g = getApplication(id);
      if (!g?.analysis || !g.fit) throw new Error("Run the analysis first.");
      const notes = await T.researchCompany(g.analysis.company, g.app.jd_text);
      setSetting(`research:${id}`, notes);
      // regenerate only the "why this company" answer
      const why = (g.answers as { id: number; kind: string; question: string; limit_type: "words" | "chars" | null; limit_value: number | null }[]).find((a) => a.kind === "why_company");
      if (why) await answerCustomInner(id, why.question, why.limit_type, why.limit_value, null, why.id);
      return { notes };
    }),
  );
}

async function generateStandardAnswers(id: number, jd: string, jda: S.JDAnalysis, fit: S.FitAnalysis, ctx: T.CareerContext) {
  const notes = companyNotes(id);
  const qs = [
    { kind: "fit" as const, q: "Why are you a good fit for this role?" },
    { kind: "why_company" as const, q: `Why do you want to work at ${jda.company}?` },
  ];
  await Promise.all(
    qs.map(async ({ kind, q }) => {
      const res = await T.writeAnswer({ kind, question: q, jd, jda, fit, ctx, companyNotes: notes });
      db().prepare("DELETE FROM answers WHERE application_id=? AND kind=? AND saved=0").run(id, kind);
      const exists = db().prepare("SELECT id FROM answers WHERE application_id=? AND kind=?").get(id, kind);
      if (exists) return; // user saved an edited version; don't overwrite
      db()
        .prepare("INSERT INTO answers (application_id, kind, question, answer, needs_input, meta_json) VALUES (?,?,?,?,?,?)")
        .run(id, kind, q, res.answer, res.needs_input_question, JSON.stringify({ reasons: res.reasons_used, assumptions: res.assumptions, cliches: res.cliches, research: !!notes }));
    }),
  );
}

export async function answerCustom(id: number, question: string, limitType: "words" | "chars" | null, limitValue: number | null, userInput?: string | null, replaceAnswerId?: number) {
  return exclusive(`answer:${id}:${replaceAnswerId ?? question}`, () => withApp(id, () => answerCustomInner(id, question, limitType, limitValue, userInput, replaceAnswerId)));
}

async function answerCustomInner(id: number, question: string, limitType: "words" | "chars" | null, limitValue: number | null, userInput?: string | null, replaceAnswerId?: number) {
  const g = getApplication(id);
  if (!g?.analysis || !g.fit) throw new Error("Run the analysis first.");
  const { structure, outline } = await refreshMaster();
  const ctx = buildContext(structure, outline, [question, ...g.analysis.keywords.map((k) => k.term)], 12);
  const kind = replaceAnswerId ? ((db().prepare("SELECT kind FROM answers WHERE id=?").get(replaceAnswerId) as { kind: "fit" | "why_company" | "custom" })?.kind ?? "custom") : "custom";
  const notes = companyNotes(id);
  const res = await T.writeAnswer({ kind, question, limitType, limitValue, jd: g.app.jd_text, jda: g.analysis, fit: g.fit, ctx, companyNotes: notes, userInput, cache: false });
  const meta = JSON.stringify({ reasons: res.reasons_used, assumptions: res.assumptions, cliches: res.cliches, research: !!notes });
  if (replaceAnswerId) {
    db().prepare("UPDATE answers SET answer=?, needs_input=?, meta_json=?, limit_type=?, limit_value=?, saved=0, updated_at=datetime('now') WHERE id=?").run(res.answer, res.needs_input_question, meta, limitType, limitValue, replaceAnswerId);
    return replaceAnswerId;
  }
  return Number(
    db().prepare("INSERT INTO answers (application_id, kind, question, answer, limit_type, limit_value, needs_input, meta_json) VALUES (?,?,?,?,?,?,?,?)").run(id, "custom", question, res.answer, limitType, limitValue, res.needs_input_question, meta).lastInsertRowid,
  );
}

export async function generateOutreach(id: number, recipientType: T.RecipientType, recipientContext: string | null, ctx?: T.CareerContext) {
  return exclusive(`outreach:${id}:${recipientType}`, () => withApp(id, () => generateOutreachInner(id, recipientType, recipientContext, ctx)));
}

async function generateOutreachInner(id: number, recipientType: T.RecipientType, recipientContext: string | null, ctx?: T.CareerContext) {
  const g = getApplication(id);
  if (!g?.analysis || !g.fit) throw new Error("Run the analysis first.");
  if (!ctx) {
    const { structure, outline } = await refreshMaster();
    ctx = buildContext(structure, outline, g.analysis.keywords.map((k) => k.term), 12);
  }
  const res = await T.writeOutreach({ recipientType, recipientContext, jd: g.app.jd_text, jda: g.analysis, fit: g.fit, ctx, cache: !recipientContext });
  return Number(
    db()
      .prepare("INSERT INTO outreach (application_id, recipient_type, recipient_context, message, char_count, alternatives_json, evaluation_json) VALUES (?,?,?,?,?,?,?)")
      .run(id, recipientType, recipientContext, res.best.message, res.best.chars, JSON.stringify(res.alternatives), JSON.stringify(res.best))
      .lastInsertRowid,
  );
}

// ---------- editorial feedback ----------
export async function decideEdit(editId: number, decision: "accepted" | "rejected" | "edited" | "pending", finalText?: string | null, note?: string | null) {
  const e = db().prepare("SELECT * FROM edits WHERE id=?").get(editId) as EditRow | undefined;
  if (!e) throw new Error("Edit not found");
  if (decision === "edited" && !finalText?.trim()) throw new Error("Edited text is empty");
  db().prepare("UPDATE edits SET decision=?, final_text=? WHERE id=?").run(decision, decision === "edited" ? finalText!.replace(/\s*\n+\s*/g, " ").trim() : null, editId);
  if (decision === "pending") return { learned: null };
  const app = db().prepare("SELECT company, job_title FROM applications WHERE id=?").get(e.application_id) as { company: string; job_title: string };
  const fbId = feedback.add({
    application_id: e.application_id, edit_id: e.id, target: "resume", action: decision,
    original_text: e.original_text, proposed_text: e.proposed_text, final_text: decision === "edited" ? finalText! : null,
    user_note: note ?? null, classification: null, ai_response: null,
  });
  void app;
  return { learned: noteToMemory(fbId, note) };
}

/**
 * Free, deterministic interpretation of a note left while accepting/rejecting/editing.
 * Accept/reject never calls the model. Clearly general instructions ("never…", "don't…",
 * "always…") become saved rules; notes about this role stay role-specific; everything else
 * is kept for optional AI interpretation later (Memory → "Interpret notes").
 */
const GENERAL = /^(never|always|don'?t|do not|avoid|stop|no |prefer|i prefer|please always|please never|keep (bullets|it|answers|messages)|use (the )?exact|in general|generally)\b/i;
const SPECIFIC = /\b(this (role|job|position|company|one|bullet|application)|here|for (them|this)|less relevant|not relevant)\b/i;
export function heuristicClassify(note: string): "global_preference" | "role_specific" | null {
  const n = note.trim();
  if (SPECIFIC.test(n)) return "role_specific";
  if (GENERAL.test(n) && n.length <= 160) return "global_preference";
  return null;
}
export function noteToMemory(feedbackId: number, note?: string | null) {
  if (!note?.trim()) return null;
  const cls = heuristicClassify(note);
  let savedRule: { id: number; rule: string } | null = null;
  if (cls === "global_preference") {
    const rule = note.trim().replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase()).replace(/([^.!?])$/, "$1.");
    const p = prefs.add(rule, "style", "all", `feedback:${feedbackId}`);
    savedRule = { id: p.id, rule: p.rule };
  }
  feedback.update(feedbackId, { classification: cls ?? "unclassified" });
  return { classification: cls ?? "unclassified", response: cls === "role_specific" ? "Noted for this role only." : cls ? "Saved as a writing rule." : "Saved with this decision.", savedRule, confidence: "heuristic" };
}

/** Explicit, optional: interpret notes the free heuristic couldn't classify (one cheap call per note). */
export async function interpretPendingNotes(limit = 20) {
  const rows = db()
    .prepare("SELECT f.*, a.company, a.job_title FROM feedback f LEFT JOIN applications a ON a.id=f.application_id WHERE f.classification='unclassified' AND f.user_note IS NOT NULL ORDER BY f.id DESC LIMIT ?")
    .all(limit) as { id: number; action: string; original_text: string | null; proposed_text: string | null; final_text: string | null; user_note: string; company: string | null; job_title: string | null; target: string }[];
  const results = [];
  for (const r of rows) {
    results.push(await learnFromNote(r.id, { action: r.action, original: r.original_text, proposed: r.proposed_text, final: r.final_text, note: r.user_note, company: r.company, title: r.job_title, target: r.target }));
  }
  return { interpreted: results.length, saved: results.filter((x) => x.learned.savedRule).length };
}
export function pendingNotesCount() {
  return (db().prepare("SELECT COUNT(*) n FROM feedback WHERE classification='unclassified' AND user_note IS NOT NULL").get() as { n: number }).n;
}

export function saveOutreach(id: number, message: string) {
  const text = message.replace(/\r/g, "").trim();
  const n = Math.max(text.length, [...text].length);
  if (!text) throw new Error("Message is empty.");
  if (n > 300) throw Object.assign(new Error(`That's ${n} characters; LinkedIn allows 300.`), { response: { status: 400 } });
  const row = db().prepare("SELECT application_id, message FROM outreach WHERE id=?").get(id) as { application_id: number; message: string } | undefined;
  if (!row) throw new Error("Message not found");
  db().prepare("UPDATE outreach SET message=?, char_count=? WHERE id=?").run(text, n, id);
  if (text !== row.message)
    feedback.add({ application_id: row.application_id, edit_id: null, target: "outreach", action: "edited", original_text: null, proposed_text: row.message, final_text: text, user_note: null, classification: null, ai_response: null });
  return { chars: n };
}

/** What an operation is expected to cost, before running it. */
export function estimateOp(op: string, opts: { appId?: number; docs?: number } = {}) {
  const tasks: Record<string, string[]> = {
    analyze: ["fit_analysis", "edit_plan", "answer", "answer", "outreach"],
    new_application: ["jd_analysis", "fit_analysis", "edit_plan", "answer", "answer", "outreach"],
    edits: ["edit_plan"],
    answers: ["answer", "answer"],
    answer: ["answer"],
    outreach: ["outreach"],
    challenge: ["edit_challenge"],
    research: ["company_research", "answer"],
    import: Array.from({ length: opts.docs ?? 1 }, () => ["resume_extract", "bank_reconcile"]).flat(),
    master: ["master_outline", "resume_extract", "bank_reconcile"],
    interpret: Array.from({ length: Math.max(1, pendingNotesCount()) }, () => "feedback_classify"),
  };
  const usd = estimate(tasks[op] ?? []);
  return { op, usd, appSpent: opts.appId ? appSpend(opts.appId) : null };
}

/** Classify a piece of feedback; save reusable rules, record facts, keep the rest as role-specific history. */
export async function learnFromNote(feedbackId: number | null, f: { action: string; original?: string | null; proposed?: string | null; final?: string | null; note: string; company?: string | null; title?: string | null; target?: string }) {
  const c = await T.classifyFeedback(f);
  let savedRule: { id: number; rule: string } | null = null;
  if (c.classification === "global_preference" && c.reusable_rule && c.confidence !== "low") {
    const p = prefs.add(c.reusable_rule, c.rule_category, c.applies_to, feedbackId ? `feedback:${feedbackId}` : "explicit");
    savedRule = { id: p.id, rule: p.rule };
  }
  if (c.classification === "factual_correction" && c.fact_correction) {
    bank.addFact("correction", c.fact_correction);
  }
  if (feedbackId) feedback.update(feedbackId, { classification: c.classification, ai_response: c.response });
  else feedback.add({ application_id: null, edit_id: null, target: f.target ?? "general", action: "instruction", original_text: null, proposed_text: null, final_text: null, user_note: f.note, classification: c.classification, ai_response: c.response });
  return { learned: { classification: c.classification, response: c.response, savedRule, confidence: c.confidence } };
}

export async function challenge(editId: number, message: string) {
  const e0 = db().prepare("SELECT application_id FROM edits WHERE id=?").get(editId) as { application_id: number } | undefined;
  if (!e0) throw new Error("Edit not found");
  return exclusive(`challenge:${editId}`, () => withApp(e0.application_id, () => challengeInner(editId, message)));
}

async function challengeInner(editId: number, message: string) {
  const e = db().prepare("SELECT * FROM edits WHERE id=?").get(editId) as EditRow;
  const g = getApplication(e.application_id)!;
  const { structure, outline } = await refreshMaster();
  const ctx = buildContext(structure, outline, [e.original_text, e.proposed_text ?? ""], 8); // one bullet -> only its neighbourhood of evidence
  const res = await T.challengeEdit({ original: e.original_text, proposed: e.proposed_text, rationale: e.rationale, userMessage: message, jda: g.analysis!, ctx });
  if (res.stance === "revise" && res.revised_text) {
    db().prepare("UPDATE edits SET proposed_text=?, rationale=?, decision='pending' WHERE id=?").run(res.revised_text, res.response, editId);
  } else if (res.stance === "withdraw") {
    db().prepare("UPDATE edits SET decision='rejected' WHERE id=?").run(editId);
  }
  feedback.add({ application_id: e.application_id, edit_id: e.id, target: "resume", action: "comment", original_text: e.original_text, proposed_text: e.proposed_text, final_text: res.revised_text, user_note: message, classification: "question", ai_response: `[${res.stance}] ${res.response}` });
  return res;
}

// ---------- step 4/5: Google Doc + PDF ----------
export function docName(company: string, title: string, revision: number) {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, "").trim();
  return `${clean(company)} — ${clean(title)} — Resume${revision > 1 ? ` (Rev ${revision})` : ""}`;
}

export function approvedEdits(edits: EditRow[]): ApprovedEdit[] {
  return edits
    .filter((e) => e.decision === "accepted" || e.decision === "edited")
    .map((e): ApprovedEdit => {
      const text = (e.decision === "edited" ? e.final_text : e.proposed_text) ?? e.original_text;
      if (e.action === "remove" && e.decision === "accepted") return { kind: "remove", bulletId: e.bullet_id, originalText: e.original_text };
      if (e.action === "reposition" && e.move_before_bullet_id) return { kind: "move", bulletId: e.bullet_id, originalText: e.original_text, newText: text, beforeBulletId: e.move_before_bullet_id };
      return { kind: "replace_text", bulletId: e.bullet_id, originalText: e.original_text, newText: text };
    });
}

export async function finalize(id: number) {
  const g = getApplication(id);
  if (!g) throw new Error("Application not found");
  if (g.edits.some((e) => e.decision === "pending")) throw new Error("Accept or reject every recommendation before creating the document.");
  const master = getMaster();
  if (!master) throw new Error("No master resume.");
  const outline = j.parse<S.MasterOutline | null>(master.outline_json, null);
  // Every finalize creates a new, numbered doc; nothing is overwritten. Numbering is shared by all runs of the same role.
  const maxRev = (db()
    .prepare("SELECT COALESCE(MAX(d.revision),0) m FROM application_docs d JOIN applications a ON a.id=d.application_id WHERE a.jd_hash=? OR (a.company=? AND a.job_title=?)")
    .get(g.app.jd_hash, g.app.company, g.app.job_title) as { m: number }).m;
  const revision = Math.max(g.app.revision, maxRev + 1);
  const name = docName(g.app.company ?? "Company", g.app.job_title ?? "Role", revision);
  const approved = approvedEdits(g.edits);
  const created = await createTailoredDoc({ masterDocId: master.google_doc_id, name, edits: approved, expectedRevisionId: g.app.master_revision_id });
  const pdf = await exportPdf(created.docId);
  const dir = path.join(process.cwd(), "data", "pdfs");
  fs.mkdirSync(dir, { recursive: true });
  const pdfPath = path.join(dir, `app${id}-rev${revision}.pdf`);
  fs.writeFileSync(pdfPath, pdf);

  // Expected roles: the master outline minus nothing (roles are never edited)
  const roles = (outline?.roles ?? []).map((r) => ({ employer: r.employer, title: r.title, dates: r.dates }));
  const report = await validatePdf(pdf, {
    paragraphs: created.structure.paragraphs.map((p) => ({ text: p.text, isBullet: p.isBullet, isHeading: looksLikeHeading(p) })),
    approvedTexts: approved.filter((a) => a.kind !== "remove").map((a) => (a as { newText: string }).newText),
    roles,
    maxPages: await masterPageCount(master),
  });
  const { extractedText, ...stored } = report;
  db()
    .prepare("INSERT INTO application_docs (application_id, revision, google_doc_id, doc_url, doc_name, pdf_path, validation_json) VALUES (?,?,?,?,?,?,?)")
    .run(id, revision, created.docId, created.url, name, pdfPath, JSON.stringify({ ...stored, extractedPreview: extractedText.slice(0, 4000) }));
  db().prepare("UPDATE applications SET status=CASE WHEN status='draft' THEN 'ready' ELSE status END, updated_at=datetime('now') WHERE id=?").run(id);
  return { docUrl: created.url, name, revision, validation: stored };
}

// ---------- accomplishment bank import ----------
export async function importPreviousResume(googleDocId: string) {
  const s = await readStructure(googleDocId);
  const text = structureToText(s);
  const d = db();
  d.prepare(
    `INSERT INTO source_documents (google_doc_id, title, kind, revision_id, text, imported_at) VALUES (?,?,?,?,?,datetime('now'))
     ON CONFLICT(google_doc_id) DO UPDATE SET title=excluded.title, revision_id=excluded.revision_id, text=excluded.text, imported_at=datetime('now')`,
  ).run(googleDocId, s.title, "previous", s.revisionId, text);
  const src = d.prepare("SELECT id, kind FROM source_documents WHERE google_doc_id=?").get(googleDocId) as { id: number; kind: string };
  return ingestResumeText(text, src.id);
}

export async function ingestResumeText(text: string, sourceId: number | null) {
  const ex = await T.extractResume(text);
  for (const r of ex.roles) bank.upsertRole(r);
  for (const [kind, list] of [["skill", ex.skills], ["tool", ex.tools], ["industry", ex.industries], ["education", ex.education], ["certification", ex.certifications]] as const)
    for (const v of list) bank.addFact(kind, v);

  const existing = bank.list();
  const rec = await T.reconcile(
    ex.accomplishments.map((a) => ({ employer: a.employer, canonical: a.canonical, metrics: a.metrics, verbatim: a.verbatim_text })),
    existing.map((e) => ({ id: e.id, employer: e.employer ?? "", canonical: e.canonical, metrics: e.metrics.map((m) => `${m.value} ${m.context}`).join("; ") })),
  );
  let created = 0, merged = 0, flagged = 0;
  const validIds = new Set(existing.map((e) => e.id));
  for (const m of rec.matches) {
    const a = ex.accomplishments[m.new_index];
    if (!a) continue;
    const roleId = bank.upsertRole({ employer: a.employer, title: a.title });
    let accId: number;
    if (m.existing_id && validIds.has(m.existing_id)) {
      accId = m.existing_id;
      merged++;
      const cur = bank.get(accId)!;
      bank.update(accId, {
        skills: Array.from(new Set([...cur.skills, ...a.skills])),
        themes: Array.from(new Set([...cur.themes, ...a.themes])),
        job_categories: Array.from(new Set([...cur.job_categories, ...a.job_categories])),
      });
      if (m.discrepancy) {
        flagged++;
        bank.addDiscrepancy(accId, m.discrepancy.kind, m.discrepancy.description, [m.discrepancy.existing_value, m.discrepancy.new_value]);
      }
    } else {
      accId = bank.create({ role_id: roleId, canonical: a.canonical, metrics: a.metrics, skills: a.skills, themes: a.themes, job_categories: a.job_categories });
      created++;
    }
    bank.addVariant(accId, a.verbatim_text, a.framing, sourceId, "resume");
  }
  return { roles: ex.roles.length, created, merged, flagged };
}

// ---------- usage ----------
export function usage() {
  const d = db();
  const month = d.prepare("SELECT COALESCE(SUM(cost_usd),0) cost, COUNT(*) calls, COALESCE(SUM(cached_hit),0) hits FROM ai_calls WHERE created_at >= date('now','start of month')").get();
  const byTask = d.prepare("SELECT task, model, COUNT(*) calls, SUM(cached_hit) hits, ROUND(SUM(cost_usd),4) cost, SUM(input_tokens) input, SUM(output_tokens) output FROM ai_calls WHERE created_at >= date('now','start of month') GROUP BY task, model ORDER BY cost DESC").all();
  const byModel = d.prepare("SELECT model, COUNT(*) calls, SUM(cached_hit) hits, ROUND(SUM(cost_usd),4) cost FROM ai_calls WHERE created_at >= date('now','start of month') GROUP BY model ORDER BY cost DESC").all();
  const byApp = d
    .prepare(
      `SELECT a.id, a.company, a.job_title, ROUND(COALESCE(SUM(c.cost_usd),0),4) cost, COUNT(c.id) calls, COALESCE(SUM(c.cached_hit),0) hits
       FROM applications a LEFT JOIN ai_calls c ON c.application_id=a.id GROUP BY a.id ORDER BY a.id DESC LIMIT 30`,
    )
    .all() as { cost: number }[];
  const withCost = byApp.filter((r) => r.cost > 0);
  const avgPerApp = withCost.length ? withCost.reduce((s, r) => s + r.cost, 0) / withCost.length : null;
  return { month, byTask, byModel, byApp, avgPerApp, estimatedPerApp: estimateOp("new_application").usd };
}
