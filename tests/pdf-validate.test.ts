import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { validatePdf } from "@/lib/pdf/validate";

const PARAS = [
  { text: "JANE DOE", isBullet: false, isHeading: false },
  { text: "EXPERIENCE", isBullet: false, isHeading: true },
  { text: "Acme Corp - Senior Product Marketing Manager", isBullet: false, isHeading: false },
  { text: "Jan 2021 - Present", isBullet: false, isHeading: false },
  { text: "Launched a real-time data API that reached 1,400 developer sign-ups in 90 days.", isBullet: true, isHeading: false },
  { text: "Built a win/loss program interviewing 60+ buyers; enterprise win rate rose from 18% to 26%.", isBullet: true, isHeading: false },
  { text: "Globex - Product Marketing Manager", isBullet: false, isHeading: false },
  { text: "Jun 2018 - Dec 2020", isBullet: false, isHeading: false },
  { text: "Cut time-to-first-API-call from 3 days to 40 minutes by rewriting docs landing pages.", isBullet: true, isHeading: false },
  { text: "EDUCATION", isBullet: false, isHeading: true },
  { text: "B.A. Economics, University of Michigan", isBullet: false, isHeading: false },
  { text: "SKILLS", isBullet: false, isHeading: true },
  { text: "Positioning, launch strategy, pricing and packaging, SQL", isBullet: false, isHeading: false },
];
const ROLES = [
  { employer: "Acme Corp", title: "Senior Product Marketing Manager", dates: "Jan 2021 - Present" },
  { employer: "Globex", title: "Product Marketing Manager", dates: "Jun 2018 - Dec 2020" },
];

async function makePdf(paras: { text: string; isBullet: boolean }[], opts: { pages?: number; skip?: number[]; twoColumn?: boolean } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = opts.pages ?? 1;
  const per = Math.ceil(paras.length / pages);
  for (let pi = 0; pi < pages; pi++) {
    const page = pdf.addPage([612, 792]);
    const chunk = paras.slice(pi * per, (pi + 1) * per);
    chunk.forEach((p, i) => {
      if (opts.skip?.includes(pi * per + i)) return;
      // twoColumn: first half in a left column, second half in a right column at the same heights
      // (a sidebar layout) - row-wise extraction then interleaves the two halves.
      const half = Math.ceil(chunk.length / 2);
      const right = !!opts.twoColumn && i >= half;
      const x = right ? 320 : 50;
      const y = 740 - (opts.twoColumn ? i % half : i) * 22;
      page.drawText((p.isBullet ? "- " : "") + p.text, { x, y, size: 9, font, maxWidth: opts.twoColumn ? 260 : 520 });
    });
  }
  return pdf.save();
}

describe("ATS PDF validation", () => {
  it("passes a clean single-column resume", async () => {
    const r = await validatePdf(await makePdf(PARAS), { paragraphs: PARAS, approvedTexts: [PARAS[4].text], roles: ROLES, maxPages: 1 });
    const failed = r.checks.filter((c) => c.status !== "pass");
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.pageCount).toBe(1);
  });

  it("fails when approved content or text is missing (clipping)", async () => {
    const r = await validatePdf(await makePdf(PARAS, { skip: [5] }), { paragraphs: PARAS, approvedTexts: [PARAS[5].text], roles: ROLES, maxPages: 1 });
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === "coverage")?.status).toBe("fail");
    expect(r.checks.find((c) => c.id === "approved")?.status).toBe("fail");
  });

  it("fails on page overflow vs. the master", async () => {
    const r = await validatePdf(await makePdf(PARAS, { pages: 2 }), { paragraphs: PARAS, approvedTexts: [], roles: ROLES, maxPages: 1 });
    expect(r.checks.find((c) => c.id === "pages")?.status).toBe("fail");
  });

  it("fails when an employer/date is corrupted", async () => {
    const broken = PARAS.map((p, i) => (i === 3 ? { ...p, text: "Jan 2O21 - Present" } : p));
    const r = await validatePdf(await makePdf(broken), { paragraphs: PARAS, approvedTexts: [], roles: ROLES, maxPages: 1 });
    expect(r.checks.find((c) => c.id === "roles")?.status).toBe("fail");
  });

  it("flags scrambled extraction order from two-column layouts", async () => {
    const r = await validatePdf(await makePdf(PARAS, { twoColumn: true }), { paragraphs: PARAS, approvedTexts: [], roles: ROLES, maxPages: 1 });
    const order = r.checks.find((c) => c.id === "order")!;
    expect(["warn", "fail"]).toContain(order.status);
  });

  it("fails an image-only / empty PDF", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const r = await validatePdf(await pdf.save(), { paragraphs: PARAS, approvedTexts: [], roles: ROLES, maxPages: 1 });
    expect(r.checks.find((c) => c.id === "text_layer")?.status).toBe("fail");
  });
});
