/**
 * FICTIONAL demo data. Every person, company, and number here is invented for the public portfolio demo.
 * Nothing in this file comes from a real resume.
 */
import type { ResumeStructure } from "../google/structure";
import type { Accomplishment } from "../knowledge";

type Line = { text: string; bullet?: boolean; heading?: boolean; bold?: boolean };

export function makeStructure(title: string, lines: Line[]): ResumeStructure {
  let idx = 1;
  return {
    docId: "demo",
    title,
    revisionId: "demo-1",
    paragraphs: lines.map((l, n) => {
      const start = idx;
      idx += l.text.length + 1;
      return {
        id: `p${n}`, n, text: l.text, startIndex: start, endIndex: idx, isBullet: !!l.bullet,
        namedStyle: l.heading ? "HEADING_2" : "NORMAL_TEXT", allBold: !!l.bold || !!l.heading, inTable: false,
        dominantStyle: { fontSize: { magnitude: 10.5, unit: "PT" }, weightedFontFamily: { fontFamily: "Arial", weight: 400 } },
      };
    }),
  };
}

export const DEMO_RESUME = makeStructure("Jordan Rivera — Master Resume", [
  { text: "JORDAN RIVERA", bold: true },
  { text: "Product Marketing & GTM Leader · Oakland, CA · jordan.rivera@example.com" },
  { text: "SUMMARY", heading: true },
  { text: "Product marketer with 9 years launching B2B data and payments products. Known for turning customer research into positioning that sales teams actually use." },
  { text: "EXPERIENCE", heading: true },
  { text: "Cobalt Analytics — Senior Product Marketing Manager", bold: true },
  { text: "Jan 2021 – Present · San Francisco, CA" },
  { text: "Responsible for product marketing for the analytics platform and various launches.", bullet: true },
  { text: "Led positioning and launch of Cobalt Streams, a real-time data API; reached 1,400 developer sign-ups in the first 90 days.", bullet: true },
  { text: "Built a win/loss program interviewing 60+ buyers per year; findings reshaped pricing tiers and lifted enterprise win rate from 18% to 26%.", bullet: true },
  { text: "Created sales enablement materials including battlecards, pitch decks, and demo scripts for a 45-person sales team.", bullet: true },
  { text: "Partnered with 3 cloud marketplace partners to co-market integrations, sourcing $2.1M in pipeline.", bullet: true },
  { text: "Harbor Payments — Product Marketing Manager", bold: true },
  { text: "Jun 2018 – Dec 2020 · Remote" },
  { text: "Managed the go-to-market for Harbor's developer SDKs across iOS, Android, and web.", bullet: true },
  { text: "Rewrote developer documentation landing pages, reducing time-to-first-API-call from 3 days to 40 minutes (measured via onboarding telemetry).", bullet: true },
  { text: "Ran pricing research with 200 SMB merchants that informed a usage-based pricing launch.", bullet: true },
  { text: "Organized company booth at industry conferences.", bullet: true },
  { text: "Brightline Media — Marketing Associate", bold: true },
  { text: "Aug 2015 – May 2018 · New York, NY" },
  { text: "Produced weekly email newsletter for 80,000 subscribers; grew open rate from 21% to 34%.", bullet: true },
  { text: "Supported campaign launches across paid social and search.", bullet: true },
  { text: "EDUCATION", heading: true },
  { text: "B.A. Economics, University of Michigan — 2015" },
  { text: "SKILLS", heading: true },
  { text: "Positioning & messaging · Launch strategy · Win/loss and customer research · Pricing & packaging · Sales enablement · SQL · Amplitude · Figma" },
]);

const acc = (id: number, employer: string, title: string, canonical: string, metrics: [string, string][], themes: string[], status: Accomplishment["status"], variants: [string, string][]): Accomplishment => ({
  id, role_id: null, employer, title, canonical, status, notes: null, open_discrepancies: status === "disputed" ? 1 : 0,
  metrics: metrics.map(([value, context]) => ({ value, context })), skills: [], themes, job_categories: [],
  variants: variants.map(([text, framing], i) => ({ id: id * 10 + i, accomplishment_id: id, text, framing, source_document_id: null, source_title: "Fictional prior resume", origin: "resume" })),
});

