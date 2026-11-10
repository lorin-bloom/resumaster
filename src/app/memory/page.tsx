"use client";
import { useEffect, useState } from "react";
import { api, Badge, Disclosure, ErrorNote, Spinner, confirmCost, fmtUsd } from "@/components/ui";
import type { Preference, FeedbackRow } from "@/lib/memory";

type Usage = {
  month: { cost: number; calls: number; hits: number };
  byTask: { task: string; model: string; calls: number; hits: number; cost: number; input: number; output: number }[];
  byModel: { model: string; calls: number; hits: number; cost: number }[];
  byApp: { id: number; company: string; job_title: string; cost: number; calls: number; hits: number }[];
  avgPerApp: number | null;
  estimatedPerApp: number;
};
type Settings = {
  career_direction: string; monthly_spend_limit_usd: number; per_app_limit_usd: number; warn_threshold_usd: number; max_retries: number;
  model_strategy: string; model_fast: string; models: string[];
  tasks: { key: string; label: string; tier: string; model: string; overridden: boolean }[];
  usage: Usage;
};
const CLS_TONE: Record<string, string> = { global_preference: "green", factual_correction: "blue", role_specific: "gray", subjective: "gray", would_weaken: "amber", question: "blue" };

export default function MemoryPage() {
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [fb, setFb] = useState<(FeedbackRow & { company: string | null })[]>([]);
  const [pending, setPending] = useState(0);
  const [s, setS] = useState<Settings | null>(null);
  const [instruction, setInstruction] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => Promise.all([
    api<{ preferences: Preference[] }>("/api/preferences").then((r) => setPrefs(r.preferences)),
    api<{ feedback: (FeedbackRow & { company: string | null })[]; pendingNotes: number }>("/api/feedback").then((r) => { setFb(r.feedback); setPending(r.pendingNotes); }),
    api<Settings>("/api/settings").then(setS),
  ]).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const pref = async (json: Record<string, unknown>) => { await api("/api/preferences", { method: "POST", json }); load(); };
  const saveSetting = async (patch: Record<string, unknown>) => { await api("/api/settings", { method: "PATCH", json: patch }); load(); };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Memory & settings</h1>
      <ErrorNote error={error} />

      <section className="card space-y-3">
        <h2 className="h2">Tell Resumaster how you write</h2>
        <p className="text-sm text-muted">General instructions (“No filler words”, “Don’t make me sound junior”) are saved as rules and applied to every future application. One-off or role-specific comments aren’t.</p>
        <div className="flex gap-2">
          <input className="input" placeholder="e.g. Use the exact JD terminology when it’s accurate." value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click()} />
          <button className="btn-primary" disabled={!instruction.trim() || busy} onClick={async () => {
            setBusy(true); setMsg(null);
            try {
              const r = await api<{ learned: { classification: string; response: string; savedRule: { rule: string } | null } }>("/api/instructions", { method: "POST", json: { text: instruction } });
              setMsg(r.learned.savedRule ? `Saved rule: “${r.learned.savedRule.rule}”` : `Not saved as a rule (${r.learned.classification.replace(/_/g, " ")}): ${r.learned.response}`);
              setInstruction(""); load();
            } catch (e) { setError((e as Error).message); }
            setBusy(false);
          }}>{busy ? <Spinner /> : "Remember"}</button>
          <button className="btn-ghost" disabled={!instruction.trim()} title="Save exactly as typed, without interpretation" onClick={async () => { await pref({ rule: instruction }); setMsg(`Saved rule: “${instruction}”`); setInstruction(""); }}>Save as-is</button>
        </div>
        {msg && <div className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{msg}</div>}
      </section>

      <section className="card space-y-2">
        <h2 className="h2">Writing preferences ({prefs.filter((p) => p.active).length} active)</h2>
        {prefs.length === 0 && <p className="text-sm text-muted">None yet.</p>}
        {prefs.map((p) => <PrefRow key={p.id + p.rule + p.active + p.applies_to} p={p} pref={pref} />)}
      </section>

      <section className="card space-y-3">
        <h2 className="h2">Career direction</h2>
        <p className="text-sm text-muted">Used for “Why this company?” answers so motivation is yours, not invented.</p>
        {s && <DirectionBox initial={s.career_direction} onSave={(v) => saveSetting({ career_direction: v })} />}
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2">Editorial feedback history</h2>
          {pending > 0 && (
            <button className="btn-ghost btn-sm" disabled={busy} onClick={async () => {
              if (!(await confirmCost("interpret", { label: `Interpreting ${pending} note(s)` }))) return;
              setBusy(true);
              try { const r = await api<{ interpreted: number; saved: number }>("/api/feedback", { method: "POST", json: { action: "interpret" } }); setMsg(`Interpreted ${r.interpreted} note(s); ${r.saved} became writing rules.`); load(); } catch (e) { setError((e as Error).message); }
              setBusy(false);
            }}>Interpret {pending} unclassified note(s) with AI</button>
          )}
        </div>
        <p className="text-xs text-muted">Accepting, rejecting, and editing never call the AI. Notes that clearly state a general rule are saved automatically; ambiguous ones wait here until you choose to interpret them.</p>
        {fb.length === 0 && <p className="text-sm text-muted">Accepts, rejects, and edits will appear here.</p>}
        <ul className="divide-y divide-line">
          {fb.slice(0, 60).map((f) => (
            <li key={f.id} className="flex gap-3 py-2 text-sm">
              <div className="w-28 shrink-0 text-xs text-muted">{f.company ?? "General"}<br />{new Date(f.created_at + "Z").toLocaleDateString()}</div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-1"><Badge>{f.action}</Badge>{f.classification && <Badge tone={CLS_TONE[f.classification] ?? "gray"}>{f.classification.replace(/_/g, " ")}</Badge>}<span className="text-xs text-muted">{f.target}</span></div>
                {f.proposed_text && <div className="mt-1 text-xs text-muted">Proposed: “{f.proposed_text.slice(0, 200)}”</div>}
                {f.final_text && f.action === "edited" && <div className="text-xs">Yours: “{f.final_text.slice(0, 200)}”</div>}
                {f.user_note && <div className="text-xs">Note: {f.user_note}</div>}
                {f.ai_response && <div className="text-xs text-accent">{f.ai_response}</div>}
              </div>
              <button className="text-xs text-stone-400 hover:text-rose-700" onClick={async () => { await api("/api/feedback", { method: "POST", json: { action: "delete", id: f.id } }); load(); }}>×</button>
            </li>
          ))}
        </ul>
      </section>

      {s && <CostPanel s={s} save={saveSetting} />}
    </div>
  );
}

