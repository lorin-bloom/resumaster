import { beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * End-to-end pipeline with the model call stubbed (no network): JD → analysis → edits →
 * answers → outreach → decisions → feedback learning → persistence across a "restart".
 */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rm-test-"));
process.env.RESUMASTER_DB = path.join(tmp, "test.db");
delete process.env.GOOGLE_CLIENT_ID;

type Mods = {
  db: typeof import("@/lib/db");
  client: typeof import("@/lib/ai/client");
  svc: typeof import("@/lib/services");
  mem: typeof import("@/lib/memory");
  kb: typeof import("@/lib/knowledge");
  fx: typeof import("@/lib/demo/fixtures");
  P: typeof import("@/lib/demo/precomputed");
  ae: typeof import("@/lib/google/apply-edits");
  lim: typeof import("@/lib/limits");
};
let m: Mods;
const calls: string[] = [];

beforeAll(async () => {
  m = {
    db: await import("@/lib/db"),
    client: await import("@/lib/ai/client"),
    svc: await import("@/lib/services"),
    mem: await import("@/lib/memory"),
    kb: await import("@/lib/knowledge"),
    fx: await import("@/lib/demo/fixtures"),
    P: await import("@/lib/demo/precomputed"),
    ae: await import("@/lib/google/apply-edits"),
    lim: await import("@/lib/limits"),
  };
  const { P, fx } = m;
  m.client.__setTestRunner(async ({ task, user }) => {
    calls.push(task);
    switch (task) {
      case "jd_analysis": return P.PRECOMPUTED_JDA;
      case "fit_analysis": return P.PRECOMPUTED_FIT;
      case "edit_plan":
        return {
          ...P.PRECOMPUTED_PLAN,
          edits: [
            ...P.PRECOMPUTED_PLAN.edits,
            { ...P.PRECOMPUTED_PLAN.edits[0], bullet_id: "p99" },                              // hallucinated id
            { ...P.PRECOMPUTED_PLAN.edits[0], bullet_id: "p11", accomplishment_refs: ["A4"] }, // disputed fact
            { ...P.PRECOMPUTED_PLAN.edits[1], bullet_id: "p9", move_before_bullet_id: "p14" }, // cross-role move
            { ...P.PRECOMPUTED_PLAN.edits[0], bullet_id: "p10", proposed_text: "Built enablement.", accomplishment_refs: ["A6"], uses_unverified: false },
          ],
        };
      case "answer_fit": return { answer: "word ".repeat(220).trim() + ".", reasons_used: [], assumptions: [], needs_input_question: null };
      case "answer_fit_shorten": return { answer: P.PRECOMPUTED_ANSWERS.fit, reasons_used: ["a"], assumptions: [], needs_input_question: null };
      case "answer_why_company": return { answer: P.PRECOMPUTED_ANSWERS.why_company, reasons_used: [], assumptions: ["x"], needs_input_question: null };
      case "answer_custom": return { answer: "x".repeat(900), reasons_used: [], assumptions: [], needs_input_question: null };
      case "answer_custom_shorten": return { answer: "Short and specific. ".repeat(40), reasons_used: [], assumptions: [], needs_input_question: null };
      case "outreach":
        return {
          candidates: [
            { message: "I'm passionate about your mission and would love to pick your brain about the PMM Lead role.", angle: "generic", specificity: 5, credibility: 5, relevance: 5 },
            { message: P.PRECOMPUTED_OUTREACH.message + " " + "Extra detail that pushes this over the limit. ".repeat(4), angle: "long", specificity: 4, credibility: 4, relevance: 4 },
            { message: P.PRECOMPUTED_OUTREACH.message, angle: "metrics", specificity: 4, credibility: 4, relevance: 3 },
          ],
        };
      case "feedback_classify":
        if (/never|don't|always/i.test(user))
          return { classification: "global_preference", reusable_rule: "Never use filler words.", rule_category: "style", applies_to: "all", confidence: "high", fact_correction: null, response: "Saved." };
        return { classification: "role_specific", reusable_rule: null, rule_category: "style", applies_to: "resume", confidence: "high", fact_correction: null, response: "Noted for this role only." };
      case "master_outline":
        return {
          roles: [
            { employer: "Cobalt Analytics", title: "Senior Product Marketing Manager", dates: "Jan 2021 – Present", bullet_ids: ["p7", "p8", "p9", "p10", "p11"] },
            { employer: "Harbor Payments", title: "Product Marketing Manager", dates: "Jun 2018 – Dec 2020", bullet_ids: ["p14", "p15", "p16", "p17"] },
            { employer: "Brightline Media", title: "Marketing Associate", dates: "Aug 2015 – May 2018", bullet_ids: ["p20", "p21"] },
          ],
          headings: [],
        };
      default: throw new Error("unexpected task " + task);
    }
  });
  // Master resume cached locally (Google not connected → services fall back to cache)
  m.db.getDb().prepare("INSERT INTO source_documents (google_doc_id, title, kind, revision_id, text, structure_json) VALUES ('demo','Master','master','demo-1','',?)").run(JSON.stringify(fx.DEMO_RESUME));
  // a small bank incl. a disputed + unverified accomplishment
  const r = m.kb.bank.upsertRole({ employer: "Cobalt Analytics", title: "Senior Product Marketing Manager" });
  for (let i = 0; i < 6; i++) m.kb.bank.create({ role_id: r, canonical: `placeholder ${i}`, status: "verified" });
  m.db.getDb().prepare("UPDATE accomplishments SET status='disputed' WHERE id=4").run();
  m.db.getDb().prepare("UPDATE accomplishments SET status='unverified' WHERE id=6").run();
});

describe("application pipeline (stubbed model)", () => {
  let appId: number;

  it("creates an application from a pasted JD and caches the JD analysis", async () => {
    const r = await m.svc.createApplication(m.fx.SAMPLE_JD);
    expect("id" in r).toBe(true);
    appId = (r as { id: number }).id;
    const before = calls.filter((c) => c === "jd_analysis").length;
    const dup = await m.svc.createApplication(m.fx.SAMPLE_JD);
    expect("duplicate" in dup).toBe(true); // offers resume/revision instead of silently duplicating
    expect(calls.filter((c) => c === "jd_analysis").length).toBe(before); // cache hit, no second model call
  });

  it("runs fit, edits, answers, outreach and sanitizes model output", async () => {
    const { errors } = await m.svc.runAnalysis(appId);
    expect(errors).toEqual([]);
    const g = m.svc.getApplication(appId)!;
    expect(g.fit?.fit_level).toBe("strong");
    const ids = g.edits.map((e) => e.bullet_id);
    expect(ids).toEqual(expect.arrayContaining(["p7", "p15", "p17", "p21", "p10"]));
    expect(ids).not.toContain("p99"); // hallucinated id dropped
    expect(ids).not.toContain("p11"); // disputed fact dropped
    expect(ids).not.toContain("p9");  // cross-role reposition dropped
    expect(g.edits.find((e) => e.bullet_id === "p10")!.uses_unverified).toBe(1); // flagged even though model said false
    expect(g.edits.find((e) => e.bullet_id === "p7")!.original_text).toBe(m.fx.DEMO_RESUME.paragraphs[7].text);
    // answers: over-long draft triggered a shorten pass
    const fit = (g.answers as { kind: string; answer: string }[]).find((a) => a.kind === "fit")!;
    expect(m.lim.wordCount(fit.answer)).toBeLessThanOrEqual(160);
    expect(calls).toContain("answer_fit_shorten");
    // outreach: banned + over-limit candidates lose; stored message ≤ 300
    const o = (g.outreach as { message: string; char_count: number }[])[0];
    expect(o.char_count).toBeLessThanOrEqual(300);
    expect(m.lim.bannedHits(o.message)).toEqual([]);
  });

  it("custom questions respect character limits", async () => {
    const id = await m.svc.answerCustom(appId, "Describe a launch you led.", "chars", 500);
    const a = m.db.getDb().prepare("SELECT answer FROM answers WHERE id=?").get(id) as { answer: string };
    expect(m.lim.charCount(a.answer)).toBeLessThanOrEqual(500);
  });

  it("learns a global preference from feedback but not from role-specific rejections", async () => {
    const g = m.svc.getApplication(appId)!;
    const [e1, e2, e3, e4, e5] = g.edits;
    const r1 = await m.svc.decideEdit(e1.id, "edited", "Co-designed usage-based packaging; 300+ accounts adopted it in two quarters.", "Never use filler words.");
    expect(r1.learned?.savedRule?.rule).toBe("Never use filler words.");
    const r2 = await m.svc.decideEdit(e2.id, "rejected", null, "Less relevant for this particular role.");
    expect(r2.learned?.savedRule).toBeNull();
    await m.svc.decideEdit(e3.id, "accepted");
    await m.svc.decideEdit(e4.id, "accepted");
    await m.svc.decideEdit(e5.id, "rejected");
    expect(m.mem.prefs.list().map((p) => p.rule)).toEqual(["Never use filler words."]);
    const fb = m.mem.feedback.list();
    expect(fb.find((f) => f.edit_id === e2.id)?.classification).toBe("role_specific");
  });

  it("persists memory across a restart and injects it into future prompts", async () => {
    m.db.resetDbCache(); // simulate process restart: reopen the SQLite file
    expect(m.mem.prefs.list().map((p) => p.rule)).toContain("Never use filler words.");
    expect(m.mem.preferencesBlock("resume")).toContain("Never use filler words.");
    expect(m.mem.feedback.digest("resume")).toMatch(/role-specific/);
    const { structure, outline } = await m.svc.refreshMaster();
    const ctx = m.svc.buildContext(structure, outline, ["API"]);
    expect(ctx.preferences.outreach).toContain("Never use filler words.");
  });

  it("builds a valid Docs batchUpdate from the approved decisions", () => {
    const g = m.svc.getApplication(appId)!;
    const approved = m.svc.approvedEdits(g.edits);
    expect(approved.length).toBe(3);
    const reqs = m.ae.buildRequests(m.fx.DEMO_RESUME, approved);
    expect(reqs.length).toBeGreaterThan(0);
    const preview = m.ae.simulate(m.fx.DEMO_RESUME, approved);
    expect(preview).toContain("Co-designed usage-based packaging; 300+ accounts adopted it in two quarters.");
    expect(preview).not.toContain("Organized company booth at industry conferences.");
  });

  it("names docs per spec and numbers revisions", async () => {
    expect(m.svc.docName("Northwind Labs", "Product Marketing Lead", 1)).toBe("Northwind Labs — Product Marketing Lead — Resume");
    expect(m.svc.docName("Northwind Labs", "Product Marketing Lead", 2)).toBe("Northwind Labs — Product Marketing Lead — Resume (Rev 2)");
    const r = await m.svc.createApplication(m.fx.SAMPLE_JD, { force: true });
    const rev = m.db.getDb().prepare("SELECT revision, parent_id FROM applications WHERE id=?").get((r as { id: number }).id) as { revision: number; parent_id: number };
    expect(rev).toEqual({ revision: 2, parent_id: appId });
  });

  it("enforces the monthly spending limit", async () => {
    m.db.getDb().prepare("INSERT INTO ai_calls (task, model, cost_usd) VALUES ('x','claude-opus-5-5', 5)").run();
    m.db.setSetting("monthly_spend_limit_usd", 1);
    await expect(m.svc.answerCustom(appId, "A new question?", null, null)).rejects.toThrow(/AI limit/i);
    m.db.setSetting("monthly_spend_limit_usd", 100);
  });
});
