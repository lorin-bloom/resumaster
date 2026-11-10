/**
 * PRECOMPUTED example output for the fictional candidate + SAMPLE_JD.
 * Shown in the public demo with a "Precomputed example" label so it is never confused
 * with a live model run. Same shape as live output.
 */
import type { FitAnalysis, JDAnalysis, EditPlan } from "../ai/schemas";

export const PRECOMPUTED_JDA: JDAnalysis = {
  company: "Northwind Labs",
  job_title: "Product Marketing Lead, Developer Platform",
  seniority: "Senior IC / Lead (7+ years)",
  team_or_function: "Product Marketing — Developer Platform",
  industry: "AI foundation-model APIs",
  business_context:
    "Series C AI API company with 40,000+ developers, moving from self-serve to enterprise. This hire owns the story for the API, SDKs, and new agent tooling as the buyer shifts from individual developers to platform teams.",
  responsibilities: [
    "Positioning and messaging for API, SDKs, and agent tooling",
    "Tier-1 launches end to end, measured on developer activation",
    "Customer and developer research, including win/loss",
    "Improve onboarding and time-to-first-call with DevRel",
    "Usage-based pricing and packaging narrative while moving upmarket",
    "Sales enablement for technical buyers",
  ],
  required_qualifications: [
    "7+ years product marketing, significant time on developer/API products",
    "Launches with measurable adoption outcomes",
    "Credibility with technical audiences",
    "Usage-based pricing and packaging experience",
    "Strong customer research skills",
  ],
  preferred_qualifications: ["AI/ML product experience", "Taking a PLG motion upmarket"],
  keywords: [
    { term: "developer platform", importance: "critical" },
    { term: "positioning and messaging", importance: "critical" },
    { term: "tier-1 launches", importance: "critical" },
    { term: "developer activation", importance: "important" },
    { term: "time-to-first-call", importance: "important" },
    { term: "usage-based pricing", importance: "important" },
    { term: "win/loss", importance: "important" },
    { term: "technical buyers", importance: "nice_to_have" },
    { term: "PLG", importance: "nice_to_have" },
  ],
  hiring_priorities: [
    { priority: "Proven developer/API product marketing", why_it_matters: "The core audience is builders; generic B2B PMMs ramp slowly and lose engineers' trust." },
    { priority: "Launches tied to adoption metrics", why_it_matters: "They will judge launches by activation, not by awareness." },
    { priority: "Usage-based pricing narrative", why_it_matters: "Moving upmarket on consumption pricing is the hardest messaging problem they have this year." },
    { priority: "Research-driven positioning", why_it_matters: "Win/loss and developer research are explicitly called out as inputs to product and pricing." },
    { priority: "Onboarding / time-to-first-call", why_it_matters: "Self-serve growth depends on activation; they want a PMM who works on the funnel, not just the launch." },
  ],
  business_problems: [
    "Explaining why enterprises should build on Northwind vs. larger model providers",
    "Packaging usage-based plans for enterprise procurement",
    "Launching agent tooling into a crowded, fast-moving market",
    "Keeping self-serve activation high while adding enterprise motions",
  ],
  ownership_level: "Owns positioning and launches for the platform; strong cross-functional influence, likely no direct reports initially.",
  transferable_skills_valued: ["Payments/fintech API experience", "Data-platform launches", "Pricing research"],
  unknowns: ["Whether the role manages people", "How much of agent tooling is GA vs. preview"],
};

export const PRECOMPUTED_FIT: FitAnalysis = {
  verdict: "Strong fit on developer launches, research, and usage-based pricing; the main gap is no direct AI/ML product experience.",
  fit_level: "strong",
  positioning:
    "Position Jordan as a developer-platform product marketer who measures launches by activation: an API launch with 1,400 sign-ups, a 3-days-to-40-minutes onboarding fix, and usage-based packaging adopted by 300+ accounts. Treat AI as the next platform, not a claimed specialty.",
  requirement_map: [
    { requirement: "Developer/API product marketing", importance: "critical", strength: "strong", evidence: [{ ref: "p8", summary: "Launched Cobalt Streams, a real-time data API" }, { ref: "p14", summary: "GTM for Harbor developer SDKs" }], note: "Already visible; make sure it leads each role." },
    { requirement: "Launches with measurable adoption", importance: "critical", strength: "strong", evidence: [{ ref: "p8", summary: "1,400 developer sign-ups in 90 days" }], note: "Strongest single proof point." },
    { requirement: "Usage-based pricing and packaging", importance: "important", strength: "partial", evidence: [{ ref: "p16", summary: "Pricing research for usage-based launch" }, { ref: "A3", summary: "Usage-based packaging adopted by 300+ accounts (bank, not on master)" }], note: "Strong evidence exists in the bank but is missing from the master — add it." },
    { requirement: "Customer research / win-loss", importance: "important", strength: "strong", evidence: [{ ref: "p9", summary: "Win/loss program; win rate 18% → 26%" }], note: "Already strong; keep as written." },
    { requirement: "Onboarding / time-to-first-call", importance: "important", strength: "strong", evidence: [{ ref: "p15", summary: "Time-to-first-API-call 3 days → 40 minutes" }], note: "Uses the JD's exact metric — move it to the top of the Harbor role." },
    { requirement: "AI/ML product experience", importance: "nice_to_have", strength: "missing", evidence: [], note: "Real gap. Don't imply it; address direction in the 'why' answer." },
  ],
  strengths: ["Two API/SDK go-to-markets with metrics", "Research that changed pricing and win rate", "Developer onboarding result that matches the JD's own metric"],
  gaps: [
    { gap: "No AI/ML product experience", severity: "medium", mitigation: "Lean on API-platform parallels; don't claim AI experience." },
    { gap: "Enterprise upmarket motion is implied, not explicit", severity: "low", mitigation: "Enterprise win-rate result covers part of it." },
  ],
  accomplishments_to_emphasize: [
    { ref: "p8", why: "API launch with adoption metric — matches priority #1 and #2" },
    { ref: "p15", why: "Exact match to 'time-to-first-call'" },
    { ref: "A3", why: "Only verified usage-based packaging result" },
  ],
  jd_terms_supported: [
    { term: "usage-based pricing", evidence_ref: "A3" },
    { term: "time-to-first-call", evidence_ref: "p15" },
    { term: "win/loss", evidence_ref: "p9" },
  ],
  jd_terms_unsupported: ["agent tooling", "AI/ML products", "PLG upmarket motion", "technical buyers"],
  recruiter_view: "Yes for API launches — 'real-time data API' and '1,400 developer sign-ups' are in the first role. Usage-based pricing is currently buried and partly missing.",
  hiring_manager_view: "The onboarding and win/loss results show someone who works on outcomes, not just launch assets. They'll probe AI depth; the resume shouldn't overclaim it.",
};

