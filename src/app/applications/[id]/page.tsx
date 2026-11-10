"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { FitAnalysis, JDAnalysis } from "@/lib/ai/schemas";
import { api, Badge, CopyButton, CostHint, Disclosure, ErrorNote, Spinner, Toast, confirmCost, fmtUsd } from "@/components/ui";
import { EditCard, OutreachMessage, RECIPIENTS, RoleAnalysis, ValidationList, type EditView, type Validation } from "@/components/panels";

interface AnswerRow { id: number; kind: string; question: string; answer: string; limit_type: string | null; limit_value: number | null; needs_input: string | null; meta_json: string | null; saved: number }
interface OutreachRow { id: number; recipient_type: string; recipient_context: string | null; message: string; char_count: number; alternatives_json: string; created_at: string }
interface DocRow { id: number; revision: number; doc_url: string; doc_name: string; validation_json: string; created_at: string }
interface Data {
  app: { id: number; company: string; job_title: string; jd_text: string; status: string; revision: number; created_at: string };
  analysis: JDAnalysis | null;
  fit: FitAnalysis | null;
  editsMeta: { verdict: string; summary: string; keep_count: number; dropped?: string[] } | null;
  edits: EditView[];
  answers: AnswerRow[];
  outreach: OutreachRow[];
  docs: DocRow[];
  siblings: { id: number; revision: number }[];
  cost: { cost: number; calls: number; cached: number };
  research: string | null;
}
type Learned = { learned: { classification: string; response: string; savedRule: { rule: string } | null } | null };

const STATUSES = ["draft", "ready", "applied", "interviewing", "rejected", "offer", "archived"];

