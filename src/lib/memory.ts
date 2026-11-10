import { getDb } from "./db";

export interface Preference {
  id: number;
  rule: string;
  category: string;
  applies_to: "all" | "resume" | "answers" | "outreach";
  active: number;
  source: string | null;
  created_at: string;
}

export interface FeedbackRow {
  id: number;
  application_id: number | null;
  edit_id: number | null;
  target: string;
  action: string;
  original_text: string | null;
  proposed_text: string | null;
  final_text: string | null;
  user_note: string | null;
  classification: string | null;
  ai_response: string | null;
  created_at: string;
}

export const prefs = {
  list(activeOnly = false): Preference[] {
    return getDb()
      .prepare(`SELECT * FROM preferences ${activeOnly ? "WHERE active = 1" : ""} ORDER BY created_at DESC`)
      .all() as Preference[];
  },
  forTarget(target: "resume" | "answers" | "outreach"): Preference[] {
    return getDb().prepare("SELECT * FROM preferences WHERE active = 1 AND applies_to IN ('all', ?) ORDER BY id").all(target) as Preference[];
  },
  add(rule: string, category = "style", applies_to: Preference["applies_to"] = "all", source = "explicit"): Preference {
    const db = getDb();
    const dup = db.prepare("SELECT * FROM preferences WHERE lower(rule) = lower(?)").get(rule.trim()) as Preference | undefined;
    if (dup) {
      db.prepare("UPDATE preferences SET active = 1 WHERE id = ?").run(dup.id);
      return { ...dup, active: 1 };
    }
    const info = db.prepare("INSERT INTO preferences (rule, category, applies_to, source) VALUES (?,?,?,?)").run(rule.trim(), category, applies_to, source);
    return db.prepare("SELECT * FROM preferences WHERE id = ?").get(info.lastInsertRowid) as Preference;
  },
  update(id: number, patch: Partial<Pick<Preference, "rule" | "category" | "applies_to" | "active">>) {
    const cur = getDb().prepare("SELECT * FROM preferences WHERE id = ?").get(id) as Preference | undefined;
    if (!cur) throw new Error("Preference not found");
    const n = { ...cur, ...patch };
    getDb().prepare("UPDATE preferences SET rule=?, category=?, applies_to=?, active=? WHERE id=?").run(n.rule, n.category, n.applies_to, n.active ? 1 : 0, id);
  },
  remove(id: number) {
    getDb().prepare("DELETE FROM preferences WHERE id = ?").run(id);
  },
};

export const feedback = {
  add(f: Omit<FeedbackRow, "id" | "created_at">): number {
    const r = getDb()
      .prepare(
        "INSERT INTO feedback (application_id, edit_id, target, action, original_text, proposed_text, final_text, user_note, classification, ai_response) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(f.application_id, f.edit_id, f.target, f.action, f.original_text, f.proposed_text, f.final_text, f.user_note, f.classification, f.ai_response);
    return Number(r.lastInsertRowid);
  },
  update(id: number, patch: Partial<Pick<FeedbackRow, "classification" | "ai_response" | "user_note">>) {
    const cur = getDb().prepare("SELECT * FROM feedback WHERE id = ?").get(id) as FeedbackRow;
    const n = { ...cur, ...patch };
    getDb().prepare("UPDATE feedback SET classification=?, ai_response=?, user_note=? WHERE id=?").run(n.classification, n.ai_response, n.user_note, id);
  },
  list(limit = 200): (FeedbackRow & { company: string | null; job_title: string | null })[] {
    return getDb()
      .prepare("SELECT f.*, a.company, a.job_title FROM feedback f LEFT JOIN applications a ON a.id = f.application_id ORDER BY f.id DESC LIMIT ?")
      .all(limit) as (FeedbackRow & { company: string | null; job_title: string | null })[];
  },
  remove(id: number) {
    getDb().prepare("DELETE FROM feedback WHERE id = ?").run(id);
  },
  /**
   * Compact digest of past editorial decisions, injected into prompts so the model stays
   * consistent: what was accepted, what was rejected and why. Role-specific rejections are
   * labelled so they are not over-generalised.
   */
  digest(target: string, limit = 25): string {
    const rows = getDb()
      .prepare(
        `SELECT f.*, a.company FROM feedback f LEFT JOIN applications a ON a.id = f.application_id
         WHERE f.target = ? AND f.action IN ('rejected','edited','accepted') AND (f.user_note IS NOT NULL OR f.action != 'accepted')
         ORDER BY f.id DESC LIMIT ?`,
      )
      .all(target, limit) as (FeedbackRow & { company: string | null })[];
    if (!rows.length) return "";
    return rows
      .map((r) => {
        const scope = r.classification === "role_specific" ? ` [role-specific: ${r.company ?? "?"}]` : r.classification ? ` [${r.classification}]` : "";
        if (r.action === "edited")
          return `- User rewrote a suggestion${scope}. Proposed: "${trunc(r.proposed_text)}" → User's version: "${trunc(r.final_text)}"${r.user_note ? ` Note: ${r.user_note}` : ""}`;
        if (r.action === "rejected") return `- User rejected${scope}: "${trunc(r.proposed_text)}"${r.user_note ? ` Reason: ${r.user_note}` : ""}`;
        return `- User accepted${scope}: "${trunc(r.proposed_text)}"${r.user_note ? ` Note: ${r.user_note}` : ""}`;
      })
      .join("\n");
  },
};

function trunc(s: string | null, n = 180) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export function preferencesBlock(target: "resume" | "answers" | "outreach"): string {
  const p = prefs.forTarget(target);
  if (!p.length) return "None saved yet.";
  return p.map((x) => `- [P${x.id}] ${x.rule}`).join("\n");
}