export const PRECOMPUTED_PLAN: EditPlan & { dropped: string[] } = {
  overall: {
    verdict: "targeted_edits",
    summary: "Already a strong base for this role. Three edits that matter: add the usage-based packaging result, lead Harbor with time-to-first-call, and cut two low-signal bullets.",
    keep_count: 7,
  },
  edits: [
    {
      bullet_id: "p7",
      action: "replace",
      proposed_text: "Co-designed usage-based packaging for the analytics API with Product and Finance; 300+ accounts adopted it within two quarters.",
      move_before_bullet_id: null,
      rationale: "The current bullet is a job description with no result. Usage-based packaging is a top-3 priority and this is the only verified proof of it.",
      impact: "high",
      substantive: true,
      jd_terms_used: ["usage-based"],
      accomplishment_refs: ["A3"],
      uses_unverified: false,
    },
    {
      bullet_id: "p15",
      action: "reposition",
      proposed_text: "Rewrote developer documentation landing pages, reducing time-to-first-API-call from 3 days to 40 minutes (measured via onboarding telemetry).",
      move_before_bullet_id: "p14",
      rationale: "The JD names time-to-first-call explicitly; this is your clearest match and should be the first thing read under Harbor.",
      impact: "medium",
      substantive: true,
      jd_terms_used: ["time-to-first-call"],
      accomplishment_refs: ["A5"],
      uses_unverified: false,
    },
    {
      bullet_id: "p17",
      action: "remove",
      proposed_text: null,
      move_before_bullet_id: null,
      rationale: "Event logistics reads junior for a Lead role and takes space from stronger evidence.",
      impact: "low",
      substantive: true,
      jd_terms_used: [],
      accomplishment_refs: [],
      uses_unverified: false,
    },
    {
      bullet_id: "p21",
      action: "remove",
      proposed_text: null,
      move_before_bullet_id: null,
      rationale: "'Supported' campaign work from 2015–2018 adds no signal; the newsletter result already covers this role.",
      impact: "low",
      substantive: true,
      jd_terms_used: [],
      accomplishment_refs: [],
      uses_unverified: false,
    },
  ],
  dropped: [],
};

export const PRECOMPUTED_ANSWERS = {
  fit: "Northwind needs someone who can run developer launches and judge them by activation, and that's most of what I've done for the last six years. At Cobalt I led the launch of a real-time data API that reached 1,400 developer sign-ups in 90 days, and I co-designed the usage-based packaging that 300+ accounts adopted within two quarters. Before that, at Harbor Payments, I rewrote our developer docs entry points and cut time-to-first-API-call from 3 days to 40 minutes. I also run research that changes decisions: our win/loss program reshaped pricing tiers and moved enterprise win rate from 18% to 26%. I haven't marketed an AI product yet, but the work you describe (API positioning, consumption pricing, onboarding) is the work I know how to do well.",
  why_company:
    "I want to work on products where the user is a builder, and AI infrastructure is where that work matters most right now. What stands out about Northwind is the stage: 40,000 developers already on the API and a move upmarket that turns pricing and positioning into the core problem rather than an afterthought. That's the transition I've helped with before, taking usage-based packaging to larger accounts at Cobalt. The agent tooling launch is also the kind of narrative challenge I'd want: a new category where developers need a clear reason to build on you specifically. I'd be coming to AI from API platforms rather than from ML, and I'd like to learn it at a company where developer experience is the product.",
  why_company_assumptions: ["Developer count and stage are taken from the JD; no external research was run for this example."],
};

export const PRECOMPUTED_OUTREACH = {
  recipientType: "recruiter",
  message:
    "Hi — I just applied for the Product Marketing Lead, Developer Platform role. I led a real-time data API launch (1,400 dev sign-ups in 90 days) and cut time-to-first-API-call from 3 days to 40 min at a payments company. Glad to share more if it helps your review.",
};
