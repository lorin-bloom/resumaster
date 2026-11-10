import { route } from "@/lib/http";
import { getDb, getSetting, setSetting, deleteSetting } from "@/lib/db";
import { MODELS, TASK_ROUTES, maxRetries, modelForTask, modelForTier, perAppLimit, spendLimit } from "@/lib/ai/client";
import { usage } from "@/lib/services";

export const dynamic = "force-dynamic";

export const GET = route(async () => ({
  career_direction: getSetting<string>("career_direction") ?? "",
  monthly_spend_limit_usd: spendLimit(),
  per_app_limit_usd: perAppLimit(),
  warn_threshold_usd: getSetting<number>("warn_threshold_usd") ?? 0.1,
  max_retries: maxRetries(),
  model_strategy: modelForTier("strategy"),
  model_fast: modelForTier("fast"),
  models: MODELS,
  tasks: Object.entries(TASK_ROUTES).map(([key, r]) => ({ key, label: r.label, tier: r.tier, model: modelForTask(key).model, overridden: !!getSetting(`model_task:${key}`) })),
  usage: usage(),
}));

export const PATCH = route(async (req: Request) => {
  const b = await req.json();
  if (typeof b.career_direction === "string") setSetting("career_direction", b.career_direction.slice(0, 4000));
  for (const k of ["monthly_spend_limit_usd", "per_app_limit_usd", "warn_threshold_usd"]) if (b[k] !== undefined) setSetting(k, Math.max(0, Number(b[k]) || 0));
  if (b.max_retries !== undefined) setSetting("max_retries", Math.max(0, Math.min(3, Number(b.max_retries) || 0)));
  for (const k of ["model_strategy", "model_fast"]) if (b[k] && MODELS.includes(b[k])) setSetting(k, b[k]);
  if (b.task_model && TASK_ROUTES[b.task_model.key]) {
    if (b.task_model.model === "default") deleteSetting(`model_task:${b.task_model.key}`);
    else if (MODELS.includes(b.task_model.model)) setSetting(`model_task:${b.task_model.key}`, b.task_model.model);
  }
  if (b.clear_cache === true) getDb().prepare("DELETE FROM ai_cache").run();
});
