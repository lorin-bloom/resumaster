import { z } from "zod";

const Importance = z.enum(["critical", "important", "nice_to_have"]);

export const JDAnalysis = z.object({
  company: z.string().describe("Company name. 'Unknown' if not stated."),
  job_title: z.string(),
  seniority: z.string().describe("e.g. 'Senior IC', 'Manager', 'Director', 'Head of'"),
  team_or_function: z.string(),
  industry: z.string(),
  business_context: z.string().describe("2-3 sentences: company stage, product, market, why this role exists now"),
  responsibilities: z.array(z.string()),
  required_qualifications: z.array(z.string()),
  preferred_qualifications: z.array(z.string()),
  keywords: z.array(z.object({ term: z.string(), importance: Importance })),
  hiring_priorities: z.array(z.object({ priority: z.string(), why_it_matters: z.string() })).describe("The five most important qualifications, in order"),
  business_problems: z.array(z.string()).describe("Problems this hire will likely be asked to solve in year one"),
  ownership_level: z.string(),
  transferable_skills_valued: z.array(z.string()),
  unknowns: z.array(z.string()).describe("Ambiguities a recruiter screen would clarify"),
});
export type JDAnalysis = z.infer<typeof JDAnalysis>;

const Evidence = z.object({
  ref: z.string().describe("Master bullet id like 'p12' or bank accomplishment id like 'A7'"),
  summary: z.string(),
});

export const FitAnalysis = z.object({
  verdict: z.string().describe("One honest sentence on overall fit"),
  fit_level: z.enum(["strong", "good", "stretch", "weak"]),
  positioning: z.string().describe("Recommended professional positioning, 2-3 sentences, in plain language"),
  requirement_map: z.array(
    z.object({
      requirement: z.string(),
      importance: Importance,
      strength: z.enum(["strong", "partial", "missing"]),
      evidence: z.array(Evidence),
      note: z.string().describe("How to make this evident, or why it is a real gap"),
    }),
  ),
  strengths: z.array(z.string()),
  gaps: z.array(z.object({ gap: z.string(), severity: z.enum(["high", "medium", "low"]), mitigation: z.string() })),
  accomplishments_to_emphasize: z.array(z.object({ ref: z.string(), why: z.string() })),
  jd_terms_supported: z.array(z.object({ term: z.string(), evidence_ref: z.string() })).describe("Exact JD phrases that truthfully describe the candidate"),
  jd_terms_unsupported: z.array(z.string()).describe("JD terms the candidate should NOT claim"),
  recruiter_view: z.string().describe("Would relevant qualifications be obvious in a 30-second scan? Be specific."),
  hiring_manager_view: z.string().describe("Does the experience suggest success in the actual job? Be specific."),
});
export type FitAnalysis = z.infer<typeof FitAnalysis>;

export const EditPlan = z.object({
  overall: z.object({
    verdict: z.enum(["already_strong", "targeted_edits", "significant_repositioning"]),
    summary: z.string().describe("1-2 sentences. If the resume is already strong for this role, say so plainly."),
    keep_count: z.number().describe("How many bullets should stay exactly as written"),
  }),
  edits: z.array(
    z.object({
      bullet_id: z.string(),
      action: z.enum(["refine", "reposition", "replace", "remove"]),
      proposed_text: z.string().nullable().describe("Full new bullet text. null only for 'remove'. For 'reposition' it may equal the original."),
      move_before_bullet_id: z.string().nullable().describe("For 'reposition': the bullet id (same role) this bullet should be placed before"),
      rationale: z.string().describe("Max 2 short sentences: why this materially helps for THIS role"),
      impact: z.enum(["high", "medium", "low"]),
      substantive: z.boolean().describe("false if this is merely a stylistic alternative"),
      jd_terms_used: z.array(z.string()),
      accomplishment_refs: z.array(z.string()).describe("Bank ids like 'A7' whose verified facts are used"),
      uses_unverified: z.boolean().describe("true if any fact used is from an UNVERIFIED bank entry"),
    }),
  ),
});
export type EditPlan = z.infer<typeof EditPlan>;

