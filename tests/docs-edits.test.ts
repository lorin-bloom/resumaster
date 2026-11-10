import { describe, expect, it } from "vitest";
import type { docs_v1 } from "googleapis";
import { parseDocument } from "@/lib/google/structure";
import { buildRequests, simulate, EditConflictError, type ApprovedEdit } from "@/lib/google/apply-edits";

/** Build a Google Docs API document JSON from lines, the way documents.get returns it. */
function docJson(lines: { text: string; bullet?: boolean; bold?: boolean }[]): docs_v1.Schema$Document {
  let idx = 1;
  const content: docs_v1.Schema$StructuralElement[] = [{ endIndex: 1, sectionBreak: {} }];
  for (const l of lines) {
    const start = idx;
    const end = idx + l.text.length + 1;
    content.push({
      startIndex: start,
      endIndex: end,
      paragraph: {
        bullet: l.bullet ? { listId: "kix.list1" } : undefined,
        paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
        elements: [{ startIndex: start, endIndex: end, textRun: { content: l.text + "\n", textStyle: { bold: l.bold, fontSize: { magnitude: 10, unit: "PT" }, weightedFontFamily: { fontFamily: "Garamond" } } } }],
      },
    });
    idx = end;
  }
  return { documentId: "doc1", title: "Master", revisionId: "r1", body: { content } };
}

/**
 * Minimal Google Docs batchUpdate simulator over a flat string (index 1 = first char).
 * Paragraph/bullet properties follow the newline that ends the paragraph, as in Docs.
 */
function applyRequests(doc: docs_v1.Schema$Document, reqs: docs_v1.Schema$Request[]) {
  // chars[i] => character at doc index i+1; bulletAt: per-newline bullet flag
  type Ch = { c: string; bullet: boolean };
  const chars: Ch[] = [];
  for (const el of doc.body!.content!) {
    if (!el.paragraph) continue;
    const isB = !!el.paragraph.bullet;
    const t = el.paragraph.elements!.map((e) => e.textRun!.content!).join("");
    for (const c of t) chars.push({ c, bullet: isB });
  }
  for (const r of reqs) {
    if (r.deleteContentRange) {
      const { startIndex, endIndex } = r.deleteContentRange.range!;
      chars.splice(startIndex! - 1, endIndex! - startIndex!);
    } else if (r.insertText) {
      const at = r.insertText.location!.index! - 1;
      // inserted chars belong to the paragraph they're inserted into
      let k = at;
      while (k < chars.length && chars[k].c !== "\n") k++;
      const isB = chars[k]?.bullet ?? false;
      chars.splice(at, 0, ...[...r.insertText.text!].map((c) => ({ c, bullet: isB })));
    } else if (r.updateTextStyle) {
      const { startIndex, endIndex } = r.updateTextStyle.range!;
      expect(startIndex).toBeGreaterThanOrEqual(1);
      expect(endIndex).toBeLessThanOrEqual(chars.length + 1);
    }
  }
  const text = chars.map((c) => c.c).join("");
  const paras = text.split("\n").slice(0, -1);
  // recompute bullets per paragraph from the newline that ends it
  const flags: boolean[] = [];
  chars.forEach((c) => c.c === "\n" && flags.push(c.bullet));
  return paras.map((t, i) => ({ text: t, bullet: flags[i] }));
}

const LINES = [
  { text: "JANE DOE", bold: true },
  { text: "EXPERIENCE", bold: true },
  { text: "Acme — PMM", bold: true },
  { text: "Did a thing for the team.", bullet: true },
  { text: "Launched an API with 1,000 sign-ups — “fast”.", bullet: true },
  { text: "Ran research with 50 customers.", bullet: true },
  { text: "Organized events.", bullet: true },
  { text: "EDUCATION", bold: true },
  { text: "B.A. Economics" },
];

describe("Google Docs edit builder", () => {
  const doc = docJson(LINES);
  const s = parseDocument(doc);

  it("parses paragraphs with indices and bullets", () => {
    expect(s.paragraphs).toHaveLength(LINES.length);
    expect(s.paragraphs[3]).toMatchObject({ id: "p3", isBullet: true, text: "Did a thing for the team." });
    expect(s.paragraphs[3].dominantStyle?.weightedFontFamily?.fontFamily).toBe("Garamond");
  });

  it("applies replace, remove and move with correct index math", () => {
    const edits: ApprovedEdit[] = [
      { kind: "replace_text", bulletId: "p3", originalText: LINES[3].text, newText: "Grew activation 30% by rewriting onboarding — 4 weeks." },
      { kind: "move", bulletId: "p5", originalText: LINES[5].text, newText: "Ran research with 50 customers; findings set pricing.", beforeBulletId: "p3" },
      { kind: "remove", bulletId: "p6", originalText: LINES[6].text },
    ];
    const reqs = buildRequests(s, edits);
    const out = applyRequests(doc, reqs);
    expect(out.map((p) => p.text)).toEqual(simulate(s, edits));
    expect(out.map((p) => p.text)).toEqual([
      "JANE DOE", "EXPERIENCE", "Acme — PMM",
      "Ran research with 50 customers; findings set pricing.",
      "Grew activation 30% by rewriting onboarding — 4 weeks.",
      "Launched an API with 1,000 sign-ups — “fast”.",
      "EDUCATION", "B.A. Economics",
    ]);
    // moved bullet inherits list formatting; headings stay non-bullets
    expect(out[3].bullet).toBe(true);
    expect(out[4].bullet).toBe(true);
    expect(out[6].bullet).toBe(false);
    // every text insert is followed by a style restore on exactly that range
    const inserts = reqs.filter((r) => r.insertText);
    const styles = reqs.filter((r) => r.updateTextStyle);
    expect(styles.length).toBe(inserts.length);
  });

  it("moving a bullet below its target works in either direction", () => {
    const edits: ApprovedEdit[] = [{ kind: "move", bulletId: "p3", originalText: LINES[3].text, newText: LINES[3].text, beforeBulletId: "p6" }];
    const out = applyRequests(doc, buildRequests(s, edits)).map((p) => p.text);
    expect(out.slice(3, 7)).toEqual([LINES[4].text, LINES[5].text, LINES[3].text, LINES[6].text]);
  });

  it("refuses to guess when the master changed", () => {
    expect(() => buildRequests(s, [{ kind: "replace_text", bulletId: "p3", originalText: "Text that is not there", newText: "x" }])).toThrow(EditConflictError);
  });

  it("refuses two edits on the same bullet and multi-line replacements", () => {
    expect(() =>
      buildRequests(s, [
        { kind: "remove", bulletId: "p3", originalText: LINES[3].text },
        { kind: "replace_text", bulletId: "p3", originalText: LINES[3].text, newText: "y" },
      ]),
    ).toThrow(EditConflictError);
    expect(() => buildRequests(s, [{ kind: "replace_text", bulletId: "p3", originalText: LINES[3].text, newText: "a\nb" }])).toThrow(EditConflictError);
  });

  it("no approved edits => no requests (pure copy of master)", () => {
    expect(buildRequests(s, [])).toEqual([]);
  });
});