export const DEMO_BANK: Accomplishment[] = [
  acc(1, "Cobalt Analytics", "Senior Product Marketing Manager", "Led positioning and launch of Cobalt Streams (real-time data API). 1,400 developer sign-ups in first 90 days.", [["1,400", "developer sign-ups in 90 days"]], ["developer marketing", "launch", "API"], "verified", [
    ["Owned end-to-end launch of Cobalt Streams, a real-time data API, driving 1,400 developer sign-ups in 90 days.", "launch"],
    ["Defined developer-first positioning for Cobalt Streams after 25 interviews with data engineers.", "customer insight"],
  ]),
  acc(2, "Cobalt Analytics", "Senior Product Marketing Manager", "Ran the win/loss program (60+ buyer interviews/yr). Findings drove a pricing-tier redesign; enterprise win rate rose from 18% to 26%.", [["60+", "buyer interviews per year"], ["18% → 26%", "enterprise win rate"]], ["customer research", "pricing", "enterprise"], "verified", [
    ["Built a win/loss program interviewing 60+ buyers per year; findings reshaped pricing tiers and lifted enterprise win rate from 18% to 26%.", "revenue impact"],
  ]),
  acc(3, "Cobalt Analytics", "Senior Product Marketing Manager", "Defined usage-based packaging for the analytics API with product and finance; adopted by 300+ accounts in two quarters.", [["300+", "accounts adopting new packaging in two quarters"]], ["pricing", "packaging", "API"], "verified", [
    ["Co-designed usage-based packaging for the analytics API with Product and Finance; 300+ accounts adopted within two quarters.", "pricing & packaging"],
  ]),
  acc(4, "Cobalt Analytics", "Senior Product Marketing Manager", "Co-marketed integrations with 3 cloud marketplace partners. Pipeline sourced is reported as $2.1M in one resume and $3.4M in another.", [["$2.1M / $3.4M", "partner-sourced pipeline (conflicting)"]], ["partnerships"], "disputed", [
    ["Partnered with 3 cloud marketplace partners to co-market integrations, sourcing $2.1M in pipeline.", "partnerships"],
    ["Drove $3.4M in partner-sourced pipeline through cloud marketplace co-marketing.", "revenue impact"],
  ]),
  acc(5, "Harbor Payments", "Product Marketing Manager", "Rewrote developer docs landing pages; time-to-first-API-call fell from 3 days to 40 minutes (onboarding telemetry).", [["3 days → 40 min", "time to first API call"]], ["developer experience", "docs", "activation"], "verified", [
    ["Rewrote developer documentation landing pages, reducing time-to-first-API-call from 3 days to 40 minutes.", "developer experience"],
  ]),
  acc(6, "Harbor Payments", "Product Marketing Manager", "Ran a developer advisory council of 12 customer engineers that met quarterly to review SDK roadmap and messaging.", [["12", "customer engineers on council"]], ["developer community", "customer insight"], "unverified", [
    ["Launched a 12-member developer advisory council that shaped SDK roadmap and messaging.", "community"],
  ]),
];

export const DEMO_DIRECTION =
  "I want to move closer to developer platforms and AI infrastructure — products where the user is a builder. I'm most energized by turning technical capability into a clear story and by launch work.";

export const DEMO_PREFERENCES = [
  "Keep bullets under 30 words.",
  "Don't use corporate buzzwords like 'spearheaded' or 'synergy'.",
  "Don't exaggerate ownership — say 'partnered' when I didn't lead.",
  "Use the exact JD terminology when it accurately describes my work.",
];

export const SAMPLE_JD = `Northwind Labs — Product Marketing Lead, Developer Platform

About Northwind Labs
Northwind Labs builds foundation-model APIs used by 40,000+ developers to add reasoning and retrieval to their products. We recently raised our Series C and are scaling our developer platform from self-serve to enterprise.

The role
We're hiring a Product Marketing Lead for our Developer Platform. You'll own positioning, launches, and pricing narrative for our API, SDKs, and agent tooling. You'll work with product, developer relations, and sales to grow self-serve adoption and help enterprise teams understand why to build on Northwind.

What you'll do
- Own positioning and messaging for the API platform, SDKs, and new agent tooling
- Plan and run tier-1 launches end to end, from narrative to developer activation metrics
- Run customer and developer research (interviews, win/loss) and turn insight into product and pricing decisions
- Partner with Developer Relations to improve developer onboarding and time-to-first-call
- Shape pricing and packaging narrative for usage-based plans as we move upmarket
- Equip sales with enablement for technical buyers

What we're looking for
- 7+ years of product marketing, with significant time on developer-facing or API products
- Track record of launches with measurable adoption outcomes
- Deep comfort with technical audiences; you can hold your own with engineers
- Experience with usage-based pricing and packaging
- Strong customer research skills
- Nice to have: experience with AI/ML products; experience taking a PLG motion upmarket`;
