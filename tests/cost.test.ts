import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/** Cost-control guarantees, verified with a stubbed model that records every call. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rm-cost-"));
process.env.RESUMASTER_DB = path.join(tmp, "cost.db");

let db: typeof import("@/lib/db");
let client: typeof import("@/lib/ai/client");
let svc: typeof import("@/lib/services");
let fx: typeof import("@/lib/demo/fixtures");
let P: typeof import("@/lib/demo/precomputed");
let ae: typeof import("@/lib/google/apply-edits");
let mem: typeof import("@/lib/memory");

const calls: { task: string; model: string }[] = [];
let delayMs = 0;
let appId: number;

beforeAll(async () => {
  db = await import("@/lib/db");
  client = await import("@/lib/ai/client");
  svc = await import("@/lib/services");
  fx = await import("@/lib/demo/fixtures");
  P = await import("@/lib/demo/precomputed");
  ae = await import("@/lib/google/apply-edits");
  mem = await import("@/lib/memory");
  client.__setTestRunner(async ({ task, model }) => {
    calls.push({ task, model });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (task === "jd_analysis") return P.PRECOMPUTED_JDA;
    if (task === "fit_analysis") return P.PRECOMPUTED_FIT;
    if (task === "edit_plan") return P.PRECOMPUTED_PLAN;
    if (task.startsWith("answer_")) return { answer: P.PRECOMPUTED_ANSWERS.fit, reasons_used: [], assumptions: [], needs_input_question: null };
    if (task === "outreach") return { candidates: [{ message: P.PRECOMPUTED_OUTREACH.message, angle: "a", specificity: 4, credibility: 4, relevance: 4 }] };
    if (task === "company_research") return "- [VERIFIED: example.com] fact";
    if (task === "feedback_classify") return { classification: "subjective", reusable_rule: null, rule_category: "style", applies_to: "all", confidence: "high", fact_correction: null, response: "ok" };
    if (task === "master_outline") return { roles: [], headings: [] };
    throw new Error("unexpected " + task);
  });
  db.getDb().prepare("INSERT INTO source_documents (google_doc_id, title, kind, revision_id, text, structure_json, outline_json) VALUES ('demo','Master','master','demo-1','',?,?)").run(JSON.stringify(fx.DEMO_RESUME), JSON.stringify({ roles: [], headings: [] }));
  db.setSetting("monthly_spend_limit_usd", 100);
  db.setSetting("per_app_limit_usd", 100);
  appId = (await svc.createApplication(fx.SAMPLE_JD) as { id: number }).id;
  await svc.runAnalysis(appId);
});
beforeEach(() => {
  calls.length = 0;
});

describe("model routing", () => {
  it("routes classification/outreach/copy edits to the low-cost model and strategy to the high-quality one", () => {
    expect(client.modelForTask("jd_analysis").model).toBe("claude-haiku-5-5");
    expect(client.modelForTask("outreach").model).toBe("claude-haiku-5-5");
    expect(client.modelForTask("answer_fit_shorten").model).toBe("claude-haiku-5-5");
    expect(client.modelForTask("resume_extract").model).toBe("claude-haiku-5-5");
    expect(client.modelForTask("fit_analysis").model).toBe("claude-opus-5-5");
    expect(client.modelForTask("edit_plan").model).toBe("claude-opus-5-5");
    expect(client.modelForTask("edit_challenge").model).toBe("claude-opus-5-5");
  });
  it("per-task model is configurable at runtime (no rebuild)", () => {
    db.setSetting("model_task:outreach", "claude-sonnet-5-5");
    expect(client.modelForTask("outreach").model).toBe("claude-sonnet-5-5");
    db.deleteSetting("model_task:outreach");
    expect(client.modelForTask("outreach").model).toBe("claude-haiku-5-5");
  });
});

describe("no AI for non-generative actions", () => {
  it("accepting, rejecting, editing (with notes) never calls the model", async () => {
    const g = svc.getApplication(appId)!;
    await svc.decideEdit(g.edits[0].id, "accepted");
    await svc.decideEdit(g.edits[1].id, "rejected", null, "Less relevant for this role.");
    const r = await svc.decideEdit(g.edits[2].id, "edited", "Cut event logistics bullet text.", "Never use the word 'leverage'.");
    await svc.decideEdit(g.edits[3].id, "rejected", null, "Hmm, feels off somehow");
    expect(calls).toEqual([]);
    expect(r.learned?.savedRule?.rule).toMatch(/Never use the word/);
    expect(svc.pendingNotesCount()).toBe(1); // ambiguous note waits for optional interpretation
  });
  it("viewing applications, history, settings, usage and estimates never calls the model", () => {
    svc.getApplication(appId);
    svc.listApplications();
    svc.usage();
    svc.estimateOp("new_application");
    mem.prefs.list();
    expect(calls).toEqual([]);
  });
  it("building the Google Docs edit + local preview never calls the model", () => {
    const approved = svc.approvedEdits(svc.getApplication(appId)!.edits);
    ae.buildRequests(fx.DEMO_RESUME, approved);
    ae.simulate(fx.DEMO_RESUME, approved);
    expect(calls).toEqual([]);
  });
  it("editing a LinkedIn message is free and still capped at 300 chars", () => {
    const o = svc.getApplication(appId)!.outreach as { id: number }[];
    expect(svc.saveOutreach(o[0].id, "Hi — applied for the PMM Lead role; I led a 1,400-sign-up API launch.").chars).toBeLessThan(300);
    expect(() => svc.saveOutreach(o[0].id, "x".repeat(301))).toThrow(/300/);
    expect(calls).toEqual([]);
  });
  it("company research is never automatic", async () => {
    await svc.runAnalysis(appId, ["answers"]);
    expect(calls.map((c) => c.task)).not.toContain("company_research");
  });
});

describe("caching", () => {
  it("re-running with unchanged inputs costs nothing", async () => {
    await svc.runAnalysis(appId, ["fit", "outreach"]); // may regenerate: a writing rule was saved since the last run
    calls.length = 0;
    await svc.runAnalysis(appId, ["fit", "outreach"]); // nothing changed now
    expect(calls).toEqual([]);
    const hits = (db.getDb().prepare("SELECT COUNT(*) n FROM ai_calls WHERE cached_hit=1 AND application_id=?").get(appId) as { n: number }).n;
    expect(hits).toBeGreaterThan(0);
  });
  it("identical concurrent requests share one model call", async () => {
    delayMs = 50;
    const { z } = await import("zod");
    const args = { task: "outreach", system: "s", user: "same-" + Date.now(), schema: z.object({ candidates: z.array(z.any()) }), schemaName: "X" };
    await Promise.all([client.callStructured(args), client.callStructured(args), client.callStructured(args)]);
    delayMs = 0;
    expect(calls.length).toBe(1);
  });
});

describe("spending protection (server-side)", () => {
  it("tags every call with its application", () => {
    const untagged = (db.getDb().prepare("SELECT COUNT(*) n FROM ai_calls WHERE application_id IS NULL AND task IN ('fit_analysis','edit_plan','jd_analysis','answer_fit','answer_why_company')").get() as { n: number }).n;
    expect(untagged).toBe(0);
  });
  it("blocks a duplicate concurrent run of the same operation", async () => {
    delayMs = 80;
    const first = svc.runAnalysis(appId, ["edits"]);
    await expect(svc.runAnalysis(appId, ["edits"])).rejects.toThrow(/already running/);
    await first;
    delayMs = 0;
  });
  it("enforces the per-application limit before calling the model", async () => {
    db.getDb().prepare("INSERT INTO ai_calls (task, model, cost_usd, application_id) VALUES ('x','claude-opus-5-5', 2, ?)").run(appId);
    db.setSetting("per_app_limit_usd", 1);
    await expect(svc.answerCustom(appId, "Brand new question?", null, null)).rejects.toThrow(/Per-application/);
    expect(calls).toEqual([]);
    db.setSetting("per_app_limit_usd", 100);
  });
  it("enforces the monthly limit before calling the model", async () => {
    db.setSetting("monthly_spend_limit_usd", 0.5);
    await expect(svc.answerCustom(appId, "Another new question?", null, null)).rejects.toThrow(/Monthly AI limit/);
    expect(calls).toEqual([]);
    db.setSetting("monthly_spend_limit_usd", 100);
  });
  it("estimates are available before running and default to a sub-$0.50 application", () => {
    const e = svc.estimateOp("new_application");
    expect(e.usd).toBeGreaterThan(0);
    expect(e.usd).toBeLessThan(0.5);
    expect(svc.estimateOp("outreach").usd).toBeLessThan(0.01);
  });
  it("default monthly budget is $5", async () => {
    db.deleteSetting("monthly_spend_limit_usd");
    expect(client.spendLimit()).toBe(5);
    db.setSetting("monthly_spend_limit_usd", 100);
  });
});