function PrefRow({ p, pref }: { p: Preference; pref: (j: Record<string, unknown>) => void }) {
  const [editing, setEditing] = useState(false);
  const [rule, setRule] = useState(p.rule);
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm ${p.active ? "" : "opacity-50"}`}>
      {editing ? <input className="input flex-1" value={rule} onChange={(e) => setRule(e.target.value)} /> : <span className="flex-1">{p.rule}</span>}
      <select className="input w-auto py-1 text-xs" value={p.applies_to} onChange={(e) => pref({ action: "update", id: p.id, patch: { applies_to: e.target.value } })}>
        <option value="all">everything</option><option value="resume">resume</option><option value="answers">answers</option><option value="outreach">outreach</option>
      </select>
      {p.source?.startsWith("feedback") && <Badge tone="blue">learned</Badge>}
      {editing ? <button className="btn-primary btn-sm" onClick={() => { pref({ action: "update", id: p.id, patch: { rule } }); setEditing(false); }}>Save</button> : <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>}
      <button className="btn-ghost btn-sm" onClick={() => pref({ action: "update", id: p.id, patch: { active: p.active ? 0 : 1 } })}>{p.active ? "Pause" : "Enable"}</button>
      <button className="btn-ghost btn-sm text-rose-700" onClick={() => pref({ action: "delete", id: p.id })}>Delete</button>
    </div>
  );
}

function DirectionBox({ initial, onSave }: { initial: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <div className="space-y-2">
      <textarea className="input min-h-20 text-sm" placeholder="What you want next and why — e.g. “Move closer to developer platforms and AI infrastructure; I like launch work and pricing.”" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn-ghost btn-sm" disabled={v === initial} onClick={() => onSave(v)}>Save</button>
    </div>
  );
}

function CostPanel({ s, save }: { s: Settings; save: (p: Record<string, unknown>) => void }) {
  const u = s.usage;
  const num = (k: keyof Settings, label: string, step = "0.5") => (
    <label className="text-xs">{label}<input className="input mt-1 w-28" type="number" min={0} step={step} defaultValue={s[k] as number} onBlur={(e) => save({ [k]: Number(e.target.value) })} /></label>
  );
  return (
    <section className="card space-y-4">
      <h2 className="h2">AI usage & cost</h2>
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <Stat value={fmtUsd(u.month.cost)} label={`this month of ${fmtUsd(s.monthly_spend_limit_usd)} limit`} />
        <Stat value={String(u.month.calls - u.month.hits)} label="new AI requests this month" />
        <Stat value={String(u.month.hits)} label="answered from cache (free)" />
        <Stat value={u.avgPerApp != null ? fmtUsd(u.avgPerApp) : "—"} label="actual avg per application" />
        <Stat value={fmtUsd(u.estimatedPerApp)} label="estimated per new application" />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className={`h-full ${u.month.cost / s.monthly_spend_limit_usd > 0.8 ? "bg-rose-500" : "bg-accent"}`} style={{ width: `${Math.min(100, (u.month.cost / Math.max(0.01, s.monthly_spend_limit_usd)) * 100)}%` }} /></div>

      <div className="flex flex-wrap items-end gap-4">
        {num("monthly_spend_limit_usd", "Monthly limit ($)")}
        {num("per_app_limit_usd", "Per-application limit ($)", "0.25")}
        {num("warn_threshold_usd", "Ask before ops over ($)", "0.05")}
        <label className="text-xs">Max automatic retries<select className="input mt-1 w-24" defaultValue={s.max_retries} onChange={(e) => save({ max_retries: Number(e.target.value) })}>{[0, 1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select></label>
      </div>
      <p className="text-xs text-muted">Limits are enforced on the server before every AI request. For a hard backstop, also set a spend limit on your API key in the Anthropic Console (Settings → Limits).</p>

      <Disclosure summary="Model routing (change models without rebuilding)">
        <div className="mb-3 flex flex-wrap gap-4">
          <label className="text-xs">High-quality reasoning model<select className="input mt-1" value={s.model_strategy} onChange={(e) => save({ model_strategy: e.target.value })}>{s.models.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="text-xs">Low-cost model<select className="input mt-1" value={s.model_fast} onChange={(e) => save({ model_fast: e.target.value })}>{s.models.map((m) => <option key={m}>{m}</option>)}</select></label>
        </div>
        <table className="w-full text-xs">
          <thead className="text-left text-muted"><tr><th className="py-1">Task</th><th>Default</th><th>Model used</th></tr></thead>
          <tbody className="divide-y divide-line">
            {s.tasks.map((t) => (
              <tr key={t.key}>
                <td className="py-1.5">{t.label}</td>
                <td>{t.tier === "strategy" ? "high-quality" : "low-cost"}</td>
                <td>
                  <select className="input w-auto py-1 text-xs" value={t.overridden ? t.model : "default"} onChange={(e) => save({ task_model: { key: t.key, model: e.target.value } })}>
                    <option value="default">default ({t.overridden ? "tier" : t.model})</option>
                    {s.models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">No AI is used for: copying Google Docs, applying accepted edits, PDF export and validation, character counts, saving preferences, viewing saved applications, or comparing text.</p>
      </Disclosure>
      <Disclosure summary="Cost per application">
        <table className="w-full text-xs">
          <thead className="text-left text-muted"><tr><th className="py-1">Application</th><th>New requests</th><th>Cached</th><th>Cost</th></tr></thead>
          <tbody>{u.byApp.map((a) => <tr key={a.id}><td className="py-1">{a.company} — {a.job_title}</td><td>{a.calls - a.hits}</td><td>{a.hits}</td><td>{fmtUsd(a.cost)}</td></tr>)}</tbody>
        </table>
      </Disclosure>
      <Disclosure summary="Cost by model and task (this month)">
        <table className="mb-3 w-full text-xs">
          <thead className="text-left text-muted"><tr><th className="py-1">Model</th><th>Requests</th><th>Cached</th><th>Cost</th></tr></thead>
          <tbody>{u.byModel.map((m) => <tr key={m.model}><td className="py-1">{m.model}</td><td>{m.calls}</td><td>{m.hits}</td><td>{fmtUsd(m.cost ?? 0)}</td></tr>)}</tbody>
        </table>
        <table className="w-full text-xs">
          <thead className="text-left text-muted"><tr><th className="py-1">Task</th><th>Model</th><th>Requests</th><th>Cached</th><th>Tokens in/out</th><th>Cost</th></tr></thead>
          <tbody>{u.byTask.map((t) => <tr key={t.task + t.model}><td className="py-1">{t.task}</td><td>{t.model}</td><td>{t.calls}</td><td>{t.hits}</td><td>{t.input?.toLocaleString()} / {t.output?.toLocaleString()}</td><td>${(t.cost ?? 0).toFixed(4)}</td></tr>)}</tbody>
        </table>
      </Disclosure>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="rounded-lg bg-stone-50 p-3"><div className="text-lg font-semibold">{value}</div><div className="text-xs text-muted">{label}</div></div>;
}
