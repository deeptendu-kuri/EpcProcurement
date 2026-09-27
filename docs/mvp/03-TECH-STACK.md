# 03 · Tech stack

Owner of: every tool and service, why it was chosen, its licence and free-tier limits, and configuration. Versions marked "pin at setup" are pinned in the lockfile on day one. The prototype used `latest` for most packages, which we stop doing.

## 1. Summary

| Layer | Choice | Cost |
|---|---|---|
| Web app | Next.js 16 (App Router), React, TypeScript 6, Tailwind CSS 4, lucide-react | Free |
| Pipeline | Python 3.12 worker | Free |
| Database, login, files, live updates, queues, schedules | Supabase free project (Postgres + pgvector + pgmq + pg_cron, Auth, Storage, Realtime) | Free |
| AI | Groq free tier (Qwen3.8-27B, gpt-oss-120b/20b) and Cloudflare Workers AI free tier (gpt-oss-20b) | Free |
| Reading the web | Crawl4AI + Playwright (self-hosted), httpx, feedparser | Free |
| Documents | pdfplumber, Tesseract OCR | Free |
| Language without AI | spaCy, rules library, dateparser, RapidFuzz | Free |
| Similarity | multilingual-e5-small embeddings on CPU + pgvector | Free |
| Hosting | Oracle Cloud Always Free VM (or a local machine for demos) | Free |
| Code, CI | GitHub (private repo) + GitHub Actions free minutes | Free |
| Errors | Sentry free (Developer) plan | Free |
| Development tools | Claude Code (and optionally Codex) | $20–200 per developer a month |

## 2. Web app

| Tool | Version | Why | Licence |
|---|---|---|---|
| Next.js | 16.3.x (already installed) | Existing codebase; server components keep secrets off the browser | MIT |
| React | pin at setup | — | MIT |
| TypeScript | 6.0.2 (already pinned) | Types shared with generated database types | Apache 2.0 |
| Tailwind CSS | 4.3.x | Existing styling; fast to build simple screens | MIT |
| @supabase/ssr, @supabase/supabase-js | pin at setup | Auth sessions, database access, Realtime subscription for run progress | MIT |
| zod | pin at setup | Validates every API input | MIT |
| lucide-react | pin at setup | Icons (already used) | ISC |
| Vitest + Testing Library | 4.1.x | Unit and component tests (already configured) | MIT |
| Playwright Test | pin at setup | End-to-end tests of the four screens | Apache 2.0 |

Rules for the web app:
- **No outside calls from the browser.**
- **Database types come from `supabase gen types`.**
- **API route handlers only validate input, check the role, write to the database and enqueue a job.**

## 3. Pipeline worker (Python 3.12)

| Purpose | Library | Licence | Note |
|---|---|---|---|
| Database and queues | psycopg 3, plus SQL calls to `pgmq.send/read/archive` | LGPL-3.0 (library use) | No extra queue service |
| HTTP | httpx | BSD-3 | Timeouts, per-domain rate limits |
| RSS and Atom | feedparser | BSD-2 | Trade press, exchanges |
| JS pages | Crawl4AI + Playwright Chromium | Apache 2.0 | Only for pages that need JavaScript |
| Main-text extraction | trafilatura | Apache 2.0 | Cleans articles into text |
| PDF text and tables | pdfplumber | MIT | Tender documents, annual reports |
| OCR | Tesseract (+ Arabic and English language packs) via pytesseract | Apache 2.0 | Scanned tenders only |
| Language detection | lingua-py | Apache 2.0 | Route Arabic or Malay text |
| Name detection | spaCy (`xx_ent_wiki_sm` multilingual, `en_core_web_sm`) | MIT | Pre-marks company and person names |
| Dates | dateparser | BSD-3 | Multilingual dates |
| Fuzzy matching | RapidFuzz | MIT | Company and person matching |
| Embeddings | sentence-transformers + `intfloat/multilingual-e5-small` (384 dimensions) | Apache 2.0 / MIT | De-duplication, capability matching, similar projects |
| LLM calls | `openai` Python SDK pointed at OpenAI-compatible endpoints | Apache 2.0 | Groq and Cloudflare both offer OpenAI-compatible APIs |
| Structured output | pydantic v2 + instructor | MIT | Schema validation with automatic retry |
| Retries | tenacity | Apache 2.0 | — |
| Logging | structlog (JSON) | MIT / Apache 2.0 | run_id on every line |
| Tests and linting | pytest, ruff, mypy | MIT | — |

