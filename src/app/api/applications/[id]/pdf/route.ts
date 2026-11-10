import fs from "fs";
import type { NextRequest } from "next/server";
import { fail, type Ctx } from "@/lib/http";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest, { params }: Ctx<{ id: string }>) {
  try {
    const id = Number((await params).id);
    const rev = req.nextUrl.searchParams.get("rev");
    const row = getDb()
      .prepare(`SELECT pdf_path, doc_name FROM application_docs WHERE application_id=? ${rev ? "AND revision=?" : ""} ORDER BY revision DESC LIMIT 1`)
      .get(...(rev ? [id, Number(rev)] : [id])) as { pdf_path: string; doc_name: string } | undefined;
    if (!row?.pdf_path || !fs.existsSync(row.pdf_path)) throw Object.assign(new Error("PDF not found"), { response: { status: 404 } });
    const file = fs.readFileSync(row.pdf_path);
    const ascii = row.doc_name.replace(/[—–]/g, "-").replace(/[^\x20-\x7E]/g, "");
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(row.doc_name)}.pdf`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
