# 12 · Showcase slice (build now)

Owner of: the minimal slice we build first to show the client. It implements 4 features from the MVP (docs 00–11) with a simplified runtime that runs on this machine with **no keys** (demo mode) and upgrades to live AI when keys are added. Where this file and docs 00–11 differ, **this file wins for the slice**. The differences are listed in §3.

## 1. The 4 features

| # | Feature | What the user sees | Docs |
|---|---|---|---|
| **F1** | **Find: Search now with live progress** | Type what you offer + tick markets + lead type → *Search now* → live progress line ("Searched 3 of 5 sources · read 24 items · 6 relevant · 3 new leads") → link to new leads | 09 §4.1, 05, 06 |
| **F2** | **Leads inbox** | Tabs Genuine / Needs research / Watching / Rejected; cards with score, confidence, type, buyer → project (country), up to 3 reasons; Accept / Reject (with reason); 4 filters (market, product, type, status); CSV export | 09 §4.2, 07 |
| **F3** | **Lead page with proof** | Why this lead · Project (stage timeline) · Supply chain (owner → EPC → subcontractors → packages → requirements) · People · Buyer history (from the relationship graph) · Score breakdown (5 criteria, 17 sub-criteria, ✓/✗/unknown) · every fact has an ⓘ that shows the exact quote and source link | 09 §4.3, 07, 04 |
| **F4** | **Compliance and email draft** | Bid-compliance checklist for the lead's market (met / missing / unknown against the client profile) · outreach rules for each contact's country · *Draft email* → AI draft (subject + ≤120 words + opt-out line where required), editable, Copy, Mark as sent; disabled with the reason when the rule is `consent_needed` | 08 §2–3, 06 §6.3 |

**Deferred (not in the slice):** scheduled watchlists, research agent and research reports, contact derivation (email patterns, MX check), sanctions loaders (gate G7 is a stub that passes and says "not screened in demo"), Settings editing (a read-only Settings page shows the client profile), Health page, test-set tooling beyond unit tests, Supabase Auth.

## 2. Runtime for the slice