export default function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const started = useRef(false);

  const load = useCallback(async () => {
    try { setD(await api<Data>(`/api/applications/${id}`)); } catch (e) { setError((e as Error).message); }
  }, [id]);

  const analyze = useCallback(async (sections?: string[]) => {
    setRunning(sections ? `Regenerating ${sections.join(", ")}…` : "Mapping your history to the role, drafting edits, answers and outreach…");
    setError(null);
    try {
      const r = await api<{ errors: string[] }>(`/api/applications/${id}/analyze`, { method: "POST", json: { sections } });
      if (r.errors.length) setError(r.errors.join(" · "));
    } catch (e) { setError((e as Error).message); }
    setRunning(null);
    await load();
  }, [id, load]);

  useEffect(() => {
    load().then(() => {});
  }, [load]);
  useEffect(() => {
    if (d && !d.fit && search.get("run") && !started.current) {
      started.current = true;
      router.replace(`/applications/${id}`); // a page reload must never re-trigger a paid run
      analyze();
    }
  }, [d, search, analyze, router, id]);

  const reportLearning = (r: Learned) => {
    if (r.learned?.savedRule) setToast(`Saved as a writing rule: “${r.learned.savedRule.rule}”`);
    else if (r.learned) setToast(r.learned.response);
  };

  if (!d) return <div className="text-sm text-muted">{error ?? <><Spinner /> Loading…</>}</div>;
  const pending = d.edits.filter((e) => e.decision === "pending").length;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted">Application · Rev {d.app.revision}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{d.app.company} <span className="font-normal text-muted">—</span> {d.app.job_title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-auto py-1.5" value={d.app.status} onChange={async (e) => { await api(`/api/applications/${id}`, { method: "PATCH", json: { status: e.target.value } }); load(); }}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="text-xs text-muted" title={`${d.cost.calls} AI requests, ${d.cost.cached} served from cache`}>AI cost {fmtUsd(d.cost.cost)}</span>
          <button className="btn-ghost" disabled={!!running} onClick={async () => { if (await confirmCost("analyze", { appId: id, label: "Re-running the analysis" })) analyze(); }}>Re-run</button>
        </div>
      </header>

      {running && <div className="flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-3 text-sm"><Spinner className="text-accent" /> {running} <span className="text-muted">This usually takes 1–2 minutes.</span></div>}
      <ErrorNote error={error} />

      {d.analysis && <RoleAnalysis jda={d.analysis} fit={d.fit} />}

      {/* -------- Resume -------- */}
      {d.fit && (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2">Resume</h2>
            <span className="flex items-center gap-2"><CostHint op="edits" appId={id} /><button className="btn-ghost btn-sm" disabled={!!running} onClick={async () => { if (await confirmCost("edits", { appId: id, label: "Regenerating recommendations" })) analyze(["edits"]); }}>Regenerate pending recommendations</button></span>
          </div>
          {d.editsMeta && (
            <p className="text-sm">
              <Badge tone={d.editsMeta.verdict === "already_strong" ? "green" : "blue"}>{d.editsMeta.verdict.replace(/_/g, " ")}</Badge>{" "}
              {d.editsMeta.summary} <span className="text-muted">{d.editsMeta.keep_count} bullets kept as written.</span>
            </p>
          )}
          {d.edits.length === 0 && !running && <p className="text-sm text-muted">No changes recommended — your master resume already makes the case for this role.</p>}
          <div className="space-y-3">
            {d.edits.map((e) => (
              <EditCard
                key={e.id + e.decision + (e.proposed_text ?? "")}
                e={e}
                onDecide={async (decision, finalText, note) => {
                  const r = await api<Learned>(`/api/edits/${e.id}`, { method: "PATCH", json: { decision, finalText, note: note?.trim() || null } });
                  reportLearning(r);
                  await load();
                }}
                onChallenge={async (message) => {
                  if (!(await confirmCost("challenge", { appId: id }))) return;
                  const r = await api<{ stance: string; response: string }>(`/api/edits/${e.id}`, { method: "POST", json: { message } });
                  await load();
                  return r;
                }}
              />
            ))}
          </div>
          {!!d.editsMeta?.dropped?.length && (
            <Disclosure summary={`${d.editsMeta.dropped.length} AI suggestion(s) discarded by safety checks`}>
              <ul className="text-xs text-muted">{d.editsMeta.dropped.map((x) => <li key={x}>{x}</li>)}</ul>
            </Disclosure>
          )}
          <ExportBlock id={id} pending={pending} docs={d.docs} onDone={load} />
        </section>
      )}

      {/* -------- Answers -------- */}
      {d.fit && <AnswersBlock id={id} answers={d.answers} research={d.research} reload={load} onToast={setToast} regenerate={async () => { if (await confirmCost("answers", { appId: id, label: "Regenerating answers" })) analyze(["answers"]); }} busy={!!running} />}

      {/* -------- Outreach -------- */}
      {d.fit && <OutreachBlock id={id} rows={d.outreach} reload={load} />}

      <section className="card">
        <Disclosure summary="Saved job description">
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{d.app.jd_text}</pre>
        </Disclosure>
      </section>
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function ExportBlock({ id, pending, docs, onDone }: { id: string; pending: number; docs: DocRow[]; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn-primary"
          disabled={busy || pending > 0}
          onClick={async () => {
            setBusy(true); setError(null);
            try { await api(`/api/applications/${id}/finalize`, { method: "POST" }); onDone(); } catch (e) { setError((e as Error).message); }
            setBusy(false);
          }}
        >
          {busy ? <><Spinner /> Creating Google Doc & validating PDF…</> : docs.length ? "Create new revision doc + PDF" : "Create Google Doc + PDF"}
        </button>
        {pending > 0 && <span className="text-xs text-muted">Decide on {pending} remaining recommendation(s) first.</span>}
        <span className="text-xs text-muted">Your master is never modified — each run creates a new doc in “Resumaster Applications”.</span>
      </div>
      <ErrorNote error={error} />
      {docs.map((doc, i) => {
        const v = JSON.parse(doc.validation_json) as Validation;
        return (
          <div key={doc.id} className={`rounded-lg border p-4 ${i === 0 ? "border-line" : "border-dashed border-line opacity-80"}`}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-medium">{doc.doc_name}</span>
              <Badge tone={v.ok ? "green" : "red"}>{v.ok ? "validated" : "needs review"}</Badge>
              <span className="text-xs text-muted">{v.pageCount} page(s)</span>
              <span className="ml-auto flex gap-2">
                <a className="btn-ghost btn-sm" href={doc.doc_url} target="_blank" rel="noreferrer">Open Google Doc</a>
                <a className="btn-primary btn-sm" href={`/api/applications/${id}/pdf?rev=${doc.revision}`}>Download PDF</a>
              </span>
            </div>
            {i === 0 ? <ValidationList v={v} /> : <Disclosure summary="Validation"><ValidationList v={v} /></Disclosure>}
          </div>
        );
      })}
    </div>
  );
}

