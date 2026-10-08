# 16 · Hybrid lead sourcing + evidence-table UI (implementation spec)

Audience: the implementing agent (Claude Codex / Claude Code). Owner of: the next engine and UI iteration on branch `checkpoint/local-demo-2026-10-08` (or a branch from it). **Where this file differs from docs 12–15 and `docs/reliable-discovery/*`, this file wins.** Nothing in it authorises emailing anyone other than the approved demo inbox, cloud migrations, or deployment.

Written 8 Oct 2026 from a measured baseline (§1). Every number below comes from runs that are saved under the session scratchpad `eval/*.json` and from the app's own run records.

---

## 0. One-paragraph summary

Today the app has two engines that do not talk to each other. The **award-signal engine** (TED awards, Bing News, RSS → Groq extraction → quote check → company/project/deal records; the "legacy" path) finds *buyers with a trigger*: who just won work, when, how much, with the article as proof. The **discovery engine** (Tavily → company capability pages → Groq → quote check; the current "product search" path) finds *companies that do this kind of work* but with no trigger, no date, no project, no contact, and it discards most of what it reads. The measured yield is 0–3 companies per search against 7–11 for the award engine. The fix is a **hybrid pipeline** that runs both, fans out every company named in award roundups and directories, decides the operating country from the work (not the HQ), and writes everything into one evidence-linked model. The UI then shows it the way the earlier Vercel build did and the client liked: **tables** (leads · contractors · subcontractors · contacts), each row opening an **evidence drawer on the right** that lists the articles and quotes it came from, while keeping the current lead workspace flow (fit review → contacts → email → conversation → meeting) underneath.

---

## 1. Measured baseline (do not skip; this is the benchmark)

Three fresh searches on 8 Oct 2026, isolated instance, real keys (Groq, Tavily), email off:

| Run | Engine | Time | Searches/reads/AI | Saved buyers | Quality |
|---|---|---|---|---|---|
| A · "line pipe", IN+AE, batch, target 10 | discovery | 6.8 min | 6 Tavily / 25 reads (7 unreadable) / 7 AI (2 failed) | **1** Tekzone | capability page only; wrong role label "Water/sewer contractor"; country blank; fit 0/low; stopped on "AI budget exhausted" at 27.9k/30k tokens |
| B · "power and control cables", AE, batch, target 10 | discovery | 6.3 min | 6 / 42 / 6 | **2** EMC Global, Sama Al Shahba | same shape; 10 candidates included junk entities ("United Arab Emirates", "Key Players & More", "World Nuclear Association", a Weebly spam page) |
| C · "pipeline", IN+SA+AE+NO+MY | award-signal | 5.5 min | 0 Tavily / 51 reads / 33 AI | **7 tier-1 + 2 tier-2** KPIL (INR 40B, Sep 2026), West-team AS (NOK 19.2M TED award), Welspun, EPIC, Trondheim tender… | each with deal, date, value, 1–5 quoted proofs; 145 facts kept, 9 dropped by quote check |

Your eight earlier searches (4–7 Oct) produced 7 companies in total, including an article title saved as a company ("Cable Laying in UAE: Essential Services…" labelled *Pipeline builder*).

**False negatives observed in A and B (the real cost):**
- KEC International (major Indian pipeline EPC): its "Oil & Gas Pipelines" page was read and rejected ("no material-consuming work established").
- Jan De Nul (building a $3.8B HVDC cable project in Abu Dhabi): rejected "country is outside the selected search" because the HQ is Belgian.
- "DEWA awards 21 contracts worth AED 3 billion for 132kV substations and transmission cable projects" (saudigulfprojects.com) was read; **zero** buyers came out of it.
- "Top 25 pipeline construction contractors in India", IndiaMART gas-pipeline-construction, "Top 10 oil & gas contracting companies in Abu Dhabi": each produced **one** seed instead of 10–25.
- Reads wasted on IBISWorld (US), Wikipedia, Mordor Intelligence, LNG database pages, an advertising page.

