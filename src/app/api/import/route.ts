import { route } from "@/lib/http";
import { importPreviousResume, ingestResumeText } from "@/lib/services";

export const maxDuration = 300;
/** Import previous resumes from Google Docs (docIds) or pasted text, into the accomplishment bank. */
export const POST = route(async (req: Request) => {
  const { docIds, text } = (await req.json()) as { docIds?: string[]; text?: string };
  const results: unknown[] = [];
  for (const id of docIds ?? []) {
    try {
      results.push({ docId: id, ...(await importPreviousResume(id)) });
    } catch (e) {
      results.push({ docId: id, error: (e as Error).message });
    }
  }
  if (text?.trim()) results.push({ pasted: true, ...(await ingestResumeText(text, null)) });
  return { results };
});