function AnswersBlock({ id, answers, research, reload, onToast, regenerate, busy }: { id: string; answers: AnswerRow[]; research: string | null; reload: () => void; onToast: (s: string) => void; regenerate: () => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [limitType, setLimitType] = useState<"" | "words" | "chars">("");
  const [limitValue, setLimitValue] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="h2">Application answers</h2>
        <button className="btn-ghost btn-sm" disabled={busy} onClick={regenerate}>Regenerate standard answers</button>
      </div>
      {answers.map((a) => <AnswerCard key={a.id + a.answer.length} a={a} appId={id} research={research} reload={reload} onToast={onToast} />)}
      <div className="space-y-2 border-t border-line pt-4">
        <div className="label">Another question</div>
        <textarea className="input min-h-16" placeholder="Paste an application question…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto py-1.5" value={limitType} onChange={(e) => setLimitType(e.target.value as "" | "words" | "chars")}>
            <option value="">Default length</option>
            <option value="words">Word limit</option>
            <option value="chars">Character limit</option>
          </select>
          {limitType && <input className="input w-28 py-1.5" type="number" min={20} placeholder="Limit" value={limitValue} onChange={(e) => setLimitValue(e.target.value)} />}
          <button
            className="btn-primary"
            disabled={!q.trim() || working || (!!limitType && !limitValue)}
            onClick={async () => {
              if (!(await confirmCost("answer", { appId: id }))) return;
              setWorking(true); setError(null);
              try {
                await api(`/api/applications/${id}/answers`, { method: "POST", json: { question: q, limitType: limitType || null, limitValue: limitValue ? Number(limitValue) : null } });
                setQ(""); setLimitValue(""); reload();
              } catch (e) { setError((e as Error).message); }
              setWorking(false);
            }}
          >
            {working ? <Spinner /> : "Draft answer"}
          </button>
        </div>
        <ErrorNote error={error} />
      </div>
    </section>
  );
}

function AnswerCard({ a, appId, research, reload, onToast }: { a: AnswerRow; appId: string; research: string | null; reload: () => void; onToast: (s: string) => void }) {
  const [text, setText] = useState(a.answer);
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const meta = a.meta_json ? (JSON.parse(a.meta_json) as { assumptions?: string[]; cliches?: string[]; research?: boolean }) : {};
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const dirty = text !== a.answer;
  const over = a.limit_type === "words" ? words > (a.limit_value ?? 1e9) : a.limit_type === "chars" ? text.length > (a.limit_value ?? 1e9) : false;
  return (
    <div className="rounded-lg border border-line p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{a.question}</span>
        {a.saved ? <Badge tone="green">saved</Badge> : null}
        {meta.research && <Badge tone="blue">uses company research</Badge>}
      </div>
      <textarea className="input min-h-32 leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CopyButton text={text} />
        <button
          className="btn-ghost btn-sm"
          disabled={!!busy}
          onClick={async () => {
            setBusy("s");
            const r = await api<Learned>(`/api/answers/${a.id}`, { method: "PATCH", json: { answer: text, note: note.trim() || undefined } });
            if (r.learned?.savedRule) onToast(`Saved as a writing rule: “${r.learned.savedRule.rule}”`);
            setBusy(null); setNote(""); reload();
          }}
        >
          {busy === "s" ? <Spinner /> : dirty ? "Save my edits" : "Save"}
        </button>
        <span className={`text-xs ${over ? "text-rose-700" : "text-muted"}`}>
          {words} words · {text.length} chars{a.limit_type ? ` · limit ${a.limit_value} ${a.limit_type}` : ""}
        </span>
      </div>
      {dirty && <input className="input mt-2 text-xs" placeholder="Optional: what should I do differently next time? (general rules are remembered)" value={note} onChange={(e) => setNote(e.target.value)} />}
      {a.needs_input && (
        <div className="mt-3 space-y-2 rounded-md bg-amber-50 p-3 text-sm">
          <div><b>One question to make this genuine:</b> {a.needs_input}</div>
          <div className="flex gap-2">
            <input className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Your answer (a sentence or two is enough)" />
            <button
              className="btn-primary btn-sm"
              disabled={!reply.trim() || !!busy}
              onClick={async () => {
                if (!(await confirmCost("answer", { appId }))) return;
                setBusy("r");
                await api(`/api/applications/${appId}/answers`, { method: "POST", json: { question: a.question, limitType: a.limit_type, limitValue: a.limit_value, userInput: reply, answerId: a.id } });
                setBusy(null); setReply(""); reload();
              }}
            >
              {busy === "r" ? <Spinner /> : "Rewrite"}
            </button>
          </div>
        </div>
      )}
      {a.kind === "why_company" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          {research ? (
            <Disclosure summary="Company research used (verified vs. inferred)"><pre className="whitespace-pre-wrap text-xs">{research}</pre></Disclosure>
          ) : (
            <>
              <span>Written from the job description only.</span>
              <button
                className="btn-ghost btn-sm"
                disabled={!!busy}
                onClick={async () => {
                  if (!(await confirmCost("research", { appId, label: "Company research (web search) + rewriting this answer" }))) return;
                  setBusy("x");
                  try { await api(`/api/applications/${appId}/research`, { method: "POST" }); reload(); } catch (e) { onToast((e as Error).message); }
                  setBusy(null);
                }}
              >
                {busy === "x" ? <Spinner /> : "Research the company & rewrite"}
              </button>
              <CostHint op="research" appId={appId} />
            </>
          )}
        </div>
      )}
      {(!!meta.assumptions?.length || !!meta.cliches?.length) && (
        <div className="mt-2 text-xs text-muted">
          {!!meta.assumptions?.length && <div>Inferred, not verified: {meta.assumptions.join("; ")}</div>}
          {!!meta.cliches?.length && <div className="text-amber-800">Possible cliché detected — consider rewording.</div>}
        </div>
      )}
    </div>
  );
}

