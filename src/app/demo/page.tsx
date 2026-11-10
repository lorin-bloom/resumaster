"use client";
import { useEffect, useMemo, useState } from "react";
import type { EditPlan, FitAnalysis, JDAnalysis } from "@/lib/ai/schemas";
import type { Accomplishment } from "@/lib/knowledge";
import { DEMO_RESUME } from "@/lib/demo/fixtures";
import { simulate, type ApprovedEdit } from "@/lib/google/apply-edits";
import { api, Badge, CopyButton, Disclosure, ErrorNote, Spinner } from "@/components/ui";
import { EditCard, OutreachMessage, RECIPIENTS, RoleAnalysis, type EditView } from "@/components/panels";

type Result = {
  source: "precomputed" | "live";
  analysis: JDAnalysis;
  fit: FitAnalysis;
  plan: EditPlan;
  answers: { kind: string; question: string; answer: string; assumptions: string[]; needsInput?: string | null }[];
  outreach: { recipientType: string; message: string; chars: number; alternatives: { message: string; chars: number }[] };
};
type Init = { liveAvailable: boolean; sampleJD: string; bank: Accomplishment[]; preferences: string[]; example: Result };

export default function Demo() {
  const [init, setInit] = useState<Init | null>(null);
  const [jd, setJd] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [recipient, setRecipient] = useState("recruiter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, EditView["decision"]>>({});
  const [finals, setFinals] = useState<Record<string, string>>({});

  useEffect(() => {
    api<Init>("/api/demo").then((r) => { setInit(r); setJd(r.sampleJD); setResult(r.example); });
  }, []);

  const edits: EditView[] = useMemo(() =>
    (result?.plan.edits ?? []).map((e, i) => ({
      id: i, bullet_id: e.bullet_id, action: e.action, proposed_text: e.proposed_text, move_before_bullet_id: e.move_before_bullet_id,
      rationale: e.rationale, impact: e.impact, substantive: e.substantive, uses_unverified: e.uses_unverified,
      original_text: DEMO_RESUME.paragraphs.find((p) => p.id === e.bullet_id)?.text ?? "",
      decision: decisions[e.bullet_id] ?? "pending", final_text: finals[e.bullet_id] ?? null,
    })), [result, decisions, finals]);

  const preview = useMemo(() => {
    const approved: ApprovedEdit[] = edits.filter((e) => e.decision === "accepted" || e.decision === "edited").map((e) => {
      const text = e.final_text ?? e.proposed_text ?? e.original_text;
      if (e.action === "remove") return { kind: "remove", bulletId: e.bullet_id, originalText: e.original_text };
      if (e.action === "reposition" && e.move_before_bullet_id) return { kind: "move", bulletId: e.bullet_id, originalText: e.original_text, newText: text, beforeBulletId: e.move_before_bullet_id };
      return { kind: "replace_text", bulletId: e.bullet_id, originalText: e.original_text, newText: text };
    });
    const changed = new Set(approved.flatMap((a) => ("newText" in a ? [a.newText] : [])));
    const bulletTexts = new Set(DEMO_RESUME.paragraphs.filter((p) => p.isBullet).map((p) => p.text));
    return simulate(DEMO_RESUME, approved).map((t) => ({ t, changed: changed.has(t), bullet: bulletTexts.has(t) || changed.has(t) }));
  }, [edits]);

  async function runLive() {
    setBusy(true); setError(null);
    try {
      const r = await api<Result>("/api/demo", { method: "POST", json: { jd, recipientType: recipient } });
      setResult(r); setDecisions({}); setFinals({});
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  if (!init || !result) return <Spinner />;
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Resumaster demo</h1>
        <p className="max-w-3xl text-sm text-muted">
          An AI career strategist that reads a job description like a recruiter and hiring manager, maps it to a candidate’s <i>verified</i> history, recommends only the resume edits that matter, and drafts application answers and a LinkedIn note under 300 characters. This demo uses a <b>fictional candidate, Jordan Rivera</b>. No real resumes or Google accounts are involved here.
        </p>
      </section>

      <section className="card space-y-3">
        <div className="label">How it works</div>
        <ol className="grid gap-3 text-sm md:grid-cols-5">
          {[
            ["Analyze the role", "Priorities, business problems, seniority, the terms that matter."],
            ["Map evidence", "Every requirement mapped to a resume bullet or verified bank accomplishment."],
            ["Edit with restraint", "Keep strong bullets; refine, move, replace, or cut only where it changes the outcome."],
            ["Copy, edit, validate", "A new Google Doc from the master (formatting intact), exported to PDF and checked as an ATS parser would read it."],
            ["Learn", "Feedback becomes saved rules or role-specific notes, never blindly accepted."],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-lg bg-stone-50 p-3"><div className="font-medium">{i + 1}. {t}</div><div className="text-xs text-muted">{d}</div></li>
          ))}
        </ol>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="label mb-0">Job description</div>
          <Badge tone="gray">sample — fictional company</Badge>
        </div>
        <textarea className="input min-h-48 font-mono text-xs" value={jd} onChange={(e) => setJd(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={() => { setResult(init.example); setJd(init.sampleJD); setDecisions({}); setFinals({}); }}>Show precomputed example</button>
          <select className="input w-auto" value={recipient} onChange={(e) => setRecipient(e.target.value)}>{RECIPIENTS.map(([k, l]) => <option key={k} value={k}>Outreach to: {l}</option>)}</select>
          <button className="btn-primary" disabled={!init.liveAvailable || busy || jd.length < 200} onClick={runLive}>{busy ? <><Spinner /> Running live AI (1–2 min)…</> : "Run live AI on this JD"}</button>
          {!init.liveAvailable && <span className="text-xs text-muted">Live AI is off on this deployment.</span>}
        </div>
        <ErrorNote error={error} />
      </section>

      <div className={`rounded-lg px-4 py-2 text-sm font-medium ${result.source === "live" ? "bg-emerald-50 text-emerald-900" : "bg-sky-50 text-sky-900"}`}>
        {result.source === "live" ? "Live AI output — generated just now from the job description above." : "Precomputed example — generated ahead of time for the sample job description; not a live run."}
      </div>

      <RoleAnalysis jda={result.analysis} fit={result.fit} />

      <section className="card space-y-4">
        <h2 className="h2">Recommended resume changes</h2>
        <p className="text-sm"><Badge tone="blue">{result.plan.overall.verdict.replace(/_/g, " ")}</Badge> {result.plan.overall.summary} <span className="text-muted">{result.plan.overall.keep_count} bullets kept as written.</span></p>
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            {edits.map((e) => (
              <EditCard key={e.bullet_id + e.decision} e={e} onDecide={async (d, finalText) => {
                setDecisions((s) => ({ ...s, [e.bullet_id]: d }));
                if (finalText) setFinals((s) => ({ ...s, [e.bullet_id]: finalText }));
              }} />
            ))}
          </div>
          <div className="rounded-lg border border-line bg-white p-4 text-[12.5px] leading-snug shadow-sm">
            <div className="label">Tailored resume preview</div>
            {preview.map((p, i) => (
              <div key={i} className={`${p.bullet ? "ml-4 list-item list-disc" : /^[A-Z ]+$/.test(p.t) ? "mt-2 font-semibold tracking-wide" : ""} ${p.changed ? "bg-emerald-50" : ""}`}>{p.t}</div>
            ))}
            <p className="mt-3 text-xs text-muted">Accept edits to see them applied. In the private app this becomes a new Google Doc and a validated PDF.</p>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="h2">Application answers</h2>
        {result.answers.map((a) => (
          <div key={a.kind} className="space-y-2">
            <div className="text-sm font-medium">{a.question}</div>
            <p className="rounded-lg bg-stone-50 p-3 text-sm leading-relaxed">{a.answer}</p>
            <div className="flex items-center gap-2 text-xs text-muted"><CopyButton text={a.answer} /> {a.answer.split(/\s+/).length} words{a.assumptions.length ? ` · Inferred: ${a.assumptions.join("; ")}` : ""}</div>
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="h2">LinkedIn note <span className="text-sm font-normal text-muted">to a {RECIPIENTS.find((r) => r[0] === result.outreach.recipientType)?.[1].toLowerCase()}</span></h2>
        <OutreachMessage message={result.outreach.message} chars={result.outreach.chars} alternatives={result.outreach.alternatives} />
      </section>

      <section className="card space-y-3">
        <h2 className="h2">Behind the scenes: the candidate’s memory</h2>
        <Disclosure summary={`Accomplishment bank (${init.bank.length}) — note the disputed and unverified entries`}>
          <ul className="space-y-2 text-sm">
            {init.bank.map((a) => (
              <li key={a.id} className="rounded-lg border border-line p-3">
                <Badge tone={a.status === "verified" ? "green" : a.status === "disputed" ? "red" : "amber"}>{a.status}</Badge> <code className="text-xs text-muted">A{a.id}</code> {a.canonical}
                <div className="mt-1 text-xs text-muted">{a.variants.length} prior wording(s): {a.variants.map((v) => v.framing).join(", ")}</div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Two prior resumes disagree on A4’s pipeline number, so it is never used until the candidate confirms which is true.</p>
        </Disclosure>
        <Disclosure summary={`Saved writing preferences (${init.preferences.length})`}>
          <ul className="list-disc pl-5 text-sm">{init.preferences.map((p) => <li key={p}>{p}</li>)}</ul>
        </Disclosure>
      </section>
    </div>
  );
}
