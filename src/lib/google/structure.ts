import type { docs_v1 } from "googleapis";

/** A single paragraph of a Google Doc with the exact indices needed to edit it. */
export interface ResumeParagraph {
  id: string;            // stable within a doc revision: "p<n>"
  n: number;
  text: string;          // without trailing newline
  startIndex: number;
  endIndex: number;      // exclusive; includes the trailing "\n"
  isBullet: boolean;
  namedStyle: string;    // NORMAL_TEXT | HEADING_1 ...
  allBold: boolean;
  inTable: boolean;
  dominantStyle: docs_v1.Schema$TextStyle | null; // style of the longest text run
}

export interface ResumeStructure {
  docId: string;
  title: string;
  revisionId: string | null;
  paragraphs: ResumeParagraph[];
}

function collect(content: docs_v1.Schema$StructuralElement[] | undefined, out: Omit<ResumeParagraph, "id" | "n">[], inTable: boolean) {
  for (const el of content ?? []) {
    if (el.paragraph) {
      const p = el.paragraph;
      let text = "";
      let longest = -1;
      let dominant: docs_v1.Schema$TextStyle | null = null;
      let boldChars = 0;
      let visibleChars = 0;
      for (const pe of p.elements ?? []) {
        const run = pe.textRun;
        if (!run?.content) continue;
        text += run.content;
        const visible = run.content.replace(/\n/g, "").trim().length;
        visibleChars += visible;
        if (run.textStyle?.bold) boldChars += visible;
        if (visible > longest) {
          longest = visible;
          dominant = run.textStyle ?? null;
        }
      }
      out.push({
        text: text.replace(/\n$/, ""),
        startIndex: el.startIndex ?? 0,
        endIndex: el.endIndex ?? 0,
        isBullet: !!p.bullet,
        namedStyle: p.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT",
        allBold: visibleChars > 0 && boldChars === visibleChars,
        inTable,
        dominantStyle: dominant,
      });
    } else if (el.table) {
      for (const row of el.table.tableRows ?? []) for (const cell of row.tableCells ?? []) collect(cell.content, out, true);
    } else if (el.tableOfContents) {
      collect(el.tableOfContents.content, out, inTable);
    }
  }
}

export function parseDocument(doc: docs_v1.Schema$Document): ResumeStructure {
  const raw: Omit<ResumeParagraph, "id" | "n">[] = [];
  collect(doc.body?.content, raw, false);
  return {
    docId: doc.documentId ?? "",
    title: doc.title ?? "",
    revisionId: doc.revisionId ?? null,
    paragraphs: raw.map((p, n) => ({ ...p, n, id: `p${n}` })),
  };
}

export function structureToText(s: ResumeStructure): string {
  return s.paragraphs.map((p) => p.text).join("\n");
}

/** Human/AI-readable view where every paragraph carries its id, used for recommendations. */
export function structureToAnnotated(s: ResumeStructure): string {
  return s.paragraphs
    .filter((p) => p.text.trim())
    .map((p) => {
      const tag = p.isBullet ? "BULLET" : p.namedStyle.startsWith("HEADING") || looksLikeHeading(p) ? "HEADING" : "LINE";
      return `[${p.id}|${tag}] ${p.text}`;
    })
    .join("\n");
}

const STANDARD_HEADINGS = [
  "summary", "professional summary", "profile", "experience", "work experience", "professional experience",
  "employment", "employment history", "education", "skills", "technical skills", "core skills", "certifications",
  "projects", "publications", "awards", "leadership", "volunteer experience", "languages", "additional information",
  "selected achievements", "key achievements", "core competencies", "relevant experience", "other experience",
];

export function looksLikeHeading(p: ResumeParagraph): boolean {
  const t = p.text.trim();
  if (!t || p.isBullet || t.length > 40) return false;
  if (p.namedStyle.startsWith("HEADING") || p.namedStyle === "TITLE") return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  const isCaps = letters.length >= 3 && letters === letters.toUpperCase();
  return isCaps || STANDARD_HEADINGS.includes(t.toLowerCase().replace(/[:]/g, ""));
}

export function isStandardHeading(t: string): boolean {
  return STANDARD_HEADINGS.includes(t.trim().toLowerCase().replace(/[:]/g, ""));
}

export function bullets(s: ResumeStructure): ResumeParagraph[] {
  return s.paragraphs.filter((p) => p.isBullet && p.text.trim());
}