**Benchmark set (must be found by the hybrid engine, same three queries):** KPIL, KEC International, Jan De Nul (as UAE operating), ≥ 5 of the DEWA 21 awardees, Tekzone, EMC Global, West-team AS, Welspun Corp, EPIC. **Must not be saved:** "United Arab Emirates", "Key Players & More", "World Nuclear Association", article titles, consultants (Norconsult, VALDEL EC), market-report publishers.

Release gate for this spec: on the three benchmark queries, **≥ 15 saved buyers in total, ≥ 60 % with a dated trigger, 0 junk entities, ≥ 7 of the 9 benchmark companies found, cost ≤ 8 Tavily credits and ≤ 90k Groq tokens per search.**

---

## 2. Target architecture (engine)

```
                    ┌──────────────── one search (product + markets [+ keyword]) ────────────────┐
                    │                                                                            │
   SOURCE PLANNER   │  trigger lane            capability lane           directory/roundup lane  │
                    │  (awards, orders,        (companies that do         (pages that list many    │
                    │   tenders, filings)       this work)                 companies)             │
                    └─────────┬────────────────────────┬──────────────────────────┬──────────────┘
                              ▼                        ▼                          ▼
   COLLECT   TED · Bing News · RSS · Tavily(news) · Tavily(web) · registry sources (portals, filings, DEWA-type lists)
                              │  (politeness, robots, per-domain caps, junk-domain blocklist BEFORE reading)
                              ▼
   READ      full text + tables + links · PDF via worker · page classifier → {article, company_site, directory, roundup, tender_notice, junk}
                              │
                              ▼
   EXTRACT   award engine (P1 parties/project/value/date · P2 packages/specs · P3 people)   ← articles, tender notices, filings
             roundup fan-out (every company + what it won/does, each with its own quote)    ← roundups, directories, award lists
             capability extraction (company · activity · material · operating country)     ← company sites
             all facts quote-checked against the stored page text (keep existing validators)
                              │
                              ▼
   RESOLVE   one company record (name variants, domain, HQ, operating countries) · projects · deals · roles (contractor / subcontractor / supplier / owner / consultant)
                              │
                              ▼
   TRIGGER   per company: strongest trigger = award | order | tender | capability_only, with date, value, project, evidence ids
                              │
                              ▼
   SCORE     buyer fit (existing rubric) + trigger recency + evidence strength + competitor check + chain (tier 2/3)  → class
                              │
                              ▼
   PERSIST   companies · projects · deals/signals · evidence · search_opportunities (one per company × product × run) · chain links
```

Principles that stay from the current code (do not weaken): every fact must be quoted word for word from the stored page (`src/mvp/discovery/evidence.ts`, `src/mvp/pipeline/quote-check.ts`); Tavily snippets are never evidence; no email to anything but the approved inbox; per-run budgets are explicit and env-reducible only.

### 2.1 Source planner (`src/mvp/sourcing/plan.ts`, new; replaces `discovery/plan.ts:buyerQueries` for product searches)

Input: `{ productId, keyword?, markets[], mode }`. Output: an ordered list of `SourceTask { lane, source, query|url, market, priority }`. Rules:

- **Trigger lane first.** For each market, 2 Bing News queries + 1 Tavily `topic:"news", days:365` query shaped like real headlines:
  - `"<activity> contract awarded <country>"`, `"wins <activity> contract <country>"`, `"bags order <material> <country>"`, `"<material> supply contract <country>"`, `"<activity> tender awarded <country>"`.
  - `activity` comes from `MATERIAL_ACTIVITIES[productId]` (`discovery/material.ts`); `material` from the catalogue item's shortName and the user keyword.
  - TED for EU/EEA markets (existing CPV query), always.
  - Registry sources (§2.2) for the market, always.