| Concern | Slice choice |
|---|---|
| Language | **TypeScript only**. The pipeline runs inside the Next.js server process as an async job (docs 02/03 describe a separate Python worker for the full MVP) |
| Database | **PGlite** (Postgres in WebAssembly, in-process, data in `.data/pglite`, gitignored) by default; if `DATABASE_URL` is set, the same SQL runs on Postgres/Supabase through `pg` |
| Jobs and progress | The run executes as a background promise; progress is written to `run_events`; the UI polls every 2 s |
| Auth | Demo password: `DEMO_PASSWORD` + `SESSION_SECRET` in `.env.local`; `/login` form; HMAC-signed httpOnly cookie; `src/proxy.ts` protects **every page and every `/api/*` route** except `/login` and `/api/mvp/login` |
| AI | Provider layer with `groq`, `cloudflare` (both OpenAI-compatible HTTP) and **`mock`**. With no keys, `mock` is used and the UI shows a small "Demo mode: AI simulated" badge. The mock is a deterministic rules-based extractor that only returns facts whose quotes exist in the text |
| Sources | Live: **EU TED search API** (no key; award notices give winners and values as structured fields), **GDELT DOC 2.0** (no key), **RSS** (a short configurable list of trade-press feeds). **Offline fixtures** when `MVP_OFFLINE=1` or when a source fails: synthetic documents in `src/mvp/pipeline/fixtures/`, clearly fictional (company names contain "Example"), and every fixture-derived lead carries a visible "Sample data" badge |
| Client profile | `src/mvp/config/client-profile.json` (example EPC profile: disciplines pipeline, piping, static_equipment; products line pipe API 5L X52–X70 4–48", valves; markets IN, SA, AE, NO, MY; served ports; certifications; registrations). Marked as an example to be replaced by the client's real data |

## 3. Differences from docs 00–11 (slice only)

- There is no Python worker, pgmq, pg_cron or Supabase Realtime. They're replaced as described in §2. The pipeline code is organised by the same stages (collect → read → filter → extract → quote check → resolve → signals → score), so it can move to the worker later.
- Two-model agreement: `both` needs two distinct providers. In demo mode both "models" are the mock, so facts are labelled `rule` when found by the rules-based mock, and **gates accept `rule` facts**. With live keys, model A = Groq `qwen3.8-27b`, model B = Cloudflare `@cf/openai/gpt-oss-20b` (06 §2).
- Schema: the tables below use `text` + `check` constraints instead of Postgres enums (portable to PGlite); ids are `uuid default gen_random_uuid()`.

## 4. Schema for the slice (subset of 04)

`runs`, `run_events`, `source_documents` (text stored in a `text` column), `evidence`, `fact_evidence`, `companies`, `projects`, `project_stage_events`, `packages`, `requirements`, `project_parties`, `people`, `person_roles`, `relationships`, `signals`, `leads`, `lead_score_history`, `activities`, `outreach_drafts`, `llm_usage`. Columns as in 04, minus the embedding columns. Migrations live in `src/mvp/db/migrations/NNN_*.sql` and run automatically on first connection.

## 5. Code layout and contracts

```
src/mvp/
  types.ts                 # shared domain types (lead, breakdown, evidence, run input...)
  config/client-profile.json + profile.ts   # getClientProfile()
  db/index.ts              # getDb(): Db  { query(sql, params), exec(sql), tx(fn) } ; PGlite or pg
  db/migrations/*.sql
  llm/index.ts             # getLLM(role) -> LLMProvider { name, complete({system,user,json}) }
  llm/groq.ts  cloudflare.ts  mock.ts  quota.ts
  pipeline/index.ts        # startRun(input: RunInput): Promise<string /* runId */>
  pipeline/sources/{ted,gdelt,rss,fixtures}.ts
  pipeline/{read,filter,extract,quote-check,agreement,resolve,graph}.ts
  pipeline/fixtures/*.json
  scoring/index.ts         # buildSignalsAndScore(runId): Promise<{created:number, updated:number}>
  scoring/{signals,gates,rubric,confidence,classify,reasons,config}.ts
  compliance/index.ts      # bidChecklist(leadId), outreachRules(countryCode, channel)
  compliance/rules.ts      # seed rules from 08 §2.1 and §3
  drafts/index.ts          # generateDraft(leadId, personId)
  repo.ts                  # read models for the UI: listLeads, getLeadDetail, getRun, updateLead, addActivity
src/app/(mvp)/find, leads, leads/[id], settings, login
src/app/api/mvp/{login,runs,runs/[id],leads,leads/[id],drafts}
src/components/mvp/*
src/app/legacy/*           # prototype pages moved here, admin-free for the demo but hidden from navigation
```

**Contracts (must not change without updating this file):**

```ts
// src/mvp/types.ts (excerpt)
export type LeadKind = 'bid' | 'supply_subcontract';
export type LeadClass = 'genuine' | 'research' | 'watch' | 'rejected';
export interface RunInput { query: string; markets: string[]; leadKinds: LeadKind[] }
export interface SubScore { id: string; label: string; max: number; points: number | null; /* null = unknown */ reason: string; evidenceIds: string[] }
export interface CriterionScore { id: 'C1'|'C2'|'C3'|'C4'|'C5'; label: string; max: number; total: number; subs: SubScore[] }
export interface GateResult { id: string; pass: boolean; why: string }
export interface Reason { text: string; evidenceIds: string[] }
```

Scoring follows 07 exactly: 8 gates, 5 criteria / 17 sub-criteria / 100 points, confidence formula (07 §5), classes (07 §8), reasons from templates (07 §9). The worked example in 07 §10 must be a unit test that returns 71 and class `genuine`.

## 6. Acceptance for the slice

1. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass.
2. With **no keys** and `MVP_OFFLINE=1`: log in → Find → Search now → progress updates → at least 3 leads across at least 2 classes appear → open a lead → every fact shows a quote → score breakdown sums correctly → compliance checklist and outreach rules show → Draft email works (or is disabled with a reason for `consent_needed` countries).
3. With network but no AI keys: TED and GDELT runs complete (or fail per-source without stopping the run); TED award notices can create supply leads without AI.
4. With `GROQ_API_KEY` (and optionally Cloudflare) set: the same flow uses live AI; quote check drops unsupported facts; `llm_usage` records tokens; daily budget respected.
5. Every page and `/api/*` route rejects requests without a session (test).
6. No secrets committed; `.env.example` documents every variable.

## 7. Environment variables (slice)

```
DEMO_PASSWORD=            # required; login password for the demo
SESSION_SECRET=           # required; 32+ random chars
DATABASE_URL=             # optional; Postgres/Supabase. Empty = PGlite in .data/pglite
MVP_OFFLINE=              # 1 = use fixtures only (no network)
GROQ_API_KEY=             # optional; enables live AI (model A)
CLOUDFLARE_ACCOUNT_ID=    # optional; model B
CLOUDFLARE_API_TOKEN=     # optional
LLM_DAILY_TOKEN_BUDGET__GROQ=180000
RSS_FEEDS=                # optional comma-separated list; defaults in code
```
