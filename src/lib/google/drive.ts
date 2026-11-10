import { apis } from "./auth";
import { parseDocument, type ResumeStructure } from "./structure";
import { buildRequests, type ApprovedEdit } from "./apply-edits";
import { getSetting, setSetting } from "../db";

export const FOLDER_NAME = "Resumaster Applications";

export async function listDocs(query?: string) {
  const { drive } = apis();
  const q = ["mimeType='application/vnd.google-apps.document'", "trashed=false"];
  if (query) q.push(`name contains '${query.replace(/['\\]/g, "\\$&")}'`);
  const res = await drive.files.list({
    q: q.join(" and "),
    orderBy: "modifiedTime desc",
    pageSize: 50,
    fields: "files(id,name,modifiedTime,webViewLink)",
  });
  return res.data.files ?? [];
}

export async function readStructure(docId: string): Promise<ResumeStructure> {
  const { docs } = apis();
  const res = await docs.documents.get({ documentId: docId });
  return parseDocument(res.data);
}

export async function ensureFolder(): Promise<string> {
  const { drive } = apis();
  const cached = getSetting<string>("drive_folder_id");
  if (cached) {
    try {
      const f = await drive.files.get({ fileId: cached, fields: "id,trashed" });
      if (f.data.id && !f.data.trashed) return cached;
    } catch {
      /* folder was deleted; recreate */
    }
  }
  const existing = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
    fields: "files(id)",
  });
  const id =
    existing.data.files?.[0]?.id ??
    (await drive.files.create({ requestBody: { name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }, fields: "id" })).data.id!;
  setSetting("drive_folder_id", id);
  return id;
}

export async function nameTaken(name: string, folderId: string) {
  const { drive } = apis();
  const res = await drive.files.list({ q: `'${folderId}' in parents and name='${name.replace(/['\\]/g, "\\$&")}' and trashed=false`, fields: "files(id)" });
  return (res.data.files?.length ?? 0) > 0;
}

/**
 * Copy master -> new doc in the Resumaster folder, apply approved edits, return ids.
 * The master is only ever READ. Copy preserves all formatting (fonts, margins, spacing, bullets, layout).
 */
export async function createTailoredDoc(opts: { masterDocId: string; name: string; edits: ApprovedEdit[]; expectedRevisionId?: string | null }) {
  const { drive, docs } = apis();
  const folderId = await ensureFolder();
  const copy = await drive.files.copy({ fileId: opts.masterDocId, requestBody: { name: opts.name, parents: [folderId] }, fields: "id,webViewLink" });
  const newId = copy.data.id!;
  const structure = await readStructure(newId);
  const requests = buildRequests(structure, opts.edits);
  if (requests.length) await docs.documents.batchUpdate({ documentId: newId, requestBody: { requests } });
  const finalStructure = await readStructure(newId);
  return { docId: newId, url: copy.data.webViewLink ?? `https://docs.google.com/document/d/${newId}/edit`, structure: finalStructure, requestCount: requests.length };
}

export async function exportPdf(docId: string): Promise<Buffer> {
  const { drive } = apis();
  const res = await drive.files.export({ fileId: docId, mimeType: "application/pdf" }, { responseType: "arraybuffer" });
  return Buffer.from(res.data as ArrayBuffer);
}
