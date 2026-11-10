"use client";
import { useEffect, useState } from "react";
import { api, Badge, Disclosure, ErrorNote, Spinner } from "@/components/ui";
import type { Accomplishment, Discrepancy, Role } from "@/lib/knowledge";

type Data = { stats: Record<string, number>; roles: Role[]; accomplishments: Accomplishment[]; discrepancies: Discrepancy[]; facts: { id: number; kind: string; value: string }[]; sources: { id: number; title: string; kind: string; imported_at: string | null }[] };

const statusTone = (s: string) => (s === "verified" ? "green" : s === "disputed" ? "red" : "amber");

export default function BankPage() {
  const [d, setD] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Data>(`/api/bank?q=${encodeURIComponent(q)}${filter ? `&status=${filter}` : ""}`).then(setD).catch((e) => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q, filter]);
  const act = async (json: Record<string, unknown>) => { try { await api("/api/bank", { method: "POST", json }); load(); } catch (e) { setError((e as Error).message); } };

  if (!d) return <Spinner />;
  const byRole = new Map<string, Accomplishment[]>();
  for (const a of d.accomplishments) {
    const k = `${a.employer ?? "Unassigned"} — ${a.title ?? ""}`;
    byRole.set(k, [...(byRole.get(k) ?? []), a]);
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Career bank</h1>
          <p className="text-sm text-muted">Previous resumes are evidence, not truth. Verify facts here; only you can promote wording into your verified record.</p>
        </div>
        <div className="flex gap-4 text-sm">
          {[["Roles", d.stats.roles], ["Accomplishments", d.stats.accomplishments], ["Verified", d.stats.verified], ["Wordings", d.stats.variants], ["Sources", d.stats.sources]].map(([k, v]) => (
            <div key={k as string}><div className="text-lg font-semibold">{v}</div><div className="text-xs text-muted">{k}</div></div>
          ))}
        </div>
      </div>
      <ErrorNote error={error} />

      {d.discrepancies.length > 0 && (
        <section className="card space-y-3 border-amber-200">
          <h2 className="h2">Conflicting facts to resolve ({d.discrepancies.length})</h2>
          <p className="text-xs text-muted">Resumaster won’t use disputed numbers until you confirm which is correct.</p>
          {d.discrepancies.map((x) => <DiscrepancyRow key={x.id} x={x} onResolve={(r) => act({ action: "resolve_discrepancy", id: x.id, resolution: r })} />)}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input max-w-sm" placeholder="Search accomplishments, skills, metrics…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="disputed">Disputed</option>
        </select>
      </div>

      {[...byRole.entries()].map(([role, items]) => (
        <section key={role} className="card space-y-3">
          <h2 className="h2">{role}</h2>
          {items.map((a) => <AccCard key={a.id} a={a} act={act} />)}
        </section>
      ))}
      {d.accomplishments.length === 0 && <div className="card text-sm text-muted">No accomplishments yet. Choose a master resume and import previous versions in Setup.</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2">
          <h2 className="h2">Roles</h2>
          {d.roles.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1"><b>{r.employer}</b> — {r.title} <span className="text-muted">{[r.start_date, r.end_date].filter(Boolean).join(" – ")}</span></span>
              {r.status === "verified" ? <Badge tone="green">verified</Badge> : <button className="btn-ghost btn-sm" onClick={() => act({ action: "update_role", id: r.id, patch: { status: "verified" } })}>Verify</button>}
            </div>
          ))}
        </section>
        <section className="card space-y-2">
          <h2 className="h2">Skills, tools, education</h2>
          <div className="flex flex-wrap gap-1">
            {d.facts.map((f) => (
              <span key={f.id} className="badge bg-stone-100 text-stone-700">{f.kind}: {f.value}<button className="ml-1 text-stone-400 hover:text-rose-700" onClick={() => act({ action: "delete_fact", id: f.id })}>×</button></span>
            ))}
          </div>
          <Disclosure summary={`Sources (${d.sources.length})`}>
            <ul className="text-xs text-muted">{d.sources.map((s) => <li key={s.id}>{s.title} — {s.kind}</li>)}</ul>
          </Disclosure>
        </section>
      </div>
    </div>
  );
}

function DiscrepancyRow({ x, onResolve }: { x: Discrepancy; onResolve: (r: string) => void }) {
  const [custom, setCustom] = useState("");
  return (
    <div className="rounded-lg border border-line p-3 text-sm">
      <div className="font-medium">{x.description}</div>
      {x.canonical && <div className="text-xs text-muted">{x.canonical}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        {x.options.map((o) => <button key={o} className="btn-ghost btn-sm" onClick={() => onResolve(o)}>“{o}” is correct</button>)}
        <input className="input w-60 py-1 text-xs" placeholder="Or state the correct fact" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn-primary btn-sm" disabled={!custom.trim()} onClick={() => onResolve(custom)}>Confirm</button>
      </div>
    </div>
  );
}

function AccCard({ a, act }: { a: Accomplishment; act: (j: Record<string, unknown>) => void }) {
  const [editing, setEditing] = useState(false);
  const [canonical, setCanonical] = useState(a.canonical);
  const [wording, setWording] = useState("");
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start gap-2">
        <Badge tone={statusTone(a.status)}>{a.status}</Badge>
        <code className="text-xs text-muted">A{a.id}</code>
        {editing ? (
          <textarea className="input min-h-16 flex-1 text-sm" value={canonical} onChange={(e) => setCanonical(e.target.value)} />
        ) : (
          <p className="flex-1 text-sm">{a.canonical}</p>
        )}
        <div className="flex gap-1">
          {editing ? (
            <button className="btn-primary btn-sm" onClick={() => { act({ action: "update_accomplishment", id: a.id, patch: { canonical, status: "verified" } }); setEditing(false); }}>Save & verify</button>
          ) : (
            <>
              {a.status !== "verified" && a.open_discrepancies === 0 && <button className="btn-ghost btn-sm" onClick={() => act({ action: "verify", id: a.id })}>Verify</button>}
              <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Correct</button>
              <button className="btn-ghost btn-sm text-rose-700" onClick={() => confirm("Delete this accomplishment?") && act({ action: "delete_accomplishment", id: a.id })}>Delete</button>
            </>
          )}
        </div>
      </div>
      {!!a.metrics.length && <div className="mt-1 flex flex-wrap gap-1">{a.metrics.map((m) => <Badge key={m.value + m.context} tone="blue">{m.value} · {m.context}</Badge>)}</div>}
      <Disclosure summary={`${a.variants.length} wording(s) · ${[...a.themes, ...a.skills].slice(0, 5).join(", ")}`}>
        <ul className="space-y-1 text-sm">
          {a.variants.map((v) => (
            <li key={v.id} className="flex gap-2">
              <span className="flex-1">“{v.text}”</span>
              <span className="text-xs text-muted">{v.framing}{v.source_title ? ` · ${v.source_title}` : v.origin === "user" ? " · added by you" : ""}</span>
              <button className="text-xs text-stone-400 hover:text-rose-700" onClick={() => act({ action: "delete_variant", id: v.id })}>×</button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input className="input text-xs" placeholder="Add a confirmed wording" value={wording} onChange={(e) => setWording(e.target.value)} />
          <button className="btn-ghost btn-sm" disabled={!wording.trim()} onClick={() => { act({ action: "add_variant", id: a.id, text: wording }); setWording(""); }}>Add</button>
        </div>
      </Disclosure>
    </div>
  );
}
