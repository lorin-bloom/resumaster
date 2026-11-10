import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

/**
 * Persistent store. One SQLite file per mode:
 *   data/resumaster.db  - private career data (never served in public demo mode)
 *   data/demo.db        - fictional demo data / AI usage for the public demo
 * Tests set RESUMASTER_DB to a temp path or ":memory:".
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Google Docs used as evidence sources (master + previous resumes)
CREATE TABLE IF NOT EXISTS source_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_doc_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('master','previous')),
  revision_id TEXT,
  text TEXT,
  structure_json TEXT,       -- parsed paragraphs (cached per revision)
  outline_json TEXT,         -- AI outline: roles, headings (cached per revision)
  imported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Career Facts: roles
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employer TEXT NOT NULL,
  title TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  location TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','verified')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(employer, title)
);

-- Career Facts: accomplishment library
CREATE TABLE IF NOT EXISTS accomplishments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
  canonical TEXT NOT NULL,             -- what actually happened, plain statement
  metrics_json TEXT NOT NULL DEFAULT '[]',
  skills_json TEXT NOT NULL DEFAULT '[]',
  themes_json TEXT NOT NULL DEFAULT '[]',
  job_categories_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','verified','disputed')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Different framings of the same accomplishment, with their evidence source
CREATE TABLE IF NOT EXISTS accomplishment_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  accomplishment_id INTEGER NOT NULL REFERENCES accomplishments(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  framing TEXT,                        -- e.g. 'product marketing', 'revenue impact'
  source_document_id INTEGER REFERENCES source_documents(id) ON DELETE SET NULL,
  origin TEXT NOT NULL DEFAULT 'resume' CHECK (origin IN ('resume','user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(accomplishment_id, text)
);

-- Conflicts between evidence sources (never auto-resolved)
CREATE TABLE IF NOT EXISTS discrepancies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  accomplishment_id INTEGER REFERENCES accomplishments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                  -- metric | ownership | date | title | other
  description TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  resolved INTEGER NOT NULL DEFAULT 0,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Other verified facts: skills, tools, education, certifications, industries
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified',
  UNIQUE(kind, value)
);

-- Writing Preferences (persistent editorial rules)
CREATE TABLE IF NOT EXISTS preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'style',   -- style | tone | accuracy | terminology | format | process
  applies_to TEXT NOT NULL DEFAULT 'all',   -- all | resume | answers | outreach
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT,                              -- 'explicit' | 'feedback:<id>'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Editorial Feedback (accept/reject/edit/comment, classified)
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
  edit_id INTEGER REFERENCES edits(id) ON DELETE SET NULL,
  target TEXT NOT NULL DEFAULT 'resume',    -- resume | answer | outreach | general
  action TEXT NOT NULL,                     -- accepted | rejected | edited | comment | instruction
  original_text TEXT,
  proposed_text TEXT,
  final_text TEXT,
  user_note TEXT,
  classification TEXT,                      -- global_preference | factual_correction | role_specific | subjective | would_weaken | question | none
  ai_response TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Application History
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT,
  job_title TEXT,
  jd_text TEXT NOT NULL,
  jd_hash TEXT NOT NULL,
  analysis_json TEXT,       -- JD analysis (hiring-manager view)
  fit_json TEXT,            -- fit + requirement-to-evidence map
  edits_meta_json TEXT,     -- overall verdict from edit pass
  master_document_id INTEGER REFERENCES source_documents(id),
  master_revision_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  parent_id INTEGER REFERENCES applications(id),
  status TEXT NOT NULL DEFAULT 'draft',     -- draft | ready | applied | interviewing | rejected | offer | archived
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  bullet_id TEXT NOT NULL,                  -- paragraph id in master structure, e.g. p17
  action TEXT NOT NULL,                     -- refine | reposition | replace | remove
  original_text TEXT NOT NULL,
  proposed_text TEXT,
  move_before_bullet_id TEXT,
  rationale TEXT NOT NULL,
  impact TEXT NOT NULL DEFAULT 'medium',
  substantive INTEGER NOT NULL DEFAULT 1,
  jd_terms_json TEXT NOT NULL DEFAULT '[]',
  accomplishment_ids_json TEXT NOT NULL DEFAULT '[]',
  uses_unverified INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected','edited')),
  final_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Generated Google Docs + PDFs (one row per revision; never overwritten)
CREATE TABLE IF NOT EXISTS application_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  google_doc_id TEXT NOT NULL,
  doc_url TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  pdf_path TEXT,
  validation_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                       -- fit | why_company | custom
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  limit_type TEXT,                          -- words | chars | null
  limit_value INTEGER,
  needs_input TEXT,                         -- focused question when info insufficient
  meta_json TEXT,
  saved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL,
  recipient_context TEXT,
  message TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  evaluation_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cost tracking
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  cached_hit INTEGER NOT NULL DEFAULT 0,
  application_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI response cache (keyed by hash of task+model+prompt)
CREATE TABLE IF NOT EXISTS ai_cache (
  key TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const globalForDb = globalThis as unknown as { __rmDbs?: Map<string, Database.Database> };

export function dbPath(): string {
  if (process.env.RESUMASTER_DB) return process.env.RESUMASTER_DB;
  const file = process.env.RESUMASTER_PUBLIC_DEMO === "1" ? "demo.db" : "resumaster.db";
  // Serverless hosts (Vercel) have a read-only app directory; /tmp is the only writable place.
  if (process.env.VERCEL) return path.join("/tmp", file);
  return path.join(process.cwd(), "data", file);
}

export function getDb(p: string = dbPath()): Database.Database {
  globalForDb.__rmDbs ??= new Map();
  const existing = globalForDb.__rmDbs.get(p);
  if (existing) return existing;
  if (p !== ":memory:") fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  globalForDb.__rmDbs.set(p, db);
  return db;
}

function migrate(db: Database.Database) {
  const cols = (db.prepare("PRAGMA table_info(ai_calls)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("application_id")) db.exec("ALTER TABLE ai_calls ADD COLUMN application_id INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS ai_calls_app ON ai_calls(application_id); CREATE INDEX IF NOT EXISTS ai_calls_created ON ai_calls(created_at)");
}

export function resetDbCache() {
  globalForDb.__rmDbs?.forEach((d) => d.close());
  globalForDb.__rmDbs = new Map();
}

export function getSetting<T = string>(key: string, fallback?: T): T | undefined {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}

export function setSetting(key: string, value: unknown) {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, JSON.stringify(value));
}

export function deleteSetting(key: string) {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

export const j = {
  parse<T>(s: string | null | undefined, fallback: T): T {
    if (!s) return fallback;
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  },
};