## 4. AI providers (free tiers, checked 26 Sep 2026)

| Provider | Models | Free limit | Data terms | Use |
|---|---|---|---|---|
| **Groq** | `qwen3.8-27b`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b` | 30 requests/min, 1,000 requests/day, 8K tokens/min, 200K tokens/day, shared across the whole organisation | Not used for training (confirm in the console at signup) | Main extraction, research and report writing |
| **Cloudflare Workers AI** | `@cf/openai/gpt-oss-20b` | 10,000 Neurons/day (about 0.3–0.5M tokens), then $0.011 per 1,000 Neurons | Standard Cloudflare terms | Second model for cross-checks; overflow |
| OpenRouter `:free` (backup only) | gpt-oss-120b:free and others | 50 requests/day (1,000 with $10 of credit bought) | Some free providers log prompts, so only public text | Emergency fallback |
| **Not used** | Gemini free, Mistral free | — | Both use inputs for training | — |

Anything the MVP sends to AI is public web text. Client notes and contacts are never sent to free providers.

Paid upgrade path, needing no code changes:
- **Claude Haiku 4.5** ($1 / $5 per million input/output tokens; half price in batch) if gold-set accuracy misses target.
- **Claude Sonnet 5** ($2 / $10) for long, messy PDFs.
- **Self-hosted Qwen3.8-27B** on a 24 GB GPU (about €214 a month at Hetzner) for volume.

## 5. Hosting and operations

| Item | Choice | Limit or caveat |
|---|---|---|
| App + worker host | Oracle Cloud Always Free VM (ARM, up to 4 cores / 24 GB RAM) | Capacity depends on region; fall back to a local machine for demos. Vercel Hobby is not allowed for commercial use |
| Process manager | systemd units (or Docker Compose) for `web` and `worker` | — |
| Reverse proxy and TLS | Caddy (automatic HTTPS) | Free |
| Database | Supabase free: 500 MB database, 1 GB storage, 2 projects; pauses after 7 days idle | One project for dev, one for demo |
| CI | GitHub Actions: lint, typecheck, tests, migration dry-run | 2,000 minutes a month on free private repos |
| Error tracking | Sentry Developer (free): 1 user, 5,000 errors a month | — |
| Backups | Nightly `pg_dump` to the VM disk and one off-site copy | — |

## 6. Configuration

Web app (`.env.local`, never committed):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server only; rotate the prototype key first
SENTRY_DSN=                       # optional
```

Worker (`worker/.env`, never committed):

```
DATABASE_URL=                     # Supabase Postgres connection string
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GROQ_API_KEY=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=             # Workers AI permission only
OPENROUTER_API_KEY=               # optional fallback
BRAVE_SEARCH_API_KEY=             # optional
DATA_GOV_SG_API_KEY=              # only if Singapore is chosen
ETIMAD_API_KEY=                   # Etimad developer portal (sandbox first)
PROVIDERS__LLM_PRIMARY=groq:qwen3.8-27b
PROVIDERS__LLM_SECONDARY=cloudflare:@cf/openai/gpt-oss-20b
PROVIDERS__LLM_TRIAGE=groq:openai/gpt-oss-20b
PROVIDERS__SEARCH=gdelt,rss,official
PROVIDERS__READER=crawl4ai
PROVIDERS__CONTACTS=official,derived
PROVIDERS__EMAIL_VERIFY=mx
LLM_DAILY_TOKEN_BUDGET__GROQ=180000        # keep 10% headroom
LLM_DAILY_NEURON_BUDGET__CLOUDFLARE=9000
CRAWL_USER_AGENT="BoroTechLeadBot/0.1 (+contact email)"
CRAWL_DEFAULT_RATE_PER_DOMAIN=0.2          # requests per second
```

## 7. Services that need no key

GDELT DOC 2.0 API, EU TED search API v3, BSE and NSE RSS feeds, Norway Brønnøysund register API, GLEIF LEI API, the OFAC / UN / UK / UAE sanctions lists. The EU sanctions file needs a free EU Login account.

## 8. Explicitly not used in the MVP (and why)

| Tool | Reason |
|---|---|
| Google Custom Search API | Closed to new customers; shuts down 1 Jan 2027 |
| OpenSanctions | Commercial use needs a paid licence; we load the official lists directly |
| OpenCorporates API | Paid for commercial use |
| LinkedIn scraping | Against LinkedIn's terms; profiles are stored as links only |
| Vercel Hobby | Non-commercial only |
| Gemini / Mistral free tiers | Train on inputs |