export const Answer = z.object({
  answer: z.string(),
  reasons_used: z.array(z.string()).describe("The 2-3 reasons the answer leans on"),
  assumptions: z.array(z.string()).describe("Anything stated that is inferred rather than verified"),
  needs_input_question: z.string().nullable().describe("If genuine motivation can't be written without inventing it, ONE focused question for the candidate; else null"),
});
export type Answer = z.infer<typeof Answer>;

export const Outreach = z.object({
  candidates: z.array(
    z.object({
      message: z.string(),
      angle: z.string().describe("The one hook this message relies on"),
      specificity: z.number().describe("1-5"),
      credibility: z.number().describe("1-5"),
      relevance: z.number().describe("1-5"),
    }),
  ),
});
export type Outreach = z.infer<typeof Outreach>;

export const FeedbackClass = z.object({
  classification: z.enum(["global_preference", "factual_correction", "role_specific", "subjective", "would_weaken", "question", "none"]),
  reusable_rule: z.string().nullable().describe("If global_preference: the rule phrased as a short imperative, e.g. 'Keep bullets under 25 words.' else null"),
  rule_category: z.enum(["style", "tone", "accuracy", "terminology", "format", "process"]),
  applies_to: z.enum(["all", "resume", "answers", "outreach"]),
  confidence: z.enum(["high", "medium", "low"]),
  fact_correction: z.string().nullable().describe("If factual_correction: the corrected fact in one sentence"),
  response: z.string().describe("One or two sentences back to the user. If the change would weaken the application, say so and why."),
});
export type FeedbackClass = z.infer<typeof FeedbackClass>;

export const Challenge = z.object({
  stance: z.enum(["maintain", "revise", "withdraw"]),
  response: z.string().describe("Direct, brief reasoning"),
  revised_text: z.string().nullable(),
});
export type Challenge = z.infer<typeof Challenge>;

export const MasterOutline = z.object({
  roles: z.array(
    z.object({
      employer: z.string(),
      title: z.string(),
      dates: z.string().describe("Dates exactly as written in the resume"),
      bullet_ids: z.array(z.string()),
    }),
  ),
  headings: z.array(z.object({ id: z.string(), text: z.string() })),
});
export type MasterOutline = z.infer<typeof MasterOutline>;

export const ResumeExtract = z.object({
  roles: z.array(z.object({ employer: z.string(), title: z.string(), start_date: z.string().nullable(), end_date: z.string().nullable(), location: z.string().nullable() })),
  accomplishments: z.array(
    z.object({
      employer: z.string(),
      title: z.string(),
      verbatim_text: z.string().describe("The bullet exactly as written"),
      canonical: z.string().describe("Plain factual statement of what happened, no spin"),
      metrics: z.array(z.object({ value: z.string(), context: z.string() })),
      skills: z.array(z.string()),
      themes: z.array(z.string()),
      job_categories: z.array(z.string()),
      framing: z.string().describe("What this wording emphasizes, e.g. 'revenue impact', 'partnerships'"),
    }),
  ),
  skills: z.array(z.string()),
  tools: z.array(z.string()),
  industries: z.array(z.string()),
  education: z.array(z.string()),
  certifications: z.array(z.string()),
});
export type ResumeExtract = z.infer<typeof ResumeExtract>;

export const Reconcile = z.object({
  matches: z.array(
    z.object({
      new_index: z.number(),
      existing_id: z.number().nullable().describe("Bank id of the SAME underlying accomplishment, or null if new"),
      discrepancy: z
        .object({
          kind: z.enum(["metric", "ownership", "scope", "date", "other"]),
          description: z.string(),
          existing_value: z.string(),
          new_value: z.string(),
        })
        .nullable(),
    }),
  ),
});
export type Reconcile = z.infer<typeof Reconcile>;
