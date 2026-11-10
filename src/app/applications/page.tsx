"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Badge, fitTone, fmtUsd } from "@/components/ui";

type Row = { id: number; company: string; job_title: string; status: string; revision: number; created_at: string; updated_at: string; edit_count: number; doc_url: string | null; fit_level: string | null; cost_usd: number };

export default function History() {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    api<{ applications: Row[] }>("/api/applications").then((r) => setRows(r.applications));
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Application history</h1>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="px-4 py-2.5">Role</th><th className="px-4">Fit</th><th className="px-4">Status</th><th className="px-4">Rev</th><th className="px-4">Doc</th><th className="px-4">AI cost</th><th className="px-4">Created</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows?.map((r) => (
              <tr key={r.id} className="hover:bg-stone-50">
                <td className="px-4 py-2.5"><Link href={`/applications/${r.id}`} className="font-medium hover:text-accent">{r.company}</Link><div className="text-xs text-muted">{r.job_title}</div></td>
                <td className="px-4">{r.fit_level ? <Badge tone={fitTone(r.fit_level)}>{r.fit_level}</Badge> : "—"}</td>
                <td className="px-4 capitalize">{r.status}</td>
                <td className="px-4">{r.revision}</td>
                <td className="px-4">{r.doc_url ? <a href={r.doc_url} target="_blank" className="text-accent underline">Open</a> : "—"}</td>
                <td className="px-4 text-muted">{fmtUsd(r.cost_usd ?? 0)}</td>
                <td className="px-4 text-muted">{new Date(r.created_at + "Z").toLocaleDateString()}</td>
              </tr>
            ))}
            {rows?.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">Nothing yet — paste a job description to start.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
