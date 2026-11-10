import { getDb, j } from "./db";

export interface Role {
  id: number;
  employer: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  summary: string | null;
  status: "unverified" | "verified";
}

export interface Metric {
  value: string;   // "38%", "$4.2M", "120 customers"
  context: string; // what the number measures
}

export interface Variant {
  id: number;
  accomplishment_id: number;
  text: string;
  framing: string | null;
  source_document_id: number | null;
  source_title?: string | null;
  origin: "resume" | "user";
}

export interface Accomplishment {
  id: number;
  role_id: number | null;
  employer?: string | null;
  title?: string | null;
  canonical: string;
  metrics: Metric[];
  skills: string[];
  themes: string[];
  job_categories: string[];
  status: "unverified" | "verified" | "disputed";
  notes: string | null;
  variants: Variant[];
  open_discrepancies: number;
}

export interface Discrepancy {
  id: number;
  accomplishment_id: number | null;
  kind: string;
  description: string;
  options: string[];
  resolved: number;
  resolution: string | null;
  canonical?: string;
}

type AccRow = Omit<Accomplishment, "metrics" | "skills" | "themes" | "job_categories" | "variants" | "open_discrepancies"> & {
  metrics_json: string; skills_json: string; themes_json: string; job_categories_json: string;
};

export const bank = {
  roles(): Role[] {
    return getDb().prepare("SELECT * FROM roles ORDER BY COALESCE(end_date,'9999') DESC, start_date DESC").all() as Role[];
  },
  upsertRole(r: { employer: string; title: string; start_date?: string | null; end_date?: string | null; location?: string | null }): number {
    const db = getDb();
    const found = db.prepare("SELECT id, start_date, end_date FROM roles WHERE lower(employer)=lower(?) AND lower(title)=lower(?)").get(r.employer, r.title) as
      | { id: number; start_date: string | null; end_date: string | null }
      | undefined;
    if (found) {
      // dates that disagree with the stored record become discrepancies; never silently overwritten
      if (r.start_date && found.start_date && r.start_date !== found.start_date) {
        bank.addDiscrepancy(null, "date", `${r.employer} / ${r.title}: start date differs between resumes`, [found.start_date, r.start_date]);
      }
      if (!found.start_date && r.start_date) db.prepare("UPDATE roles SET start_date=? WHERE id=?").run(r.start_date, found.id);
      if (!found.end_date && r.end_date) db.prepare("UPDATE roles SET end_date=? WHERE id=?").run(r.end_date, found.id);
      return found.id;
    }
    return Number(
      db.prepare("INSERT INTO roles (employer, title, start_date, end_date, location) VALUES (?,?,?,?,?)").run(r.employer, r.title, r.start_date ?? null, r.end_date ?? null, r.location ?? null)
        .lastInsertRowid,
    );
  },
  updateRole(id: number, patch: Partial<Role>) {
    const cur = getDb().prepare("SELECT * FROM roles WHERE id=?").get(id) as Role;
    const n = { ...cur, ...patch };
    getDb().prepare("UPDATE roles SET employer=?, title=?, start_date=?, end_date=?, location=?, summary=?, status=? WHERE id=?").run(n.employer, n.title, n.start_date, n.end_date, n.location, n.summary, n.status, id);
  },

  list(opts: { q?: string; status?: string } = {}): Accomplishment[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT a.*, r.employer, r.title FROM accomplishments a LEFT JOIN roles r ON r.id = a.role_id
         ${opts.status ? "WHERE a.status = @status" : ""} ORDER BY r.end_date IS NULL DESC, r.end_date DESC, a.id`,
      )
      .all(opts.status ? { status: opts.status } : {}) as (AccRow & { employer: string; title: string })[];
    const variants = db
      .prepare("SELECT v.*, s.title AS source_title FROM accomplishment_variants v LEFT JOIN source_documents s ON s.id = v.source_document_id")
      .all() as Variant[];
    const disc = db.prepare("SELECT accomplishment_id, COUNT(*) n FROM discrepancies WHERE resolved = 0 GROUP BY accomplishment_id").all() as { accomplishment_id: number; n: number }[];
    const dmap = new Map(disc.map((d) => [d.accomplishment_id, d.n]));
    let out = rows.map((r) => hydrate(r, variants.filter((v) => v.accomplishment_id === r.id), dmap.get(r.id) ?? 0));
    if (opts.q) {
      const terms = tokenize(opts.q);
      out = out.filter((a) => terms.every((t) => searchable(a).includes(t)));
    }
    return out;
  },
  get(id: number): Accomplishment | null {
    return bank.list().find((a) => a.id === id) ?? null;
  },
  create(a: { role_id: number | null; canonical: string; metrics?: Metric[]; skills?: string[]; themes?: string[]; job_categories?: string[]; status?: string }): number {
    return Number(
      getDb()
        .prepare("INSERT INTO accomplishments (role_id, canonical, metrics_json, skills_json, themes_json, job_categories_json, status) VALUES (?,?,?,?,?,?,?)")
        .run(a.role_id, a.canonical, JSON.stringify(a.metrics ?? []), JSON.stringify(a.skills ?? []), JSON.stringify(a.themes ?? []), JSON.stringify(a.job_categories ?? []), a.status ?? "unverified")
        .lastInsertRowid,
    );
  },
  update(id: number, patch: Partial<Pick<Accomplishment, "canonical" | "metrics" | "skills" | "themes" | "job_categories" | "status" | "notes" | "role_id">>) {
    const cur = bank.get(id);
    if (!cur) throw new Error("Accomplishment not found");
    const n = { ...cur, ...patch };
    getDb()
      .prepare("UPDATE accomplishments SET role_id=?, canonical=?, metrics_json=?, skills_json=?, themes_json=?, job_categories_json=?, status=?, notes=?, updated_at=datetime('now') WHERE id=?")
      .run(n.role_id, n.canonical, JSON.stringify(n.metrics), JSON.stringify(n.skills), JSON.stringify(n.themes), JSON.stringify(n.job_categories), n.status, n.notes, id);
  },
  remove(id: number) {
    getDb().prepare("DELETE FROM accomplishments WHERE id=?").run(id);
  },
  addVariant(accomplishment_id: number, text: string, framing: string | null, source_document_id: number | null, origin: "resume" | "user" = "resume") {
    getDb()
      .prepare("INSERT OR IGNORE INTO accomplishment_variants (accomplishment_id, text, framing, source_document_id, origin) VALUES (?,?,?,?,?)")
      .run(accomplishment_id, text.trim(), framing, source_document_id, origin);
  },
  removeVariant(id: number) {
    getDb().prepare("DELETE FROM accomplishment_variants WHERE id=?").run(id);
  },
  addDiscrepancy(accomplishment_id: number | null, kind: string, description: string, options: string[]) {
    const db = getDb();
    const dup = db.prepare("SELECT id FROM discrepancies WHERE description = ? AND resolved = 0").get(description);
    if (dup) return;
    db.prepare("INSERT INTO discrepancies (accomplishment_id, kind, description, options_json) VALUES (?,?,?,?)").run(accomplishment_id, kind, description, JSON.stringify(options));
    if (accomplishment_id) db.prepare("UPDATE accomplishments SET status='disputed' WHERE id=?").run(accomplishment_id);
  },
  discrepancies(includeResolved = false): Discrepancy[] {
    const rows = getDb()
      .prepare(`SELECT d.*, a.canonical FROM discrepancies d LEFT JOIN accomplishments a ON a.id = d.accomplishment_id ${includeResolved ? "" : "WHERE d.resolved = 0"} ORDER BY d.id DESC`)
      .all() as (Discrepancy & { options_json: string })[];
    return rows.map((r) => ({ ...r, options: j.parse<string[]>(r.options_json, []) }));
  },
  resolveDiscrepancy(id: number, resolution: string) {
    const db = getDb();
    const d = db.prepare("SELECT * FROM discrepancies WHERE id=?").get(id) as { accomplishment_id: number | null } | undefined;
    if (!d) throw new Error("Discrepancy not found");
    db.prepare("UPDATE discrepancies SET resolved=1, resolution=? WHERE id=?").run(resolution, id);
    if (d.accomplishment_id) {
      const open = db.prepare("SELECT COUNT(*) n FROM discrepancies WHERE accomplishment_id=? AND resolved=0").get(d.accomplishment_id) as { n: number };
      if (open.n === 0) {
        // the user's resolution is now the authoritative fact
        const a = bank.get(d.accomplishment_id)!;
        bank.update(d.accomplishment_id, { status: "verified", notes: [a.notes, `Confirmed: ${resolution}`].filter(Boolean).join("\n") });
      }
    }
  },
  facts(): { id: number; kind: string; value: string; status: string }[] {
    return getDb().prepare("SELECT * FROM facts ORDER BY kind, value").all() as { id: number; kind: string; value: string; status: string }[];
  },
  addFact(kind: string, value: string) {
    getDb().prepare("INSERT OR IGNORE INTO facts (kind, value) VALUES (?,?)").run(kind, value.trim());
  },
  removeFact(id: number) {
    getDb().prepare("DELETE FROM facts WHERE id=?").run(id);
  },
  stats() {
    const db = getDb();
    const q = (s: string) => (db.prepare(s).get() as { n: number }).n;
    return {
      roles: q("SELECT COUNT(*) n FROM roles"),
      accomplishments: q("SELECT COUNT(*) n FROM accomplishments"),
      verified: q("SELECT COUNT(*) n FROM accomplishments WHERE status='verified'"),
      variants: q("SELECT COUNT(*) n FROM accomplishment_variants"),
      openDiscrepancies: q("SELECT COUNT(*) n FROM discrepancies WHERE resolved=0"),
      sources: q("SELECT COUNT(*) n FROM source_documents"),
    };
  },
};

function hydrate(r: AccRow & { employer?: string; title?: string }, variants: Variant[], open: number): Accomplishment {
  return {
    id: r.id,
    role_id: r.role_id,
    employer: r.employer ?? null,
    title: r.title ?? null,
    canonical: r.canonical,
    metrics: j.parse(r.metrics_json, []),
    skills: j.parse(r.skills_json, []),
    themes: j.parse(r.themes_json, []),
    job_categories: j.parse(r.job_categories_json, []),
    status: r.status,
    notes: r.notes,
    variants,
    open_discrepancies: open,
  };
}

const STOP = new Set("a an the and or of to in for with on at by from as is are be this that we you our your will who what into across within per their its it has have".split(" "));
export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9+#.\-/]*/g) ?? []).map((t) => t.replace(/[.\-/]+$/, "")).filter((t) => t.length > 1 && !STOP.has(t));
}
function searchable(a: Accomplishment) {
  return [a.canonical, a.employer, a.title, ...a.skills, ...a.themes, ...a.job_categories, ...a.variants.map((v) => v.text), ...a.metrics.map((m) => m.value + " " + m.context)]
    .join(" ")
    .toLowerCase();
}

/**
 * Lightweight BM25 retrieval: rank accomplishments against JD keywords/priorities so only
 * the most relevant evidence goes into the expensive strategy prompt.
 */
export function retrieve(all: Accomplishment[], query: string[], k = 40): Accomplishment[] {
  if (all.length <= k) return all;
  const docs = all.map((a) => tokenize(searchable(a)));
  const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length;
  const qTerms = Array.from(new Set(query.flatMap(tokenize)));
  const df = new Map<string, number>();
  for (const t of qTerms) df.set(t, docs.filter((d) => d.includes(t)).length);
  const scored = all.map((a, i) => {
    const d = docs[i];
    let s = 0;
    for (const t of qTerms) {
      const tf = d.filter((x) => x === t).length;
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      s += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avg))));
    }
    if (a.status === "verified") s *= 1.15;
    if (a.status === "disputed") s *= 0.5;
    return { a, s };
  });
  return scored.sort((x, y) => y.s - x.s).slice(0, k).map((x) => x.a);
}

export function bankForPrompt(items: Accomplishment[]): string {
  if (!items.length) return "No accomplishment bank yet (only the master resume is available).";
  return items
    .map((a) => {
      const lines = [
        `[A${a.id}] (${a.status.toUpperCase()}) ${a.employer ?? "?"} — ${a.title ?? "?"}`,
        `  What happened: ${a.canonical}`,
      ];
      if (a.metrics.length) lines.push(`  Metrics: ${a.metrics.map((m) => `${m.value} (${m.context})`).join("; ")}`);
      if (a.open_discrepancies) lines.push(`  ⚠ ${a.open_discrepancies} unresolved discrepancy — do not use disputed numbers.`);
      for (const v of a.variants.slice(0, 4)) lines.push(`  Prior wording${v.framing ? ` [${v.framing}]` : ""}: "${v.text}"`);
      return lines.join("\n");
    })
    .join("\n");
}