function OutreachBlock({ id, rows, reload }: { id: string; rows: OutreachRow[]; reload: () => void }) {
  const [type, setType] = useState<string>(rows[0]?.recipient_type ?? "recruiter");
  const [ctx, setCtx] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = rows.find((r) => r.recipient_type === type) ?? null;
  return (
    <section className="card space-y-4">
      <h2 className="h2">LinkedIn outreach</h2>
      <div className="flex flex-wrap gap-1">
        {RECIPIENTS.map(([k, label]) => (
          <button key={k} className={`btn-sm rounded-md px-3 py-1 text-sm ${type === k ? "bg-accent text-white" : "border border-line bg-white"}`} onClick={() => setType(k)}>{label}</button>
        ))}
      </div>
      {current ? (
        <EditableOutreach key={current.id + current.message} row={current} reload={reload} />
      ) : (
        <p className="text-sm text-muted">No message for this recipient yet.</p>
      )}
      <Disclosure summary="Personalize with recipient context (optional)">
        <textarea className="input min-h-24 text-sm" placeholder="Name, title, profile text, a recent post… Only used if it genuinely helps; I never imply you know them." value={ctx} onChange={(e) => setCtx(e.target.value)} />
      </Disclosure>
      <div className="flex items-center gap-2">
        <button
          className="btn-primary"
          disabled={busy}
          onClick={async () => {
            if (!(await confirmCost("outreach", { appId: id }))) return;
            setBusy(true); setError(null);
            try { await api(`/api/applications/${id}/outreach`, { method: "POST", json: { recipientType: type, recipientContext: ctx } }); reload(); } catch (e) { setError((e as Error).message); }
            setBusy(false);
          }}
        >
          {busy ? <Spinner /> : current ? "Write a new version" : "Write message"}
        </button>
        <CostHint op="outreach" appId={id} />
        <span className="text-xs text-muted">Hard limit enforced in code: 300 characters.</span>
      </div>
      <ErrorNote error={error} />
    </section>
  );
}

function EditableOutreach({ row, reload }: { row: OutreachRow; reload: () => void }) {
  const [text, setText] = useState(row.message);
  const [error, setError] = useState<string | null>(null);
  const n = Math.max(text.length, [...text].length);
  const dirty = text !== row.message;
  const alts = JSON.parse(row.alternatives_json) as { message: string; chars: number }[];
  return (
    <div className="space-y-2">
      <textarea className="input min-h-24 text-sm leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <CopyButton text={text} />
        {dirty && (
          <button className="btn-ghost btn-sm" disabled={n > 300} onClick={async () => {
            setError(null);
            try { await api(`/api/outreach/${row.id}`, { method: "PATCH", json: { message: text } }); reload(); } catch (e) { setError((e as Error).message); }
          }}>Save edit</button>
        )}
        <span className={`text-xs ${n > 300 ? "font-medium text-rose-700" : "text-muted"}`}>{n}/300 characters</span>
        {dirty && <span className="text-xs text-muted">Editing is free — nothing is regenerated.</span>}
      </div>
      <ErrorNote error={error} />
      {alts.length > 0 && <Disclosure summary="Alternatives"><OutreachMessage message={alts[0].message} chars={alts[0].chars} alternatives={alts.slice(1)} /></Disclosure>}
    </div>
  );
}
