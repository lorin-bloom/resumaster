"use client";
import { useEffect, useState, type ReactNode } from "react";

export type Estimate = { usd: number; warnAbove: number; wouldExceed: boolean; monthSpent: number; monthLimit: number; appSpent: number | null; perAppLimit: number };
export const fmtUsd = (n: number) => (n <= 0 ? "$0.00" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

/** Ask the server what an operation will cost; warn above the threshold, block if a limit would be exceeded. */
export async function confirmCost(op: string, opts: { appId?: string | number; docs?: number; label?: string } = {}): Promise<boolean> {
  const q = new URLSearchParams({ op, ...(opts.appId ? { appId: String(opts.appId) } : {}), ...(opts.docs ? { docs: String(opts.docs) } : {}) });
  let e: Estimate;
  try {
    e = await api<Estimate>(`/api/estimate?${q}`);
  } catch {
    return true; // the server still enforces limits
  }
  if (e.wouldExceed) {
    alert(`This would go over your AI spending limit (≈${fmtUsd(e.usd)}; ${fmtUsd(e.monthSpent)} of ${fmtUsd(e.monthLimit)} used this month${e.appSpent != null ? `, ${fmtUsd(e.appSpent)} of ${fmtUsd(e.perAppLimit)} on this application` : ""}). Raise the limit in Memory & settings to continue.`);
    return false;
  }
  if (e.usd >= e.warnAbove) return confirm(`${opts.label ?? "This"} will use AI and cost about ${fmtUsd(e.usd)}. Continue?`);
  return true;
}

export function CostHint({ op, appId, docs }: { op: string; appId?: string | number; docs?: number }) {
  const [usd, setUsd] = useState<number | null>(null);
  useEffect(() => {
    const q = new URLSearchParams({ op, ...(appId ? { appId: String(appId) } : {}), ...(docs ? { docs: String(docs) } : {}) });
    api<Estimate>(`/api/estimate?${q}`).then((e) => setUsd(e.usd)).catch(() => {});
  }, [op, appId, docs]);
  if (usd == null) return null;
  return <span className="text-xs text-muted" title="Estimated AI cost">~{fmtUsd(usd)}</span>;
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn-ghost btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

const TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-rose-50 text-rose-800",
  gray: "bg-stone-100 text-stone-700",
  blue: "bg-sky-50 text-sky-800",
};
export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONES | string; children: ReactNode }) {
  return <span className={`badge ${TONES[tone] ?? TONES.gray}`}>{children}</span>;
}

export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="cursor-pointer select-none text-sm text-muted hover:text-ink">
        <span className="mr-1 inline-block transition group-open:rotate-90">›</span>
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>;
}

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg bg-ink px-4 py-3 text-sm text-white shadow-lg">
      <div className="flex items-start gap-3">
        <span>{message}</span>
        <button onClick={onClose} className="text-white/60 hover:text-white">✕</button>
      </div>
    </div>
  );
}

export const fitTone = (f?: string | null) => (f === "strong" ? "green" : f === "good" ? "blue" : f === "stretch" ? "amber" : f === "weak" ? "red" : "gray");
export const statusTone = (s: string) => (s === "pass" ? "green" : s === "warn" ? "amber" : "red");
