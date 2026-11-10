import type { NextRequest } from "next/server";
import { route } from "@/lib/http";
import { bank } from "@/lib/knowledge";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = route(async (req: NextRequest) => ({
  stats: bank.stats(),
  roles: bank.roles(),
  accomplishments: bank.list({ q: req.nextUrl.searchParams.get("q") ?? undefined, status: req.nextUrl.searchParams.get("status") ?? undefined }),
  discrepancies: bank.discrepancies(),
  facts: bank.facts(),
  sources: getDb().prepare("SELECT id, google_doc_id, title, kind, imported_at, created_at FROM source_documents ORDER BY id DESC").all(),
}));

/** Mutations: { action, ...payload } */
export const POST = route(async (req: Request) => {
  const b = await req.json();
  switch (b.action) {
    case "update_accomplishment": return bank.update(Number(b.id), b.patch);
    case "verify": return bank.update(Number(b.id), { status: "verified" });
    case "delete_accomplishment": return bank.remove(Number(b.id));
    case "create_accomplishment": return { id: bank.create({ role_id: b.role_id ?? null, canonical: b.canonical, metrics: b.metrics ?? [], skills: b.skills ?? [], status: "verified" }) };
    case "add_variant": return bank.addVariant(Number(b.id), b.text, b.framing ?? null, null, "user");
    case "delete_variant": return bank.removeVariant(Number(b.id));
    case "resolve_discrepancy": return bank.resolveDiscrepancy(Number(b.id), String(b.resolution));
    case "update_role": return bank.updateRole(Number(b.id), b.patch);
    case "add_fact": return bank.addFact(b.kind, b.value);
    case "delete_fact": return bank.removeFact(Number(b.id));
    default: throw new Error("Unknown action");
  }
});
