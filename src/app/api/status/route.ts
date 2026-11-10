import { route } from "@/lib/http";
import { googleConfigured, isConnected } from "@/lib/google/auth";
import { aiConfigured, modelFor, monthSpend, spendLimit } from "@/lib/ai/client";
import { getSetting } from "@/lib/db";
import { getMaster } from "@/lib/services";
import { bank } from "@/lib/knowledge";

export const dynamic = "force-dynamic";
export const GET = route(async () => {
  const m = getMaster();
  return {
    google: { configured: googleConfigured(), connected: isConnected(), email: getSetting<string>("google_email") ?? null },
    ai: { configured: aiConfigured(), strategyModel: modelFor("strategy"), fastModel: modelFor("fast") },
    master: m ? { id: m.id, title: m.title, googleDocId: m.google_doc_id, revision: m.revision_id } : null,
    bank: bank.stats(),
    spend: { month: monthSpend(), limit: spendLimit() },
  };
});
