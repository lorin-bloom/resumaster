import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";
import type { z } from "zod";
import { getDb, getSetting } from "../db";

/**
 * Single choke point for every model call. Nothing else in the app talks to a model.
 *  - per-task model routing (configurable at runtime in Settings, no rebuild)
 *  - structured output + Zod validation
 *  - content-hash response cache: identical inputs never cost twice
 *  - in-flight de-duplication: concurrent identical requests share one call
 *  - server-side monthly AND per-application spending limits, checked before every call
 *  - cost accounting per call, tagged with the application it belongs to
 *  - mock mode (RESUMASTER_MOCK_AI=1) for UI work without spending anything
 */

export type Tier = "strategy" | "fast";
export type Effort = "low" | "medium" | "high";

export const DEFAULT_MODELS: Record<Tier, string> = {
  strategy: "claude-opus-5-5",
  fast: "claude-haiku-5-5",
};

/**
 * Task routing. "strategy" = high-quality reasoning; "fast" = low-cost model.
 * Each task's model can be overridden in Settings (setting key `model_task:<task>`).
 */
export const TASK_ROUTES: Record<string, { tier: Tier; effort: Effort; label: string }> = {
  jd_analysis:          { tier: "fast",     effort: "medium", label: "Classify JD requirements" },
  fit_analysis:         { tier: "strategy", effort: "medium", label: "Hiring-manager analysis & positioning" },
  edit_plan:            { tier: "strategy", effort: "high",   label: "Resume tailoring decisions" },
  edit_challenge:       { tier: "strategy", effort: "medium", label: "Evaluate disputed edits" },
  answer:               { tier: "strategy", effort: "medium", label: "Application answers" },
  answer_shorten:       { tier: "fast",     effort: "low",    label: "Simple copy revisions (shortening)" },
  outreach:             { tier: "fast",     effort: "medium", label: "LinkedIn messages" },
  feedback_classify:    { tier: "fast",     effort: "low",    label: "Interpret feedback notes" },
  master_outline:       { tier: "fast",     effort: "low",    label: "Resume structure parsing" },
  resume_extract:       { tier: "fast",     effort: "low",    label: "Accomplishment extraction" },
  bank_reconcile:       { tier: "fast",     effort: "medium", label: "Match accomplishments across resumes" },
  company_research:     { tier: "strategy", effort: "low",    label: "Company research (web search)" },
};

/** answer_fit / answer_why_company / answer_custom share the "answer" route; *_shorten share "answer_shorten". */
export function routeKey(task: string): string {
  if (TASK_ROUTES[task]) return task;
  if (task.startsWith("answer_") && task.endsWith("_shorten")) return "answer_shorten";
  if (task.startsWith("answer_")) return "answer";
  return task;
}

// USD per 1M tokens: [input, output, cacheRead]
export const PRICING: Record<string, [number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-fable-5-2": [8, 40, 0.2],
};
export const MODELS = Object.keys(PRICING);

/** Rough per-call costs on the default models, used until real history exists. */
const DEFAULT_ESTIMATES: Record<string, number> = {
  jd_analysis: 0.002, fit_analysis: 0.1, edit_plan: 0.18, edit_challenge: 0.04, answer: 0.05, answer_shorten: 0.001,
  outreach: 0.002, feedback_classify: 0.0005, master_outline: 0.001, resume_extract: 0.004, bank_reconcile: 0.003, company_research: 0.08,
};

export class SpendLimitError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SpendLimitError";
  }
}
export class AIUnavailableError extends Error {
  constructor(msg = "ANTHROPIC_API_KEY is not configured.") {
    super(msg);
    this.name = "AIUnavailableError";
  }
}

// ---------- application context (for per-application cost tagging + limits) ----------
const appCtx = new AsyncLocalStorage<{ appId: number | null }>();
export function withApp<T>(appId: number | null, fn: () => Promise<T>): Promise<T> {
  return appCtx.run({ appId }, fn);
}
const currentApp = () => appCtx.getStore()?.appId ?? null;

// ---------- configuration ----------
export function modelForTier(tier: Tier): string {
  return getSetting<string>(`model_${tier}`) ?? process.env[`RESUMASTER_MODEL_${tier.toUpperCase()}`] ?? DEFAULT_MODELS[tier];
}
/** Back-compat alias. */
export const modelFor = modelForTier;

export function modelForTask(task: string, fallbackTier: Tier = "strategy"): { model: string; effort: Effort } {
  const key = routeKey(task);
  const route = TASK_ROUTES[key] ?? { tier: fallbackTier, effort: "medium" as Effort };
  const override = getSetting<string>(`model_task:${key}`);
  return { model: override && PRICING[override] ? override : modelForTier(route.tier), effort: route.effort };
}

