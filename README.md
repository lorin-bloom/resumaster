# Resumaster

**Live demo (fictional data):** https://resumaster-lemon.vercel.app

A personal AI career strategist. Paste a job description and get: a recruiter/hiring-manager read of the role, a requirement-to-evidence map against your verified history, restrained resume edits you accept or reject, a new Google Doc per application (your master is never touched), a validated ATS-readable PDF, "why fit" / "why this company" answers, and a LinkedIn note hard-capped at 300 characters. It remembers your writing rules and editorial decisions across applications.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in keys (see below)
npm run build && npm start   # or: npm run dev
```

Open http://localhost:3000 → **Setup** → connect Google → pick your master resume → import previous resumes.

### Google setup (one time, ~5 minutes)
1. Google Cloud Console → create a project.
2. **APIs & Services → Library**: enable **Google Docs API** and **Google Drive API**.
3. **OAuth consent screen**: External, add yourself as a **test user**. Scopes used: `drive.readonly`, `drive.file`, `documents`.
4. **Credentials → Create OAuth client ID → Web application**. Authorized redirect URI: `http://localhost:3000/api/auth/callback`.
5. Put the client ID/secret in `.env.local`.

## How it works

| Layer | File |
|---|---|
| Fact extraction (resumes → roles, accomplishments, metrics) | `src/lib/ai/tasks.ts` (`extractResume`, `reconcile`) |
| Career knowledge base + retrieval (BM25) + discrepancy tracking | `src/lib/knowledge.ts` |
| JD analysis · fit analysis · edit strategy · writing | `src/lib/ai/tasks.ts`, prompts in `src/lib/ai/prompts.ts` |
| Structured outputs + Zod validation, caching, cost tracking, spend limit | `src/lib/ai/client.ts` |
| Google Docs editing (copy master → apply only approved edits) | `src/lib/google/apply-edits.ts`, `drive.ts` |
| PDF validation | `src/lib/pdf/validate.ts` |
| Memory (preferences, feedback, classification) | `src/lib/memory.ts`, `services.ts#learnFromNote` |
| Persistence | SQLite at `data/resumaster.db` (git-ignored) |

**Truthfulness guardrails (enforced in code, not just prompts):** hallucinated bullet ids, cross-role moves and any edit using a *disputed* accomplishment are discarded; edits using *unverified* facts are flagged regardless of what the model claims; previous resumes are evidence — conflicts become discrepancies you resolve, never auto-picked.

**Formatting preservation:** the tailored doc is a Drive copy of your master, so fonts, margins, spacing, bullets and layout carry over. Only edited paragraphs are touched: their text is replaced and the original run style re-applied. Edits are applied in descending index order; if the master changed since analysis, the edit is refused rather than guessed. Limitation: a bullet with mixed inline styles (e.g. a bold lead-in) gets the paragraph's dominant style after editing.

**ATS validation:** text layer present, no corrupted glyphs, every paragraph and every approved edit present verbatim, employer/title/date strings intact and in order, reading order correct in both content-stream and row-by-row parsing (catches multi-column layouts), standard headings, page count unchanged from master. No invented ATS scores.

**Memory:** "never/always/don't…" style feedback becomes a saved rule (editable on Memory & settings); role-specific rejections, factual corrections, questions and changes that would weaken the application are classified separately. Rules and recent decisions are injected into every future prompt. Pushing back on a suggestion gets an independent answer (maintain / revise / withdraw), not automatic agreement.

## Cost controls (target: under $5/month for personal use)

| | |
|---|---|
| **Model routing** (`src/lib/ai/client.ts` → `TASK_ROUTES`) | High-quality model (default Opus 5.5): hiring-manager analysis, positioning, resume tailoring, disputed-edit evaluation, application answers. Low-cost model (default Haiku 5.5): JD requirement classification, accomplishment extraction, LinkedIn messages, shortening, note interpretation. Every task's model is switchable in **Memory & settings** at runtime, without a rebuild. |
| **No AI at all** | Copying Google Docs, applying accepted edits, PDF export + validation, character counting, saving preferences, viewing saved applications, comparing text, accepting/rejecting/editing suggestions, editing a LinkedIn message. Verified in `tests/cost.test.ts`. |
| **Caching** | Every model response is keyed by a SHA-256 of task + model + prompt; the master resume is re-parsed only when its Google revision id changes; JDs are hashed. Re-running with unchanged inputs costs $0. |
| **Small context** | Each task gets only what it needs: BM25 retrieval of the top accomplishments (25 for strategy, 12 for answers, 8 for a single-bullet challenge), the current resume, and only the writing rules/feedback for that target. Outreach gets just the 2–3 cited facts. |
| **Explicit AI actions** | Paid calls happen only on a button press, never on page load, tab switch, download or settings. Company research is opt-in per application, with its cost shown first. |
| **Limits** (server-side) | Monthly limit (default $5), per-application limit (default $1), confirmation prompt above a threshold (default $0.10), retries capped (default 1), duplicate concurrent operations rejected, identical in-flight requests shared. |
| **Dashboard** | Memory & settings → AI usage: month total vs limit, new vs cached requests, cost by application / model / task, estimated vs actual cost per application. |
| **Provider backstop** | Also set a spend limit on your key in the Anthropic Console (Settings → Limits). |

Expected cost with default models: roughly $0.30–0.45 for a new application (estimate shown before running; replaced by your real average once you have history). Resume imports are about a cent each.

**Development without spending:** `RESUMASTER_MOCK_AI=1 npm run dev` serves fixture responses for every AI task. Automated tests (`npm test`) never call a model.

## Public portfolio demo
Deploy with `RESUMASTER_PUBLIC_DEMO=1`: every private page and API returns 404/redirects; only `/demo` is served, using a fictional candidate (`src/lib/demo/fixtures.ts`). The demo shows a **precomputed example** (labelled as such). Live AI runs are off unless you set `DEMO_LIVE=1` and an `ANTHROPIC_API_KEY`. If you enable it, put a spend limit on that key in the Anthropic Console: on serverless hosts the in-app limits live in a temporary per-instance database and are not a reliable cap.

## Tests
```bash
npm test
```
Covers Docs edit index math (simulated batchUpdate incl. moves/removals/style restore), PDF validation (clean, clipped, overflow, corrupted dates, two-column scramble, image-only), the 300-char LinkedIn limit (incl. a 2,000-message fuzz), and the full pipeline with a stubbed model (sanitization, length enforcement, feedback learning, memory surviving a restart, revision numbering, spend limit).
