"use client";
import { useState } from "react";
import type { FitAnalysis, JDAnalysis } from "@/lib/ai/schemas";
import { Badge, CopyButton, Disclosure, Spinner, fitTone, statusTone } from "./ui";

/* ---------------- Role analysis ---------------- */

export function RoleAnalysis({ jda, fit }: { jda: JDAnalysis; fit: FitAnalysis | null }) {
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="h2">Role analysis</h2>
        {fit && <Badge tone={fitTone(fit.fit_level)}>{fit.fit_level} fit</Badge>}
      </div>
      {fit && (
        <div className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
          <div className="font-medium text-accent">{fit.verdict}</div>
          <div className="mt-1 text-ink/80"><b>Positioning:</b> {fit.positioning}</div>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="label">What the hiring manager wants most</div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {jda.hiring_priorities.slice(0, 5).map((p) => (
              <li key={p.priority}><span className="font-medium">{p.priority}</span> <span className="text-muted">— {p.why_it_matters}</span></li>
            ))}
          </ol>
        </div>
        {fit && (
          <div className="space-y-3">
            <div>
              <div className="label">Strengths</div>
              <ul className="list-disc space-y-1 pl-5 text-sm">{fit.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
            <div>
              <div className="label">Gaps</div>
              <ul className="space-y-1 text-sm">
                {fit.gaps.map((g) => (
                  <li key={g.gap}><Badge tone={g.severity === "high" ? "red" : g.severity === "medium" ? "amber" : "gray"}>{g.severity}</Badge> {g.gap} <span className="text-muted">— {g.mitigation}</span></li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
      {fit && (
        <Disclosure summary="Requirement-to-evidence map">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {fit.requirement_map.map((r) => (
                  <tr key={r.requirement} className="align-top">
                    <td className="py-2 pr-3"><Badge tone={r.strength === "strong" ? "green" : r.strength === "partial" ? "amber" : "red"}>{r.strength}</Badge></td>
                    <td className="py-2 pr-3"><div className="font-medium">{r.requirement}</div><div className="text-xs text-muted">{r.importance.replace(/_/g, " ")}</div></td>
                    <td className="py-2 pr-3 text-xs">{r.evidence.map((e) => <div key={e.ref + e.summary}><code className="text-muted">{e.ref}</code> {e.summary}</div>)}</td>
                    <td className="py-2 text-xs text-muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      )}
      {fit && (
        <Disclosure summary="Recruiter and hiring-manager read">
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <div><div className="label">Recruiter (30-second scan)</div>{fit.recruiter_view}</div>
            <div><div className="label">Hiring manager</div>{fit.hiring_manager_view}</div>
            <div><div className="label">JD terms you can truthfully use</div>{fit.jd_terms_supported.map((t) => <Badge key={t.term} tone="green">{t.term}</Badge>)}</div>
            <div><div className="label">Don’t claim</div>{fit.jd_terms_unsupported.map((t) => <Badge key={t} tone="red">{t}</Badge>)}</div>
          </div>
        </Disclosure>
      )}
      <Disclosure summary="Full role breakdown">
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div><div className="label">Context</div>{jda.business_context}<div className="mt-2 text-muted">{jda.seniority} · {jda.ownership_level}</div></div>
          <div><div className="label">Business problems</div><ul className="list-disc pl-5">{jda.business_problems.map((b) => <li key={b}>{b}</li>)}</ul></div>
          <div><div className="label">Required</div><ul className="list-disc pl-5">{jda.required_qualifications.map((b) => <li key={b}>{b}</li>)}</ul></div>
          <div><div className="label">Preferred</div><ul className="list-disc pl-5">{jda.preferred_qualifications.map((b) => <li key={b}>{b}</li>)}</ul></div>
          <div className="md:col-span-2"><div className="label">Keywords</div><div className="flex flex-wrap gap-1">{jda.keywords.map((k) => <Badge key={k.term} tone={k.importance === "critical" ? "blue" : "gray"}>{k.term}</Badge>)}</div></div>
        </div>
      </Disclosure>
    </section>
  );
}

/* ---------------- Resume edits ---------------- */

export interface EditView {
  id: number;
  bullet_id: string;
  action: "refine" | "reposition" | "replace" | "remove";
  original_text: string;
  proposed_text: string | null;
  move_before_bullet_id: string | null;
  rationale: string;
  impact: string;
  substantive: number | boolean;
  uses_unverified: number | boolean;
  decision: "pending" | "accepted" | "rejected" | "edited";
  final_text: string | null;
}

const ACTION_LABEL = { refine: "Refine", reposition: "Move up", replace: "Replace", remove: "Remove" };

export function EditCard({
  e,
  onDecide,
  onChallenge,
  readOnly = false,
}: {
  e: EditView;
  onDecide: (decision: EditView["decision"], finalText?: string, note?: string) => Promise<void>;
  onChallenge?: (message: string) => Promise<{ stance: string; response: string } | void>;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(e.final_text ?? e.proposed_text ?? e.original_text);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<{ stance: string; response: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k);
    try { await fn(); } finally { setBusy(null); }
  };
  const decided = e.decision !== "pending";
  const shown = e.decision === "edited" ? e.final_text : e.proposed_text;

  return (
    <div className={`rounded-lg border p-4 ${decided ? (e.decision === "rejected" ? "border-line bg-stone-50 opacity-70" : "border-emerald-200 bg-emerald-50/40") : "border-line bg-white"}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="blue">{ACTION_LABEL[e.action]}</Badge>
        <Badge tone={e.impact === "high" ? "green" : e.impact === "medium" ? "gray" : "gray"}>{e.impact} impact</Badge>
        {!e.substantive && <Badge tone="gray">stylistic</Badge>}
        {!!e.uses_unverified && <Badge tone="amber">uses unverified fact</Badge>}
        <code className="text-muted">{e.bullet_id}</code>
        {decided && <span className="ml-auto font-medium capitalize text-muted">{e.decision}</span>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="label">Original</div>
          <p className={`text-sm ${e.action === "remove" && e.decision !== "rejected" ? "line-through text-muted" : ""}`}>{e.original_text}</p>
        </div>
        <div>
          <div className="label">{e.action === "remove" ? "Proposed" : e.decision === "edited" ? "Your version" : "Proposed"}</div>
          {editing ? (
            <textarea className="input min-h-24" value={text} onChange={(ev) => setText(ev.target.value)} />
          ) : e.action === "remove" ? (
            <p className="text-sm italic text-muted">Remove this bullet</p>
          ) : (
            <p className="text-sm">{shown}{e.action === "reposition" && e.move_before_bullet_id && <span className="text-xs text-muted"> (moved above {e.move_before_bullet_id})</span>}</p>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">{e.rationale}</p>
      {reply && <div className="mt-2 rounded-md bg-stone-100 px-3 py-2 text-xs"><b className="capitalize">{reply.stance}:</b> {reply.response}</div>}
      {!readOnly && (
        <div className="mt-3 space-y-2">
          {(editing || (!decided && showNote)) && (
            <input className="input text-xs" placeholder="Optional: why? (e.g. “Don’t overstate my ownership” — general rules are remembered)" value={note} onChange={(ev) => setNote(ev.target.value)} />
          )}
          <div className="flex flex-wrap gap-2">
            {!decided && !editing && (
              <>
                <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => run("a", () => onDecide("accepted", undefined, note))}>{busy === "a" ? <Spinner /> : "Accept"}</button>
                <button className="btn-ghost btn-sm" disabled={!!busy} onClick={() => run("r", () => onDecide("rejected", undefined, note))}>{busy === "r" ? <Spinner /> : "Reject"}</button>
                {e.action !== "remove" && <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>}
                {!showNote && <button className="btn-ghost btn-sm" onClick={() => setShowNote(true)}>Add reason</button>}
                {onChallenge && <button className="btn-ghost btn-sm" onClick={() => setAsking((v) => !v)}>Ask why / push back</button>}
              </>
            )}
            {editing && (
              <>
                <button className="btn-primary btn-sm" disabled={!!busy || !text.trim()} onClick={() => run("e", async () => { await onDecide("edited", text, note); setEditing(false); })}>{busy === "e" ? <Spinner /> : "Save my version"}</button>
                <button className="btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
              </>
            )}
            {decided && <button className="btn-ghost btn-sm" onClick={() => onDecide("pending")}>Undo</button>}
          </div>
          {asking && onChallenge && (
            <div className="flex gap-2">
              <input className="input text-xs" placeholder="e.g. Isn't the original stronger because it has the number first?" value={question} onChange={(ev) => setQuestion(ev.target.value)} />
              <button className="btn-ghost btn-sm" disabled={!question.trim() || !!busy} onClick={() => run("q", async () => { const r = await onChallenge(question); if (r) setReply(r); setQuestion(""); setAsking(false); })}>{busy === "q" ? <Spinner /> : "Send"}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Validation report ---------------- */

export interface Validation {
  ok: boolean;
  pageCount: number;
  checks: { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }[];
  extractedPreview?: string;
}

export function ValidationList({ v }: { v: Validation }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{v.ok ? "ATS readability checks passed" : "Some checks failed — review before uploading"}</div>
      <ul className="space-y-1">
        {v.checks.map((c) => (
          <li key={c.id} className="flex gap-2 text-sm">
            <Badge tone={statusTone(c.status)}>{c.status}</Badge>
            <span><b className="font-medium">{c.label}.</b> <span className="text-muted">{c.detail}</span></span>
          </li>
        ))}
      </ul>
      {v.extractedPreview && (
        <Disclosure summary="What a parser extracts">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-xs">{v.extractedPreview}</pre>
        </Disclosure>
      )}
      <p className="text-xs text-muted">These checks reflect common ATS parsing practice. No tool can guarantee how a specific employer’s system scores a resume.</p>
    </div>
  );
}

/* ---------------- Outreach ---------------- */

export const RECIPIENTS = [
  ["recruiter", "Recruiter"],
  ["hiring_manager", "Hiring manager"],
  ["team_member", "Team member"],
  ["senior_leader", "Senior leader"],
] as const;

export function OutreachMessage({ message, chars, alternatives }: { message: string; chars: number; alternatives?: { message: string; chars: number }[] }) {
  const [showAlt, setShowAlt] = useState(false);
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-line bg-stone-50 p-3 text-sm leading-relaxed">{message}</div>
      <div className="flex items-center gap-3">
        <CopyButton text={message} />
        <span className={`text-xs ${chars > 300 ? "text-rose-700" : "text-muted"}`}>{chars}/300 characters</span>
        {!!alternatives?.length && <button className="text-xs text-muted underline" onClick={() => setShowAlt((v) => !v)}>{showAlt ? "Hide" : "Show"} alternatives</button>}
      </div>
      {showAlt && alternatives?.map((a, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border border-dashed border-line p-3 text-sm">
          <span className="flex-1">{a.message}</span>
          <span className="text-xs text-muted">{a.chars}</span>
          <CopyButton text={a.message} />
        </div>
      ))}
    </div>
  );
}
