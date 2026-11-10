import { route } from "@/lib/http";
import { getMaster, refreshMaster, setMaster } from "@/lib/services";
import { bullets } from "@/lib/google/structure";

export const dynamic = "force-dynamic";
export const GET = route(async () => {
  if (!getMaster()) return { master: null };
  const { doc, structure, outline } = await refreshMaster();
  return { master: { title: doc.title, googleDocId: doc.google_doc_id, revision: doc.revision_id }, bulletCount: bullets(structure).length, outline, paragraphs: structure.paragraphs.map((p) => ({ id: p.id, text: p.text, isBullet: p.isBullet })) };
});
export const POST = route(async (req: Request) => {
  const { docId } = await req.json();
  if (!docId) throw new Error("docId required");
  const r = await setMaster(docId);
  return { title: r.doc.title, roles: r.outline.roles.length, ingest: r.ingest };
});
