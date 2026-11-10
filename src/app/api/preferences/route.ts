import { route } from "@/lib/http";
import { prefs } from "@/lib/memory";

export const dynamic = "force-dynamic";
export const GET = route(async () => ({ preferences: prefs.list() }));
export const POST = route(async (req: Request) => {
  const b = await req.json();
  if (b.action === "update") return prefs.update(Number(b.id), b.patch);
  if (b.action === "delete") return prefs.remove(Number(b.id));
  if (!b.rule?.trim()) throw new Error("Rule required");
  return { preference: prefs.add(b.rule, b.category ?? "style", b.applies_to ?? "all") };
});
