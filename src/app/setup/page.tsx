"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, Badge, CostHint, ErrorNote, Spinner, confirmCost } from "@/components/ui";

type Status = { google: { configured: boolean; connected: boolean; email: string | null }; ai: { configured: boolean; strategyModel: string; fastModel: string }; master: { title: string; googleDocId: string } | null; bank: { accomplishments: number; sources: number } };
type File = { id: string; name: string; modifiedTime: string; webViewLink: string };

export default function SetupPage() {
  return <Suspense><Setup /></Suspense>;
}

function Setup() {
  const search = useSearchParams();
  const [s, setS] = useState<Status | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(search.get("error"));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  const load = () => api<Status>("/api/status").then(setS);
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!s?.google.connected) return;
    const t = setTimeout(() => api<{ files: File[] }>(`/api/drive/docs?q=${encodeURIComponent(q)}`).then((r) => setFiles(r.files)).catch((e) => setError(e.message)), 250);
    return () => clearTimeout(t);
  }, [s?.google.connected, q]);

  const step = (n: number, title: string, done: boolean, body: React.ReactNode) => (
    <section className="card space-y-3">
      <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-100 text-xs font-semibold">{n}</span><h2 className="h2">{title}</h2>{done && <Badge tone="green">done</Badge>}</div>
      {body}
    </section>
  );

  if (!s) return <Spinner />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Setup</h1>
      <ErrorNote error={error} />
      {step(1, "API keys", s.ai.configured && s.google.configured, (
        <div className="space-y-1 text-sm">
          <div>Claude API: {s.ai.configured ? <Badge tone="green">configured</Badge> : <Badge tone="red">missing ANTHROPIC_API_KEY</Badge>} <span className="text-muted">({s.ai.strategyModel} for strategy, {s.ai.fastModel} for extraction)</span></div>
          <div>Google OAuth: {s.google.configured ? <Badge tone="green">configured</Badge> : <Badge tone="red">missing GOOGLE_CLIENT_ID / SECRET</Badge>}</div>
          {(!s.ai.configured || !s.google.configured) && <p className="text-muted">Add them to <code>.env.local</code> and restart (see README).</p>}
        </div>
      ))}
      {step(2, "Connect Google", s.google.connected, (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {s.google.connected ? (
            <>
              <span>Connected as <b>{s.google.email}</b></span>
              <button className="btn-ghost btn-sm" onClick={async () => { await api("/api/auth/disconnect", { method: "POST" }); load(); }}>Disconnect</button>
            </>
          ) : (
            <a className={`btn-primary ${s.google.configured ? "" : "pointer-events-none opacity-50"}`} href="/api/auth/google">Connect Google Drive & Docs</a>
          )}
          <span className="text-xs text-muted">Reads the docs you choose; creates new docs only inside “Resumaster Applications”.</span>
        </div>
      ))}
      {s.google.connected && step(3, "Choose your master resume, import past versions", !!s.master, (
        <div className="space-y-3">
          {s.master && <div className="text-sm">Master: <b>{s.master.title}</b> <a className="text-xs text-accent underline" href={`https://docs.google.com/document/d/${s.master.googleDocId}/edit`} target="_blank">open</a></div>}
          <input className="input" placeholder="Search your Google Docs…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-80 divide-y divide-line overflow-auto rounded-lg border border-line">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" checked={selected.has(f.id)} onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(f.id); else n.delete(f.id); setSelected(n); }} />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-muted">{new Date(f.modifiedTime).toLocaleDateString()}</span>
                <button className="btn-ghost btn-sm" disabled={!!busy} onClick={async () => {
                  if (!(await confirmCost("master", { label: "Reading this resume into your career bank" }))) return;
                  setBusy(f.id); setError(null);
                  try { const r = await api<{ title: string; roles: number; ingest: { created: number; merged: number; flagged: number } }>("/api/master", { method: "POST", json: { docId: f.id } }); setResult(`Master set to “${r.title}”: ${r.roles} roles, ${r.ingest.created} accomplishments added.`); load(); } catch (e) { setError((e as Error).message); }
                  setBusy(null);
                }}>{busy === f.id ? <Spinner /> : s.master?.googleDocId === f.id ? "Master ✓" : "Use as master"}</button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" disabled={!selected.size || !!busy} onClick={async () => {
              if (!(await confirmCost("import", { docs: selected.size, label: `Importing ${selected.size} resume(s)` }))) return;
              setBusy("import"); setError(null);
              try {
                const r = await api<{ results: { docId: string; created?: number; merged?: number; flagged?: number; error?: string }[] }>("/api/import", { method: "POST", json: { docIds: [...selected] } });
                const t = r.results.reduce((a, x) => ({ c: a.c + (x.created ?? 0), m: a.m + (x.merged ?? 0), f: a.f + (x.flagged ?? 0) }), { c: 0, m: 0, f: 0 });
                const errs = r.results.filter((x) => x.error);
                setResult(`Imported ${r.results.length - errs.length} doc(s): ${t.c} new accomplishments, ${t.m} merged as alternate wording, ${t.f} fact conflicts flagged for review.${errs.length ? ` ${errs.length} failed.` : ""}`);
                setSelected(new Set()); load();
              } catch (e) { setError((e as Error).message); }
              setBusy(null);
            }}>{busy === "import" ? <><Spinner /> Extracting accomplishments…</> : `Import ${selected.size || ""} previous resume(s) into career bank`}</button>
            {selected.size > 0 && <CostHint op="import" docs={selected.size} />}
          </div>
          {result && <div className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{result}</div>}
        </div>
      ))}
      {step(4, "Or paste an old resume as text", false, (
        <div className="space-y-2">
          <textarea className="input min-h-24 text-xs" placeholder="Paste text from a PDF or Word resume…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <button className="btn-ghost" disabled={!pasted.trim() || !!busy} onClick={async () => {
            setBusy("paste");
            try { const r = await api<{ results: { created: number; merged: number; flagged: number }[] }>("/api/import", { method: "POST", json: { text: pasted } }); const x = r.results[0]; setResult(`${x.created} new, ${x.merged} merged, ${x.flagged} conflicts flagged.`); setPasted(""); } catch (e) { setError((e as Error).message); }
            setBusy(null);
          }}>{busy === "paste" ? <Spinner /> : "Import text"}</button>
        </div>
      ))}
    </div>
  );
}