export function costOf(model: string, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
  const [inp, out, cr] = PRICING[model] ?? PRICING["claude-opus-5-5"];
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return (u.input_tokens * inp + cacheWrite * inp * 1.25 + cacheRead * cr + u.output_tokens * out) / 1_000_000;
}

export function monthSpend(): number {
  return (getDb().prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_calls WHERE created_at >= date('now','start of month')").get() as { s: number }).s;
}
export function appSpend(appId: number): number {
  return (getDb().prepare("SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_calls WHERE application_id = ?").get(appId) as { s: number }).s;
}
export function spendLimit(): number {
  const v = getSetting<number>("monthly_spend_limit_usd");
  return typeof v === "number" ? v : Number(process.env.RESUMASTER_SPEND_LIMIT ?? 5);
}
export function perAppLimit(): number {
  const v = getSetting<number>("per_app_limit_usd");
  return typeof v === "number" ? v : Number(process.env.RESUMASTER_PER_APP_LIMIT ?? 1);
}
export function maxRetries(): number {
  const v = getSetting<number>("max_retries");
  return typeof v === "number" ? Math.max(0, Math.min(3, v)) : 1;
}

/** Server-side guard. Throws before any tokens are spent. */
export function assertBudget(estimate = 0) {
  const spent = monthSpend();
  const limit = spendLimit();
  if (spent + estimate > limit)
    throw new SpendLimitError(`Monthly AI limit reached: $${spent.toFixed(2)} spent of $${limit.toFixed(2)}${estimate ? ` (this needs ~$${estimate.toFixed(2)})` : ""}. Raise it in Memory & settings.`);
  const app = currentApp();
  if (app != null) {
    const a = appSpend(app);
    const al = perAppLimit();
    if (a + estimate > al) throw new SpendLimitError(`Per-application AI limit reached: $${a.toFixed(2)} spent on this application of $${al.toFixed(2)}. Raise it in Memory & settings.`);
  }
}

/** Expected cost of a set of tasks: average of real (non-cached) calls when available, else defaults scaled to the configured model. */
export function estimate(tasks: string[]): number {
  const db = getDb();
  let total = 0;
  for (const t of tasks) {
    const key = routeKey(t);
    const { model } = modelForTask(key);
    const rows = db
      .prepare("SELECT cost_usd FROM ai_calls WHERE cached_hit = 0 AND model = ? AND (task = ? OR task LIKE ?) ORDER BY id DESC LIMIT 20")
      .all(model, key, key === "answer" ? "answer_%" : key) as { cost_usd: number }[];
    const real = rows.filter((r) => r.cost_usd > 0);
    if (real.length >= 2) total += real.reduce((s, r) => s + r.cost_usd, 0) / real.length;
    else {
      const base = DEFAULT_ESTIMATES[key] ?? 0.02;
      const defaultModel = DEFAULT_MODELS[TASK_ROUTES[key]?.tier ?? "strategy"];
      total += base * ((PRICING[model]?.[1] ?? 20) / (PRICING[defaultModel]?.[1] ?? 20));
    }
  }
  return total;
}

// ---------- mock / test runners ----------
type Runner = (args: { task: string; model: string; system: string; user: string; schemaName: string }) => Promise<unknown>;
let _testRunner: Runner | null = null;
export function __setTestRunner(r: Runner | null) {
  _testRunner = r;
}
let _mockLoaded: Runner | null = null;
async function mockRunner(): Promise<Runner | null> {
  if (process.env.RESUMASTER_MOCK_AI !== "1") return null;
  if (!_mockLoaded) _mockLoaded = (await import("./mock")).mockRunner;
  return _mockLoaded;
}

export function aiConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) || !!_testRunner || process.env.RESUMASTER_MOCK_AI === "1";
}

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new AIUnavailableError();
  // Pin the endpoint: never inherit an ANTHROPIC_BASE_URL from the surrounding shell (e.g. a dev-tool proxy).
  return new Anthropic({ maxRetries: maxRetries(), baseURL: process.env.RESUMASTER_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com" });
}

function hash(...parts: string[]) {
  const h = crypto.createHash("sha256");
  for (const p of parts) h.update(p).update("\u0000");
  return h.digest("hex");
}

function record(task: string, model: string, usage: Parameters<typeof costOf>[1] | null, cachedHit = false) {
  getDb()
    .prepare("INSERT INTO ai_calls (task, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, cached_hit, application_id) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(task, model, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0, usage?.cache_read_input_tokens ?? 0, usage?.cache_creation_input_tokens ?? 0, usage && model !== "mock" ? costOf(model, usage) : 0, cachedHit ? 1 : 0, currentApp());
}

const inflight = new Map<string, Promise<unknown>>();

export interface StructuredCall<S extends z.ZodType> {
  task: string;
  tier?: Tier;               // fallback when the task has no route
  effort?: Effort;           // overrides the route's effort
  system: string;            // stable instructions (cached prefix)
  context?: string;          // semi-stable context - cached after system
  user: string;              // volatile per-request content
  schema: S;
  schemaName: string;
  cache?: boolean;           // default true
  maxTokens?: number;
}

export async function callStructured<S extends z.ZodType>(c: StructuredCall<S>): Promise<z.infer<S>> {
  const route = modelForTask(c.task, c.tier);
  const model = route.model;
  const effort = c.effort ?? route.effort;
  const db = getDb();
  const key = hash(c.task, model, effort, c.schemaName, c.system, c.context ?? "", c.user);
  const useCache = c.cache !== false;

  if (useCache) {
    const hit = db.prepare("SELECT value FROM ai_cache WHERE key = ?").get(key) as { value: string } | undefined;
    if (hit) {
      const parsed = c.schema.safeParse(JSON.parse(hit.value));
      if (parsed.success) {
        record(c.task, model, null, true);
        return parsed.data;
      }
    }
  }
  // identical request already running -> share it instead of paying twice
  const running = inflight.get(key);
  if (running) return c.schema.parse(await running);

  const p = (async () => {
    assertBudget();
    let result: unknown;
    const stub = _testRunner ?? (await mockRunner());
    if (stub) {
      result = await stub({ task: c.task, model, system: c.system, user: (c.context ?? "") + "\n" + c.user, schemaName: c.schemaName });
      record(c.task, _testRunner ? model : "mock", { input_tokens: 0, output_tokens: 0 });
    } else {
      const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: c.system }];
      if (c.context) system.push({ type: "text", text: c.context, cache_control: { type: "ephemeral" } });
      else system[0].cache_control = { type: "ephemeral" };
      const supportsFallback = /^claude-(opus|sonnet)-5-5$/.test(model);
      const resp = await client().beta.messages.parse({
        model,
        max_tokens: c.maxTokens ?? 16000,
        system,
        messages: [{ role: "user", content: c.user }],
        output_config: { format: betaZodOutputFormat(c.schema), effort },
        ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      record(c.task, model, resp.usage);
      if (resp.stop_reason === "refusal") throw new Error(`The model declined this request (${c.task}).`);
      if (resp.stop_reason === "max_tokens") throw new Error(`Response was cut off (${c.task}); try again with a shorter input.`);
      if (resp.parsed_output == null) throw new Error(`Model output did not match the ${c.schemaName} schema.`);
      result = resp.parsed_output;
    }
    const validated = c.schema.parse(result); // never trust unvalidated output
    if (useCache) db.prepare("INSERT OR REPLACE INTO ai_cache (key, task, value) VALUES (?, ?, ?)").run(key, c.task, JSON.stringify(validated));
    return validated;
  })();
  inflight.set(key, p);
  try {
    return (await p) as z.infer<S>;
  } finally {
    inflight.delete(key);
  }
}

/** Free-text call with optional server tools (used only for opt-in company research). */
export async function callText(opts: { task: string; tier?: Tier; system: string; user: string; tools?: Anthropic.Beta.BetaToolUnion[] }): Promise<string> {
  const { model, effort } = modelForTask(opts.task, opts.tier);
  const db = getDb();
  const key = hash(opts.task, model, "text", opts.system, opts.user);
  const hit = db.prepare("SELECT value FROM ai_cache WHERE key = ?").get(key) as { value: string } | undefined;
  if (hit) {
    record(opts.task, model, null, true);
    return JSON.parse(hit.value) as string;
  }
  assertBudget();
  const stub = _testRunner ?? (await mockRunner());
  let text: string;
  if (stub) {
    text = (await stub({ task: opts.task, model, system: opts.system, user: opts.user, schemaName: "text" })) as string;
    record(opts.task, _testRunner ? model : "mock", { input_tokens: 0, output_tokens: 0 });
  } else {
    const supportsFallback = /^claude-(opus|sonnet)-5-5$/.test(model);
    const resp = await client().beta.messages.create({
      model,
      max_tokens: 8000,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort },
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    // web search requests are billed separately ($10 / 1,000)
    const searches = (resp.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use?.web_search_requests ?? 0;
    record(opts.task, model, resp.usage);
    if (searches) db.prepare("UPDATE ai_calls SET cost_usd = cost_usd + ? WHERE id = (SELECT MAX(id) FROM ai_calls)").run(searches * 0.01);
    text = resp.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  }
  db.prepare("INSERT OR REPLACE INTO ai_cache (key, task, value) VALUES (?, ?, ?)").run(key, opts.task, JSON.stringify(text));
  return text;
}
