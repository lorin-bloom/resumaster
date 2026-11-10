import type { docs_v1 } from "googleapis";
import type { ResumeParagraph, ResumeStructure } from "./structure";

/**
 * Turns approved edits into a Google Docs batchUpdate that touches ONLY the edited
 * paragraphs of a copy of the master resume. The copy itself (made with Drive
 * files.copy) carries every formatting property: fonts, margins, spacing, bullets,
 * tab stops, page layout. We only replace paragraph text and re-apply the original
 * run style to the replaced text.
 *
 * Index safety: all primitive operations are sorted by anchor index DESCENDING, so
 * an operation never shifts the indices of operations that run after it.
 */

export type ApprovedEdit =
  | { kind: "replace_text"; bulletId: string; originalText: string; newText: string }
  | { kind: "remove"; bulletId: string; originalText: string }
  | { kind: "move"; bulletId: string; originalText: string; newText: string; beforeBulletId: string };

type Prim =
  | { anchor: number; order: number; reqs: docs_v1.Schema$Request[] };

const STYLE_FIELDS = [
  "bold", "italic", "underline", "strikethrough", "smallCaps", "fontSize",
  "weightedFontFamily", "foregroundColor", "backgroundColor", "baselineOffset", "link",
] as const;

function styleRequest(start: number, len: number, style: docs_v1.Schema$TextStyle | null): docs_v1.Schema$Request[] {
  if (!style || len <= 0) return [];
  const fields = STYLE_FIELDS.filter((f) => style[f] !== undefined && style[f] !== null);
  // Resetting link to null when the original had none prevents link bleed from neighbours.
  const s: docs_v1.Schema$TextStyle = { ...style };
  if (s.link === undefined) {
    s.link = null as unknown as undefined;
    fields.push("link");
  }
  if (!fields.length) return [];
  return [
    {
      updateTextStyle: {
        range: { startIndex: start, endIndex: start + len },
        textStyle: s,
        fields: Array.from(new Set(fields)).join(","),
      },
    },
  ];
}

/** UTF-16 length is what Docs indices count. JS string .length is UTF-16, so it matches. */
const docLen = (s: string) => s.length;

export class EditConflictError extends Error {}

/**
 * Locate a paragraph in the (copied) doc. We match by id first and then verify the text
 * still matches; if the copy drifted (someone edited the master), fall back to text search.
 */
export function locate(s: ResumeStructure, bulletId: string, originalText: string): ResumeParagraph {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const byId = s.paragraphs.find((p) => p.id === bulletId);
  if (byId && norm(byId.text) === norm(originalText)) return byId;
  const matches = s.paragraphs.filter((p) => norm(p.text) === norm(originalText));
  if (matches.length === 1) return matches[0];
  throw new EditConflictError(
    matches.length === 0
      ? `Could not find the original text of ${bulletId} in the document copy. The master resume may have changed since analysis — re-run the analysis.`
      : `The text of ${bulletId} appears ${matches.length} times; refusing to guess which one to edit.`,
  );
}

export function buildRequests(s: ResumeStructure, edits: ApprovedEdit[]): docs_v1.Schema$Request[] {
  const prims: Prim[] = [];
  const lastBodyIndex = Math.max(...s.paragraphs.map((p) => p.endIndex));

  for (const e of edits) {
    const p = locate(s, e.bulletId, e.originalText);
    const textStart = p.startIndex;
    const textEnd = p.endIndex - 1; // exclude paragraph newline

    if (e.kind === "replace_text") {
      if (e.newText.includes("\n")) throw new EditConflictError(`Replacement for ${e.bulletId} contains a line break.`);
      const reqs: docs_v1.Schema$Request[] = [];
      if (textEnd > textStart) reqs.push({ deleteContentRange: { range: { startIndex: textStart, endIndex: textEnd } } });
      reqs.push({ insertText: { location: { index: textStart }, text: e.newText } });
      reqs.push(...styleRequest(textStart, docLen(e.newText), p.dominantStyle));
      prims.push({ anchor: textStart, order: 0, reqs });
    } else if (e.kind === "remove") {
      // Delete the whole paragraph including its newline. The document's final newline can't be deleted,
      // so for the last paragraph delete the preceding newline instead.
      const range = p.endIndex >= lastBodyIndex ? { startIndex: p.startIndex - 1, endIndex: p.endIndex - 1 } : { startIndex: p.startIndex, endIndex: p.endIndex };
      prims.push({ anchor: p.startIndex, order: 0, reqs: [{ deleteContentRange: { range } }] });
    } else if (e.kind === "move") {
      const target = s.paragraphs.find((q) => q.id === e.beforeBulletId);
      if (!target) throw new EditConflictError(`Move target ${e.beforeBulletId} not found.`);
      if (!target.isBullet) throw new EditConflictError(`Move target ${e.beforeBulletId} is not a bullet.`);
      // 1) remove original paragraph
      prims.push({ anchor: p.startIndex, order: 0, reqs: [{ deleteContentRange: { range: { startIndex: p.startIndex, endIndex: p.endIndex } } }] });
      // 2) insert "text\n" at the start of the target bullet: the new paragraph inherits the target's bullet + paragraph style
      const text = e.newText;
      prims.push({
        anchor: target.startIndex,
        order: 1, // after any replace on the target itself, so the moved bullet lands before it
        reqs: [{ insertText: { location: { index: target.startIndex }, text: text + "\n" } }, ...styleRequest(target.startIndex, docLen(text), p.dominantStyle)],
      });
    }
  }

  // Disallow two different primitive ops on the same paragraph range (e.g. remove + replace)
  const seen = new Map<string, number>();
  for (const e of edits) seen.set(e.bulletId, (seen.get(e.bulletId) ?? 0) + 1);
  for (const [id, count] of seen) if (count > 1) throw new EditConflictError(`More than one approved edit targets ${id}.`);

  prims.sort((a, b) => b.anchor - a.anchor || a.order - b.order);
  return prims.flatMap((p) => p.reqs);
}

/** Simulates the requests on plain paragraph text - used by tests and for a local preview. */
export function simulate(s: ResumeStructure, edits: ApprovedEdit[]): string[] {
  const out = s.paragraphs.map((p) => ({ id: p.id, text: p.text, isBullet: p.isBullet }));
  const removed = new Set<string>();
  const replaced = new Map<string, string>();
  const inserts = new Map<string, string[]>();
  for (const e of edits) {
    if (e.kind === "remove") removed.add(e.bulletId);
    if (e.kind === "replace_text") replaced.set(e.bulletId, e.newText);
    if (e.kind === "move") {
      removed.add(e.bulletId);
      inserts.set(e.beforeBulletId, [...(inserts.get(e.beforeBulletId) ?? []), e.newText]);
    }
  }
  const res: string[] = [];
  for (const p of out) {
    for (const ins of inserts.get(p.id) ?? []) res.push(ins);
    if (removed.has(p.id)) continue;
    res.push(replaced.get(p.id) ?? p.text);
  }
  return res;
}