- **Roundup lane.** 1 Tavily query per market: `"<activity> contractors <country> list"` and `"top <activity> companies <country>"`. These pages are *expected* to be listicles/directories; they are read **only** for fan-out (§2.4), never saved as companies.
- **Capability lane last.** Only if the trigger + roundup lanes produced fewer than `targetCompanies` companies: `"<activity> contractor <country> site:*.ae"`-style queries (current behaviour), capped at 2 per market.
- Budgets per mode (replace `MODE_BUDGETS`): preview 4 Tavily + 6 Bing / 40 reads / 20 AI calls / 60k tokens; batch 8 / 12 / 80 / 40 / 120k; deep 24 / 30 / 200 / 80 / 250k. Keep env caps (`MVP_MAX_*`) as *reducers*.
- Junk filter **before** reading (saves reads and AI): drop URLs whose host is in `src/mvp/sourcing/junk-domains.json` (ibisworld, mordorintelligence, sphericalinsights, wikipedia, world-nuclear.org, *.weebly.com, linkedin.com, facebook.com, glassdoor, indeed, naukri, highergov.com unless market US, amazon, youtube) or whose title matches `/market (size|report|analysis|outlook)|cagr|salary|jobs?\b|career/i`. Log each drop as a run event ("skipped: market report").

### 2.2 Registry sources (`src/mvp/sourcing/registry.ts`, extend the existing `research/registry.ts`)

A typed list of lawful, public pages that list awards or contractors, per market. Each entry: `{ id, market, kind: 'award_list'|'contractor_list'|'filings', url|urlTemplate, reader: 'html_table'|'html_list'|'rss', cadenceDays, note }`. Ship with:

| Market | Source | Kind | Notes |
|---|---|---|---|
| AE | saudigulfprojects.com project database + award posts (already observed to work) | award_list | HTML list; extract company + project + value + date per row |
| AE | DEWA approved contractors list (already in registry; HTTP-denied last time) | contractor_list | keep; mark `requiresManualFetch` if 403 |
| IN | BSE/NSE corporate announcements RSS filtered by "order", "contract", "LoA" | filings | highest-precision award source in India |
| IN | CPPP (eprocure.gov.in) award-of-contract listing | award_list | HTML table |
| SA | Tadawul announcements (company disclosures) | filings | RSS/HTML |
| NO/EU | TED (existing) | award_list | — |
| MY | PETRONAS licensed contractors directory (public) / Bursa announcements | contractor_list / filings | — |

Each registry read produces `RawDoc`s of `kind='roundup'` and goes through the fan-out extractor (§2.4). Failures are coverage warnings, never run failures.

### 2.3 Page classifier (`src/mvp/sourcing/classify.ts`, new)

Deterministic, runs after read, before any AI: returns `article | tender_notice | filing | company_site | directory | roundup | junk` from URL path, title, table/list density, presence of many organisation names (≥ 6 capitalised multi-word names + award verbs → `roundup`), `og:type`, and the registry id. The class decides the extractor (§2.4) and the AI budget priority: `tender_notice/filing > article > roundup > company_site > directory`.

### 2.4 Extractors

