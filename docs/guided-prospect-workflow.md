# Guided prospect workflow — feature branch

## Shipped in this change

- Overview groups work by actual search, with an explicitly selected search rather than a global mixed lead feed.
- Find buyers puts product, country and desired buying-team role upfront. All 249 ISO countries/territories are selectable; a run supports at most 20 countries. Selection is not a claim of worldwide source coverage.
- Each product-scoped result saves an immutable keyword/product/search association and quote-checked evidence. Buyers must have an award/order signal tied to evidence read by this search and a non-competitor need for the selected catalogue item. Owners, open bids, consultants and distributor-only companies are excluded from this workflow. Product needs can be inferred: the UI does not claim a confirmed purchase.
- A company appears once per product/run (its strongest evidenced deal), and can occur in separate searches for different products. Qualification, notes, ownership, reminders and email history remain per opportunity. Navigation labels are visible by default.
- Buyer CRM offers Discovered and Verified views with the same filters. Verified requires fit review, a recent (90 days) provider-validated email for the requested role and non-sample data. Manual role confirmation is not email deliverability validation. Expired validation returns the prospect to Discovered.
- The lead workspace guides fit review → contact validation → email review → conversation → meeting. Clear labels, persistent notes and a filtered-CRM back link replace deep navigation as the primary journey.
- Contact lead opens a product-specific email template automatically. Existing single-inbox demo delivery is retained, provider acceptance is recorded per opportunity, and no scraped buyer is emailed. Rejected fit blocks both drafting and sending.

## Deliberately not represented as working

FullEnrich has no configured integration yet; it cannot currently validate/enrich real contacts. Autonomous follow-ups, inbound reply ingestion, reply agents and calendar booking are not implemented in this branch. The UI labels those limits. Manual reminders only store a date. No meeting is claimed as booked.

The bundled catalogue and needs rules remain examples. Replace them with the client's actual sellable scope before interpreting fit as commercial qualification. Existing discovery sources retain their rate-limit and coverage constraints. The free Render process may sleep, and its in-memory search queue is not a durable automation worker.

## Migration and rollout

`010_search_opportunities.sql` is additive: it adds search/document provenance, opportunities and events, optional saved-search product/role columns, and a nullable draft association. No existing lead or email is deleted or guessed into a product search. Old searches remain accessible through Advanced / legacy search; new product searches populate the new CRM.

Do not apply the migration to production while reviewing the branch. After approved merge, the existing cloud startup migration runner applies it before starting the app. Existing credentials and deployment configuration do not need changing for this foundation. Main/production are untouched by feature-branch pushes.

## Verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm test -- --maxWorkers=2`, and `pnpm build`. Database integration tests use fresh in-memory PGlite, including actual offline discovery → scoring → capture and product-isolated draft/send tests. Email provider responses in tests are mocked: tests send no real mail.

Completed local verification: 426 tests across 49 files passed, lint/typecheck passed, and the Next production build passed. The production-server browser journey passed login/auth, all 249 country options, offline discovery, product-only results, buyer-fit gating, automatic email preview, persisted notes after reload, filtered return navigation, empty verified CRM for unvalidated sample data, mobile overflow checks and zero browser errors. This is not proof of live scraping coverage or FullEnrich/calendar integration. Screenshots are in `tmp/guided-browser-proof`.

For browser proof, start a local production server with explicit overrides:

- `DATABASE_URL` explicitly empty before Next loads env files; `MVP_DATA_DIR` points at a **new** ignored local directory, not the original `.data/pglite`. On Windows, set the empty value in a Node launcher (`process.env.DATABASE_URL = ''`): Windows PowerShell removes empty environment variables, which lets Next reload the cloud value. Assert the URL remains empty after loading env, before starting the server.
- `MVP_OFFLINE=1`, `MVP_SCHEDULER=off`, `GROQ_API_KEY` cleared.
- `DEMO_EMAIL_ENABLED=1`, `RESEND_API_KEY` cleared, a local-only password/session secret, `APP_URL=http://localhost:3005`.

Run `node scripts/guided-browser-proof.cjs` with `PROOF_BASE_URL` set to that localhost URL. It requires Playwright (`PLAYWRIGHT_MODULE` can point at an installed module) and optionally `PLAYWRIGHT_CHROMIUM`. Screenshots go to ignored `tmp/guided-browser-proof`. The script refuses non-local URLs and never clicks Send. Delivery/failure/idempotency is tested separately with a mocked provider.
