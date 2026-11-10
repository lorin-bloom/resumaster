"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, Badge, CostHint, ErrorNote, Spinner, confirmCost, fitTone } from "@/components/ui";

type Status = { google: { configured: boolean; connected: boolean }; ai: { configured: boolean }; master: { title: string } | null; bank: { accomplishments: number; openDiscrepancies: number } };
type Dup = { id: number; company: string; job_title: string; revision: number; created_at: string };
type AppRow = { id: number; company: string; job_title: string; status: string; created_at: string; fit_level: string | null; revision: number };

export default function Home() {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dups, setDups] = useState<Dup[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [recent, setRecent] = useState<AppRow[]>([]);

  useEffect(() => {
    api<Status>("/api/status").then(setStatus).catch(() => {});
    api<{ applications: AppRow[] }>("/api/applications").then((r) => setRecent(r.applications.slice(0, 6))).catch(() => {});
  }, []);

  async function submit(force = false) {
    if (!(await confirmCost("new_application", { label: "Analyzing this role and drafting materials" }))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id?: number; duplicate?: Dup[] }>("/api/applications", { method: "POST", json: { jd, force } });
      if (r.duplicate) setDups(r.duplicate);
      else router.push(`/applications/${r.id}?run=1`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const blockers = status
    ? [
        !status.ai.configured && "Add ANTHROPIC_API_KEY to .env.local",
        !status.google.configured && "Add Google OAuth credentials to .env.local",
        status.google.configured && !status.google.connected && "Connect your Google account",
        status.google.connected && !status.master && "Choose your master resume",
      ].filter(Boolean)
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Paste a job description</h1>
          <p className="mt-1 text-sm text-muted">Resumaster analyzes the role, maps it to your verified history, recommends resume edits, and drafts answers and outreach.</p>
        </div>
        {blockers.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <b>Before your first run:</b> {blockers.join(" · ")}. <Link href="/setup" className="underline">Open setup</Link>
          </div>
        )}
        <textarea
          className="input min-h-[420px] font-mono text-[13px] leading-relaxed"
          placeholder="Paste the complete job description — company, role, responsibilities, qualifications…"
          value={jd}
          onChange={(e) => setJd(e.target.value)}
        />
        <ErrorNote error={error} />
        {dups && (
          <div className="card space-y-3 border-amber-200">
            <p className="text-sm">
              You already have {dups.length > 1 ? `${dups.length} runs` : "a run"} for <b>{dups[0].company} — {dups[0].job_title}</b>. Your previous materials are preserved either way.
            </p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => router.push(`/applications/${dups[0].id}`)}>Resume latest (Rev {dups[0].revision})</button>
              <button className="btn-ghost" onClick={() => submit(true)} disabled={busy}>Create Rev {Math.max(...dups.map((d) => d.revision)) + 1}</button>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={busy || jd.trim().length < 200} onClick={() => submit(false)}>
            {busy ? <><Spinner /> Reading the role…</> : "Analyze role & tailor"}
          </button>
          <CostHint op="new_application" />
          <span className="text-xs text-muted">{jd.trim() ? `${jd.trim().split(/\s+/).length} words` : ""}</span>
        </div>
      </section>
      <aside className="space-y-4">
        <div className="card space-y-2 text-sm">
          <div className="label">Workspace</div>
          <div>Master: {status?.master ? <b>{status.master.title}</b> : <span className="text-muted">not set</span>}</div>
          <div>Career bank: {status?.bank.accomplishments ?? 0} accomplishments</div>
          {!!status?.bank.openDiscrepancies && (
            <Link href="/bank" className="block text-amber-800 underline">{status.bank.openDiscrepancies} fact conflict(s) to resolve</Link>
          )}
        </div>
        <div className="card">
          <div className="label">Recent</div>
          {recent.length === 0 && <p className="text-sm text-muted">No applications yet.</p>}
          <ul className="divide-y divide-line">
            {recent.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/applications/${a.id}`} className="block text-sm hover:text-accent">
                  <div className="font-medium">{a.company}</div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="truncate">{a.job_title}</span>
                    {a.fit_level && <Badge tone={fitTone(a.fit_level)}>{a.fit_level}</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
