import { route, type Ctx } from "@/lib/http";
import { getApplication } from "@/lib/services";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
const STATUSES = ["draft", "ready", "applied", "interviewing", "rejected", "offer", "archived"];

export const GET = route(async (_: Request, { params }: Ctx<{ id: string }>) => {
  const g = getApplication(Number((await params).id));
  if (!g) throw Object.assign(new Error("Not found"), { response: { status: 404 } });
  return g;
});
export const PATCH = route(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { status } = await req.json();
  if (!STATUSES.includes(status)) throw new Error("Invalid status");
  getDb().prepare("UPDATE applications SET status=?, updated_at=datetime('now') WHERE id=?").run(status, Number((await params).id));
});
export const DELETE = route(async (_: Request, { params }: Ctx<{ id: string }>) => {
  getDb().prepare("DELETE FROM applications WHERE id=?").run(Number((await params).id));
});
