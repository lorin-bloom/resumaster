import { extractText, getDocumentProxy } from "unpdf";
import { isStandardHeading } from "../google/structure";

/**
 * ATS-readability validation of an exported resume PDF.
 *
 * This checks what common ATS parsers depend on — a real text layer, sane reading order,
 * conventional headings, intact employer/title/date strings, every approved bullet present —
 * by extracting text the way a parser would and comparing it to the source document.
 * It deliberately does NOT produce a "score": no tool can know a given employer's
 * proprietary screening logic.
 */

export type CheckStatus = "pass" | "warn" | "fail";
export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}
export interface ValidationReport {
  ok: boolean;               // no "fail" checks
  pageCount: number;
  checks: Check[];
  extractedText: string;
}

export interface ValidationExpectations {
  paragraphs: { text: string; isBullet: boolean; isHeading: boolean }[]; // source doc, in order
  approvedTexts: string[];                       // final text of every accepted/edited bullet
  roles: { employer: string; title: string; dates: string }[];
  maxPages?: number | null;                      // page count of the master PDF
}

const LIGATURES: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl" };

export function normalize(s: string) {
  return s
    .replace(/[ﬀ-ﬄ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[•●▪◦‣∙·○■□➢►–]/g, " ")
    .replace(/(\w)-\s+(\w)/g, "$1$2") // soft hyphenation at line breaks
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Squeezes out all whitespace - robust against line-wrapping differences. */
const squeeze = (s: string) => normalize(s).replace(/[^a-z0-9%$+#&@./,'"-]/g, "");

export async function extractPdf(buf: Uint8Array | Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { totalPages, pages: text as string[], visualPages: await visualOrder(pdf) };
}

/**
 * Row-by-row reading order (top-to-bottom, then left-to-right), which is how many ATS
 * parsers reconstruct text. Multi-column layouts that look fine in content-stream order
 * get interleaved here.
 */
async function visualOrder(pdf: Awaited<ReturnType<typeof getDocumentProxy>>): Promise<string[]> {
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const items = (tc.items as { str?: string; transform?: number[] }[])
      .filter((it) => it.str && it.transform)
      .map((it) => ({ s: it.str!, x: it.transform![4], y: it.transform![5] }));
    items.sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x));
    const lines: string[] = [];
    let lastY = Number.NaN;
    for (const it of items) {
      if (Math.abs(it.y - lastY) > 2) lines.push(it.s);
      else lines[lines.length - 1] += " " + it.s;
      lastY = it.y;
    }
    out.push(lines.join("\n"));
  }
  return out;
}

function orderRate(paragraphs: { text: string }[], haystack: string) {
  const positions: number[] = [];
  for (const p of paragraphs) {
    const key = squeeze(p.text).slice(0, 40);
    if (key.length < 12) continue;
    const at = haystack.indexOf(key);
    if (at >= 0) positions.push(at);
  }
  let inversions = 0;
  for (let i = 1; i < positions.length; i++) if (positions[i] < positions[i - 1]) inversions++;
  return { inversions, rate: positions.length > 1 ? 1 - inversions / (positions.length - 1) : 1 };
}

export async function validatePdf(buf: Uint8Array | Buffer, exp: ValidationExpectations): Promise<ValidationReport> {
  const checks: Check[] = [];
  const { totalPages, pages, visualPages } = await extractPdf(buf);
  const raw = pages.join("\n");
  const sq = squeeze(raw);
  const sourceText = exp.paragraphs.map((p) => p.text).join("\n");

  // 1. Machine-readable text layer
  const ratio = squeeze(sourceText).length ? sq.length / squeeze(sourceText).length : 0;
  checks.push({
    id: "text_layer",
    label: "Machine-readable text",
    status: sq.length < 200 ? "fail" : ratio < 0.85 ? "warn" : "pass",
    detail: sq.length < 200 ? "Almost no extractable text — the PDF may be image-based." : `Extracted ${raw.length.toLocaleString()} characters (${Math.round(ratio * 100)}% of source).`,
  });

  // 2. Corrupted / unmapped glyphs
  const bad = raw.match(/[�-]/g) ?? [];
  const lig = raw.match(/[ﬀ-ﬄ]/g) ?? [];
  checks.push({
    id: "glyphs",
    label: "No corrupted characters",
    status: bad.length ? "fail" : lig.length ? "warn" : "pass",
    detail: bad.length
      ? `${bad.length} unreadable glyph(s) found — a font without a proper text mapping was likely used.`
      : lig.length
        ? `${lig.length} typographic ligature(s) (e.g. "ﬁ") — most parsers handle these, some older ones split words.`
        : "All characters map to readable text.",
  });

  // 3. Coverage: every source paragraph appears in the extracted text (catches clipping/missing text)
  const missing = exp.paragraphs.filter((p) => p.text.trim() && !sq.includes(squeeze(p.text)));
  checks.push({
    id: "coverage",
    label: "No missing or clipped text",
    status: missing.length === 0 ? "pass" : missing.length <= 1 && missing.every((m) => m.text.length < 25) ? "warn" : "fail",
    detail: missing.length ? `Not found in PDF text: ${missing.slice(0, 4).map((m) => `“${m.text.slice(0, 60)}”`).join("; ")}${missing.length > 4 ? ` (+${missing.length - 4} more)` : ""}` : "Every paragraph of the document is present in the PDF text.",
  });

  // 4. Approved content represented exactly
  const missingApproved = exp.approvedTexts.filter((t) => !sq.includes(squeeze(t)));
  checks.push({
    id: "approved",
    label: "Approved edits present",
    status: missingApproved.length ? "fail" : "pass",
    detail: exp.approvedTexts.length === 0 ? "No edits were approved; content matches the master." : missingApproved.length ? `${missingApproved.length} approved bullet(s) not found verbatim.` : `All ${exp.approvedTexts.length} approved bullet(s) found verbatim.`,
  });

  // 5. Reading order, in both content-stream order and row-by-row visual order
  const stream = orderRate(exp.paragraphs, sq);
  const visual = orderRate(exp.paragraphs, squeeze(visualPages.join("\n")));
  const worst = Math.min(stream.rate, visual.rate);
  checks.push({
    id: "order",
    label: "Correct text extraction order",
    status: worst >= 0.97 ? "pass" : worst >= 0.85 ? "warn" : "fail",
    detail:
      worst >= 0.97
        ? "Text extracts top-to-bottom in document order, whether parsed by stream or row by row."
        : `${Math.max(stream.inversions, visual.inversions)} paragraph(s) out of order${visual.rate < stream.rate ? " when read row by row" : ""} — multi-column layouts, tables, or text boxes can scramble parsing.`,
  });

  // 6. Section headings
  const headings = exp.paragraphs.filter((p) => p.isHeading).map((p) => p.text.trim());
  const nonStd = headings.filter((h) => !isStandardHeading(h));
  const hasExp = headings.some((h) => /experience|employment/i.test(h));
  checks.push({
    id: "headings",
    label: "Standard section headings",
    status: !hasExp ? "warn" : nonStd.length > 2 ? "warn" : "pass",
    detail: !hasExp ? "No “Experience” heading detected — parsers use it to find your work history." : nonStd.length ? `Non-standard: ${nonStd.join(", ")}. Usually fine; conventional names parse most reliably.` : `Found: ${headings.join(", ")}.`,
  });

  // 7. Employers, titles, dates
  const roleProblems: string[] = [];
  let lastPos = -1;
  let roleOrderOk = true;
  for (const r of exp.roles) {
    for (const [k, v] of [["employer", r.employer], ["title", r.title], ["dates", r.dates]] as const) {
      if (v && !sq.includes(squeeze(v))) roleProblems.push(`${k} “${v}”`);
    }
    const pos = r.employer ? sq.indexOf(squeeze(r.employer)) : -1;
    if (pos >= 0) {
      if (pos < lastPos) roleOrderOk = false;
      lastPos = pos;
    }
  }
  checks.push({
    id: "roles",
    label: "Employers, titles, and dates intact",
    status: roleProblems.length ? "fail" : !roleOrderOk ? "warn" : exp.roles.length ? "pass" : "warn",
    detail: roleProblems.length ? `Not found: ${roleProblems.slice(0, 5).join("; ")}` : !exp.roles.length ? "No roles were identified to check." : !roleOrderOk ? "Roles extract in a different order than the document." : `${exp.roles.length} role(s) verified.`,
  });

  // 8. Bullets
  const bulletParas = exp.paragraphs.filter((p) => p.isBullet && p.text.trim());
  const oddBulletGlyph = /[]/.test(raw);
  checks.push({
    id: "bullets",
    label: "Bullet formatting",
    status: oddBulletGlyph ? "warn" : "pass",
    detail: oddBulletGlyph ? "Symbol-font bullet glyphs detected; some parsers render these as junk characters." : `${bulletParas.length} bullets use standard list formatting.`,
  });

  // 9. Page overflow
  const lastPageLen = squeeze(pages[pages.length - 1] ?? "").length;
  const avg = sq.length / Math.max(1, totalPages);
  const overflow = exp.maxPages != null && totalPages > exp.maxPages;
  const orphan = totalPages > 1 && lastPageLen < avg * 0.12;
  checks.push({
    id: "pages",
    label: "No unexpected page overflow",
    status: overflow ? "fail" : orphan ? "warn" : "pass",
    detail: overflow ? `${totalPages} pages vs ${exp.maxPages} in your master — edits pushed content onto a new page.` : orphan ? `Last page holds only a few lines — consider tightening.` : `${totalPages} page(s)${exp.maxPages != null ? `, same as master` : ""}.`,
  });

  return { ok: !checks.some((c) => c.status === "fail"), pageCount: totalPages, checks, extractedText: raw };
}