1. **Award engine (existing `src/mvp/pipeline/extract.ts`, P1/P2/P3).** Used for `article`, `tender_notice`, `filing`. Keep as is, but run it **inside the product search** (today it is skipped when `productId` is set: `pipeline/index.ts:161-163` diverts to durable research). Both engines must write to the same run.
2. **Roundup fan-out (new `src/mvp/sourcing/roundup.ts`).** For `roundup`/`directory`/`award_list` pages: one Groq call (gpt-oss-120b, JSON) that returns **every** company in the page with, per company: `{ name, quote, role?: 'contractor'|'subcontractor'|'supplier'|'owner'|'consultant', project?: {name, quote}, value?: {text, quote}, date?: {text, quote}, country?: {text, quote}, domain? }`. Every quote is checked with `originalQuote` against the page text; entries with an unverified name quote are dropped; up to 40 companies per page. Each surviving entry becomes a **candidate** with `found_via = { documentId, kind: 'roundup' }` and, when a domain is known or can be found by one Tavily query `"<company> official website"` (cached), seeds **one** company-site investigation (existing `research/investigation.ts`). The DEWA-21 page must yield ≥ 15 candidates in the unit test.
3. **Capability extraction (existing `discovery/index.ts` + `bundle.ts`).** Keep, with these fixes:
   - **Operating country = where the quoted work is**, not the HQ. Accept a company when any verified quote places *work* in a selected market (`"…project in Abu Dhabi"`, `"…for ADNOC"`, site names). Store `operating_countries[]` on the company; `country` (HQ) is separate. Jan De Nul must pass for AE.
   - **Activity phrases per product broadened** (`material.ts`): line-pipe builders must match "oil & gas pipelines", "cross-country pipeline", "pipeline EPC", "transmission pipeline", "gas pipeline laying", "CGD network"; cables must match "HV/EHV cable installation", "11kV…400kV", "substation cabling", "cable laying", "underground cabling". A page titled "Oil & Gas Pipelines" on a contractor site is positive. Add the 20 false-negative fixtures from runs A/B as regression tests.
   - **Entity hygiene:** reject candidate names that are countries, generic headings ("Key Players & More"), associations (`/association|council|chamber|institute/i` unless the product is memberships), publishers (domain in a publishers list), personal blogs/free hosts; require a company suffix OR a confirmed domain OR a registry row. Keep "Not saved" events with the reason.
   - **Role label from evidence**, not from a default: `whatTheyDo` = the activity phrase that matched (e.g. "Pipeline contractor", "HV cable installer"). Tekzone must not be "Water/sewer contractor".

### 2.5 Trigger model (new table + view; `src/mvp/db/migrations/023_triggers.sql`)

```sql
create table company_triggers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies on delete cascade,
  run_id uuid references runs on delete set null,
  product_id text,
  kind text not null check (kind in ('award','order','tender','subcontract','capability')),
  role text not null check (role in ('contractor','subcontractor','supplier','owner')),
  project_id uuid references projects,
  title text not null,            -- "Won UAE gas pipeline EPC contract"
  value_usd numeric, value_text text,
  event_date date, date_precision text check (date_precision in ('day','month','year','unknown')),
  country text,                   -- where the work is
  evidence_ids uuid[] not null,   -- every id must be quote_verified
  strength text not null check (strength in ('confirmed','likely','possible')),
  created_at timestamptz default now()
);
create index on company_triggers (company_id, event_date desc);
```

`search_opportunities` gets `trigger_id uuid references company_triggers`, `trigger_kind`, `trigger_date`, `operating_country`. The list and the UI always show the strongest, most recent trigger. A company with only `capability` triggers is class **Early** at best; `award/order/tender` within 18 months can be **Ready**/**Check first** by the existing rubric.

### 2.6 Resolve and dedupe

- Merge company name variants (existing `group.ts`) **before** saving opportunities; keep one `search_opportunities` row per `(run, company, product)`. KPIL must not appear as 3–4 deals with the same INR 40B award.
- Deals: same company + same value (±15 % after currency conversion) + dates within 30 days = one deal with several sources (existing merge rule; apply it to roundup-derived deals too).

### 2.7 Chain (contractors → subcontractors → suppliers)

Keep `src/mvp/buyers/chain.ts`. Add: a `subcontract` trigger (from "awarded the … subcontract", "nominated subcontractor", consortium lists) creates a **confirmed** tier-2 link; roundup fan-out entries with `role='subcontractor'` do the same. The Contractors/Subcontractors tables (§3) read from these links, not from the needs map alone.

### 2.8 Budget, pacing, failure handling

- Groq: raise per-search token ceiling as in §2.1; keep the 8k TPM pacer; on a "failed to generate JSON" 400, retry once with a stricter JSON instruction (already implemented) and **never** disable the model for the rest of the run.
- Tavily: cache by normalised query for 7 days (exists); `topic:news` for trigger lane; `include_domains` for registry hosts.
- A run is `done` with `coverage: { readsSkipped: n, deferred: n, reason }`; partial coverage is not a failure.

---

## 3. Target UI (tables + evidence drawer, on top of the current flow)

Keep the current shell, Overview, Find, lead workspace tabs (fit review → contacts → email → conversation → meeting), Email automation and Settings. Replace the card list in **My leads** and the degraded SuperSearch with the table-based layout the earlier build had, and make the evidence drawer the universal way to see proof.

### 3.1 Screen: My leads (route `/crm`, rename nav label to **Leads**)

Header: search selector (as now) · product · markets · "Updated x min ago" · **New search**.

Tabs = **four tables**, same filter bar (search, country, buyer role, trigger kind, trigger age, product, fit, contacts available, show rejected):

| Tab | Row = | Columns |
|---|---|---|
| **Leads** | one company × product from this search | Company · What they do · Trigger (kind badge + title) · When (date) · Value · Where (operating country) · What we can sell them · Fit · Contacts (x of y) · Evidence (n sources) · Status |
| **Contractors** | tier-1 companies that *won work* (award/tender/subcontract triggers) | Company · Role (main contractor / EPC / subcontractor) · Project · Owner · Value · Date · Country · Sources · Status |
| **Subcontractors & suppliers** | tier-2/3 companies linked to a contractor (confirmed/likely/possible) | Company · Supplies / does · Linked to (contractor) · How we know (Confirmed/Likely/Possible chip) · Country · What we can sell them · Contacts · Sources |
| **Contacts** | people and role slots across all companies in the search | Person / role · Buying role · Company · Tier · Status (Not found/Likely/Validated) · Email/phone (masked until validated) · Source · Actions (Find · Add · Validate) |

Table behaviour: sortable columns (date, fit, value), 25/50/100 per page, sticky header, checkbox selection → Add to list / Export CSV / Start demo conversation (approved inbox only). Row click opens the **evidence drawer**; "Open workspace" opens `/opportunities/[id]`.

Empty states: "No contractors with a dated award in this search yet — n capability-only companies are under Leads." Never blank.

### 3.2 Evidence drawer (right side, slide-in, 560 px; component `src/components/mvp/evidence/evidence-drawer.tsx`)

Opens for a row in any table (and from every ⓘ in the workspace). Sections, top to bottom:

1. **Header:** company · what they do · operating country · trigger badge + date · fit · buttons: Open workspace · Add to list · Not relevant.
2. **Why this is a lead:** 1–3 sentences built only from verified facts (existing headline builder).
3. **Sources (n):** one card per source document, newest first: publisher logo/domain · title · date · type (News / Tender notice / Filing / Company site / Directory) · **the verified quotes from that page**, each highlighted inside its full sentence · "Open page ↗". Quotes are grouped by what they prove: *Award/order* · *Project* · *Value/date* · *Role* · *Material/activity* · *Country* · *People*. A quote that failed verification is never shown.
4. **Related companies:** contractor above / subcontractors and suppliers below, each with its link strength and a "show their evidence" link that re-targets the drawer.
5. **Contacts:** role slots and named people for this company with status and Find/Add/Validate.
6. **Activity:** status changes, notes, demo emails (recipient always the approved inbox).

Keyboard: `j/k` next/previous row keeps the drawer open and updates it; `Esc` closes. URL keeps `?open=<opportunityId>` so links are shareable.

### 3.3 Lead workspace (`/opportunities/[id]`) adjustments

Keep tabs and journey. Changes: the "Supporting evidence" list becomes the same source-card component as the drawer; add a **Trigger** card (kind, title, date, value, project, owner, sources) above "What we can sell them"; "Subcontractors & supply chain" tab shows the Contractors/Subcontractors tables filtered to this company's chain; "Company information" shows HQ and operating countries separately.

### 3.4 SuperSearch (`/search`)

Keep as the cross-search explorer, but: country facet lists only countries present in results (not 249); add Trigger kind and Trigger age facets; rows show the trigger badge; sidebar = the evidence drawer (one component, not two).

### 3.5 Find (`/find`)

Add a one-line explanation under *Search now*: "We look for companies that recently won work or orders for `<product>` in `<markets>`, then for companies that do this work, then for who they buy from." Progress line stages: collecting (trigger → roundup → capability) · reading · checking · scoring, with counts per lane ("12 award articles · 3 roundups fanned out to 41 companies · 9 company sites").

---

## 4. Data contract changes (`src/mvp/buyers/types.ts`, additive)

```ts
export type TriggerKind = 'award' | 'order' | 'tender' | 'subcontract' | 'capability';
export interface Trigger { id: string; kind: TriggerKind; role: 'contractor'|'subcontractor'|'supplier'|'owner'; title: string; date: string | null; datePrecision: 'day'|'month'|'year'|'unknown'; valueUsd: number | null; valueText: string | null; country: string | null; projectId: string | null; projectName: string | null; ownerName: string | null; strength: 'confirmed'|'likely'|'possible'; evidenceIds: string[] }
export interface SourceCard { documentId: string; url: string; domain: string; title: string; publishedAt: string | null; kind: 'news'|'tender_notice'|'filing'|'company_site'|'directory'|'roundup'; quotes: { evidenceId: string; sentence: string; highlight: string; proves: 'award'|'project'|'value'|'date'|'role'|'material'|'country'|'people' }[] }
export interface LeadRow { opportunityId: string; companyId: string; name: string; whatTheyDo: string; trigger: Trigger | null; operatingCountry: string | null; hqCountry: string | null; sellSummary: string; fitScore: number; howSure: 'high'|'medium'|'low'; stage: 'ready'|'check'|'early'|'not_buyer'; contactsFound: number; contactsTotal: number; sourceCount: number; status: string; isSample: boolean }
export interface ContractorRow extends LeadRow { role: 'main_contractor'|'epc'|'subcontractor'; projectName: string | null; ownerName: string | null }
export interface SubcontractorRow { companyId: string; name: string; supplies: string; linkedToCompanyId: string; linkedToName: string; link: 'confirmed'|'likely'|'possible'; country: string | null; sellSummary: string; contactsFound: number; contactsTotal: number; sourceCount: number }
export interface EvidenceDrawerView { header: LeadRow; why: string; sources: SourceCard[]; related: { above: SubcontractorRow[]; below: SubcontractorRow[] }; contacts: ContactSlot[]; activity: { at: string; text: string }[] }
```

APIs (all behind the session proxy, zod-validated):
- `GET /api/mvp/crm/tables?run=&tab=leads|contractors|subcontractors|contacts&<filters>&page=&size=&sort=` → `{ rows, total, facets }`
- `GET /api/mvp/evidence/[opportunityId]` → `EvidenceDrawerView`
- `GET /api/mvp/evidence/company/[companyId]?run=` → same shape for tier-2/3 companies without an opportunity
- Existing: `POST /api/mvp/runs` (adds `lanes?: ('trigger'|'roundup'|'capability')[]`), `/api/mvp/lists/*`, `/api/mvp/contacts/*`, `/api/mvp/buyers/*` unchanged.

---

## 5. Work packages (in order; each ends green: `pnpm typecheck && pnpm lint && pnpm test --maxWorkers=2 && pnpm build`)

**WP1 · Hybrid run (engine wiring)** — `pipeline/index.ts`: product searches run the award engine on `article/tender_notice/filing` pages *and* the discovery engine, in one run, one budget, one `run_events` stream. Remove the divert at `index.ts:161-163`; keep durable jobs by making the award extraction a job stage (`analyse:award`). Tests: run with fixtures containing one award article + one company site → both an `award` trigger and a `capability` trigger for different companies.

**WP2 · Source planner + junk filter + classifier** — `sourcing/plan.ts`, `junk-domains.json`, `classify.ts`; replace `buyerQueries`. Tests: the three benchmark queries produce the expected lanes; IBISWorld/Wikipedia/Mordor URLs are skipped before reading; the DEWA page classifies as `roundup`, a Tekzone services page as `company_site`.

**WP3 · Roundup fan-out** — `sourcing/roundup.ts` + candidate seeding. Fixture: the saved DEWA-21 page text (from `eval/B-cables-new.json` documents) → ≥ 15 verified candidates; "Top 25 pipeline contractors in India" → ≥ 15. Junk-name rejection tests.

**WP4 · Capability fixes** — operating country from work; broadened activity phrases; entity hygiene; role label from evidence. Regression fixtures: KEC "Oil & Gas Pipelines" page (positive), Jan De Nul Abu Dhabi project page (positive for AE), "United Arab Emirates" / "Key Players & More" (rejected), Tekzone → "Pipeline contractor".

**WP5 · Trigger model + resolve** — migration 023, `company_triggers`, strongest-trigger view, dedupe of KPIL's repeated deals, `search_opportunities` columns. Tests on the run-C dataset: KPIL has one award trigger (Sep 2026, ≈ USD 482M), West-team AS one award from TED, Tekzone one capability trigger.

**WP6 · Tables API + Leads/Contractors/Subcontractors/Contacts tables** — `GET /api/mvp/crm/tables`, components under `src/components/mvp/tables/*`, sortable/paged, selection actions. Replace the card list in `/crm`.

**WP7 · Evidence drawer** — `evidence-drawer.tsx` + `/api/mvp/evidence/*`; wire from all four tables, SuperSearch rows and every ⓘ in the workspace; keyboard j/k/Esc; URL `?open=`.

**WP8 · Workspace + SuperSearch + Find adjustments** (§3.3–3.5).

**WP9 · Registry sources** — saudigulfprojects award posts, BSE/NSE order announcements RSS, CPPP awards, Tadawul; each with a reader test on a saved HTML fixture; failures = coverage warnings.

**WP10 · Benchmark script** — `scripts/benchmark-sourcing.mjs`: runs the three queries on an isolated instance (reuse the launcher pattern from `scripts/start-local-funnel.mjs` with email/workers off), writes `tmp/benchmark-<date>/report.md` with saved buyers, triggers, benchmark hits/misses, junk, cost. The §1 release gate is evaluated from this report.

Estimated effort: WP1–5 ≈ 3 days, WP6–8 ≈ 2.5 days, WP9–10 ≈ 1.5 days.

---

## 6. Guardrails (unchanged, restated for the implementer)

- Never send email to any address other than the configured approved inbox; never add a recipient parameter to any route.
- Never scrape LinkedIn, Google results pages or sites that deny robots; registry sources are public pages read politely.
- Every displayed fact has a verified quote; snippets, AI summaries and search previews are never shown as evidence.
- Budgets are explicit per run and visible in the progress line; a run that hits a budget ends as `done` with coverage warnings, not as `failed`.
- Do not apply migrations to the cloud database from this work; local PGlite only until the user approves.
- No commits until the work package is green; one commit per work package.

---

## 7. Acceptance checklist

1. Benchmark gate in §1 passes from `scripts/benchmark-sourcing.mjs`.
2. `/crm` shows the four tables for a selected search; each row opens the evidence drawer with ≥ 1 source card and highlighted quotes; "Open page" links resolve.
3. For run C's data: Contractors table lists KPIL (award, Sep 2026, UAE, ≈ USD 482M) and West-team AS (TED award); Subcontractors table lists Jindal SAW and AVK with link strength chips; Contacts table lists ≥ 10 role slots.
4. For run B's data after WP3/4: DEWA awardees appear as Contractors with `award` triggers and the saudigulfprojects article as source; Jan De Nul appears with operating country AE.
5. No entity in any table matches the junk list; no article title is a company.
6. All existing automation/email tests still pass; a demo conversation can still be started from a Leads row and goes only to the approved inbox.
7. typecheck, lint, tests, build green; a fresh search of each benchmark query completes in ≤ 10 minutes on the free tiers.
