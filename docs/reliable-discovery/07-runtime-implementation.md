# Implemented durable runtime and remaining cloud gates

This is a shipped-versus-proposed record for the implementation branch. No new live provider call, cloud migration or deployment is implied. Tests use isolated databases, synthetic source pages and mocked provider responses.

## Implemented locally

- Migration019 adds research sessions, source/read/analysis jobs, leases, budget reservations, a transactional outbox and signed-provider receipt metadata. Migration020 adds successful Tavily query caching. Existing lead data and historical migrations are preserved.
- Live product searches use durable jobs by default (`MVP_DURABLE_RESEARCH=off` retains the legacy path). Sample/offline and legacy unscoped searches keep their previous pipeline. Material clarification/unsupported/mismatched input fails before new live research.
- Each Tavily query, Bing query and RSS feed is a separate task. GDELT is a single bounded source request. Each page read and buyer analysis has its own checkpoint; this is not a wrapper that repeats the entire pipeline on retry.
- Local Node startup resumes due jobs. Waiting work is in the database, not dependent on the open browser. Cancelled runs cannot be revived; lease-token fencing stops a stale worker committing task completion. Company/opportunity source writes remain idempotent.
- Explicit request/page/AI reservations and original-page caches bound repeated work. Discovery and sales decisions use single provider attempts: no hidden JSON-repair or rate-limit retry loop increases spend. A lost charged-provider response is reviewable rather than silently generating a fresh paid call. Resume remains capped by the cumulative deep ceilings (40 analyses/100k estimated tokens/200 pages, lowered by environment limits); failed charged analyses need review. A partial run preserves saved companies and original URLs.
- Partial research uses `runs.status=done` to preserve the existing result-navigation contract, with `researchState=partial`, `coverageIncomplete`, deferred counts and a stop reason. Automation excludes research sessions not genuinely completed. A settled optional source failure is a coverage warning, not a permanent enrollment barrier.
- Existing `POST /api/mvp/runs/[id]` with `{"action":"continue_analysis"}` resumes partial durable research. It uses saved original URLs/queries, adds a bounded analysis/read round and retains the same run ID. Resume can use AI/read resources; it is not a promise that all work is free. It does not silently repeat completed Tavily requests.
- `POST /api/mvp/webhooks/resend` verifies the signed raw body and timestamp, persists event-ID deduplication and queues an inbox wake before acknowledgement. The local worker invokes existing receiving reconciliation and marks the receipt processed only after a successful scan. Receipt acceptance is not proof of an AI reply, meeting or delivered email.
- `POST /api/mvp/research/worker` requires a long bearer secret or a verified QStash signature. Browser cookies cannot authorize it. Exact machine routes bypass browser-session proxy only because each handler authenticates independently.
- A QStash publishing adapter uses outbox ownership and stable transport deduplication IDs. Publishing is explicit opt-in (`MVP_RESEARCH_TRANSPORT=qstash`); it has not been exercised against the user's provider account.

## Vercel is deliberately not declared ready

The `VERCEL=1` research/automation guard remains active. Signatures and persistence are tested, but cloud execution must not be enabled merely by deleting a guard. The existing Groq pacing/retry layer can wait beyond the proposed60-second task budget, and its account-level pacing remains process-local. Provider quota controls across separate runs/instances, task heartbeat/deadline behavior, recovery schedules and complete published-outbox reconciliation still need proof.

Vercel database initialization checks the expected migration registry rather than applying DDL on every concurrent cold start; runtime migration files are included in Next.js output tracing. Apply migrations separately using the existing controlled direct-connection migration script. This change is not an actual migration of Neon.

Before cloud enablement, prove PostgreSQL multi-instance claims and atomic provider reservations; terminate/replay actual bounded tasks; configure signed public Resend callbacks; prove received reply suppression and one real Google Calendar event on the approved test inbox; establish allowed commercial hosting terms; and retain application/provider quota budgets and failure alerts. Free Render remains a supervised option with sleep/restart limits, not an always-on guarantee.

## Configuration contracts

Local research starts through instrumentation, unless disabled/build/test/serverless. Email wakes only invoke the opted-in existing funnel (`MVP_FUNNEL_WORKER=on` or `external`). Unknown buyer-contact fields remain unknown; approved demo routing does not overwrite them.

Machine endpoints use server-only `RESEARCH_WORKER_SECRET` (32+characters), optional `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`, and `RESEND_WEBHOOK_SECRET`. Publishing additionally uses `QSTASH_TOKEN` and a stable HTTPS `APP_URL`. No secrets belong in browser bundles, source code, screenshots, job bodies or this documentation.

Signed verification follows [QStash claims](https://upstash.com/docs/qstash/howto/signature) and [Resend raw-body verification](https://resend.com/docs/webhooks/verify-webhooks-requests). Provider/dashboard integration and live delivery remain separate acceptance steps.

## Local verification handoff — 5 October 2026

- Full automated suite: 728 tests passed; one optional captured-source replay skipped in the default run. TypeScript and scoped source/script ESLint checks passed.
- Production build passed through `node scripts/build-local-proof.mjs`. The launcher isolates its build directory and local database, clears provider/cloud credentials in the child environment and disables live workers. This is a build proof, not a cloud deployment.
- Eight desktop/mobile browser checks passed with no recorded browser or HTTP errors. The report is `tmp/reliable-discovery-ui-proof/index.html`; its records are explicitly fictional sample fixtures and no live search, send or Calendar write occurred.
- A separate offline replay of the existing 4 October source capture passed. That capture contains 27 original documents and one cached extracted buyer; it is not evidence of 27 buyers or a fresh 50–100-company yield.
- No push, deployment or new cloud migration was performed. A read-only registry check found none of migrations018–020 applied to the configured cloud database. Existing application data was preserved.
- The existing live local process was not restarted into this build. The next supervised acceptance test must start the updated feature branch with the approved local configuration, perform one budgeted real material search, inspect grounded companies and missing fields, then test demo-only delivery, an actual received reply and one Calendar/Meet event. Do not mark these live stages passed from mocked tests.

## Supervised live acceptance — 5 October 2026

The subsequent user-authorized local test restarted the updated production build at `http://localhost:3007`, with the cloud database explicitly excluded. Two older demo conversations were paused, not deleted, to keep their traffic separate. The actual walkthrough and screenshots are in `tmp/live-acceptance-20261005/index.html`.

- One preview search was submitted through the UI: Power and control cables, United Arab Emirates. Two paid Tavily query responses were saved; no repeat web search was submitted.
- First pass: 16 original pages read, four AI analyses, zero saved buyers, four deferred URLs and one failed source. This failure was retained rather than represented as success.
- The captured extraction exposed a headquarters/operating-market mismatch for L&T and missing recognition of substation cabling work. Fixes use a separately cited, literal company-work span to establish operating country and material application. Invalid quote text remains invalid; an independently valid activity quote can supply evidence. Synthetic negative geography tests remain passing.
- One explicit resume reused the existing run, queries and successful extraction cache. Final result: 19 original pages read, four analyses checked, one real potential buying company saved, no deferred work, and one source failure retained as a coverage warning. Current activity date, employee contact and validated email remain unestablished; they were not fabricated.
- Automatic product-fit qualification approved that opportunity and Resend accepted one initial demo email to `hritikdebnath00@gmail.com`. The greeting is `Hi Larsen & Toubro (L&T) procurement team,`; Hritik is the salesperson, not the buyer identity. No real buyer was contacted. Provider acceptance is not the inbox owner's receipt confirmation.
- Production build and 158 targeted discovery/runtime/automation regression tests passed after these corrections; the separate original-capture offline replay passed without provider requests. The subsequent full suite passed 731 tests, with two optional captured-source replays skipped by default.
- At this checkpoint, an actual reply for the new conversation and Calendar consent are still pending. Reply processing, meeting booking and invitation delivery are **not yet live-proven for this search**. Calendar credentials alone do not grant access; the inbox owner must connect Google Calendar through Outreach. Once connected, the agent offers available slots and books after explicit selection.
- A remaining presentation issue observed in the live workspace is its legacy `Pipeline builder` label for this electrical-work opportunity. The saved material and source quotes are cable-specific, but that legacy label needs a separate correction; do not infer a pipeline project from it.

## Follow-up coverage audit and automation pause

On 5 October2026 the user requested broader real company/project/subcontractor discovery and no automatic emails to all results. The local automation setting is now disabled and all three existing nonterminal demo threads are paused; histories and leads remain intact. A subsequent read-only local status check confirmed this state. This does not change or assert the cloud deployment's settings.

Source-task inspection found only two targeted Tavily web queries among the22 jobs in the cables run; the remaining jobs were six Bing news queries, thirteen RSS feeds and one GDELT request. The app's PDF reader skips PDFs and lacks structured contractor-directory ingestion, per-company evidence bundles and adaptive source expansion. Official-source research found a public DEWA list of eleven named cable-installation contractors and a supporting official ARAR capability page. These are independently reviewed source candidates, not newly saved app results or confirmed purchases.

Documents00,02 and06 now record the discovery-first scope, source/provider choices, stage-specific acceptance criteria and pending implementation order. No new app search, live send, provider-adapter change, commit, push, cloud migration or deployment occurred in this follow-up. Prior automated-test results do not prove the proposed new coverage adapters.

## Accepted design and phase-plan documentation

The user subsequently approved documenting the discovery-first plan on 5 October 2026. Document02 records accepted decision DISCOVERY-001, including the optional Crawl4AI reader comparison, directory/PDF requirements, source/reader contracts and confidence limits. Document06 defines P0-P7 with specific deliverables, resource ceilings, quality gates, failure handling and separate discovery-only/full-funnel cloud releases. Documents00,01,03 and05 align navigation, role/CRM semantics and hosting boundaries with that decision.

This is documentation-only work: no crawler installed, engine changed, new app search performed, email enabled/sent, database migrated, commit/push or deployment. All new phase gates remain pending. Earlier builds, tests, live emails and source research remain their own evidence; plan approval does not convert them into proof of the new coverage engine.

## Discovery-first implementation increment and failed yield gate — 5 October 2026

The approved implementation began on `feature/guided-prospect-workflow`. These changes are local and uncommitted; no push, deployment or cloud migration occurred. Earlier dirty changes were preserved. Local startup applied additive migration021; it did not clear existing records or connect to Neon. Automation stayed disabled, its three nonterminal demo conversations stayed paused, and the discovery launcher disabled the funnel worker. No email or Calendar write was made in this increment.

### Implemented

- Migration021 persists company research candidates and versioned company-bundle analysis caches. A research seed is not automatically a saved buyer or verified contact.
- Product research now includes bounded general-web company, project, activity and directory queries, rather than a compulsory news-heavy collection pass. Query lanes are routing hints, not evidence. News remains optional and coverage budgets remain explicit.
- A reviewed source registry includes one public DEWA contractor-list HTML source for relevant UAE searches. Its adapter retains complete contractor rows beyond the former five-company extraction shape, distinguishes consultants, respects row boundaries and never derives a company domain from a personal Gmail inbox. This is one source adapter, not a worldwide directory integration.
- The native reader preserves HTML table rows, same-domain useful links and PDF page boundaries. Text PDFs use pinned `pdfjs-dist` in a memory/deadline/page/byte-limited worker. OCR, CAPTCHA solving and access-control bypasses are not implemented. The PDF parser has synthetic-file tests; this pilot did not successfully read a live PDF.
- Original company pages can seed bounded official-site investigations across capability, project and contact pages. The global, source-lane and existing per-domain budgets still apply. Failed Tavily routes release some query-fairness capacity, but complete adaptive expansion and deferred investigation recovery remain unfinished.
- Same-entity documents can support separate identity, material, country and activity claims. Every accepted quote must resolve to one individual original document, with its own source URL; joining a quote across documents is rejected. Original work and contacts remain separate from inferred purchasing and person-level email validation.
- Input-consuming manufacturers and explicitly supported channel customers can be represented without admitting supplier-only sales pages. Scores remain prioritisation references, not a reason to discard an otherwise valid company with missing optional fields.
- Progress reports candidate versus investigated versus saved company counts, budget reservations and unreadable-source categories. Authenticated read-only research diagnostics expose source/task outcomes for diagnosis, not provider credentials or private email contents.
- Live testing found and fixed acceptance of nullable Tavily publication dates, false completed-empty status when all remote reads fail, and generic service headings incorrectly selected as company names. Bundle cache identity now changes when the investigated entity changes. Regression tests cover these failures. These fixes do not retroactively convert a failed capture into successful discovery.

### Actual local pilot and its limitations

Pilot run: `5af04be8-b486-481c-9b0f-178722f611ae`, Power and control cables, UAE, batch target10. The configured application ceilings were six targeted queries,60 attempted reads,12 AI calls and30,000 estimated AI tokens. Targets are not promises and reservation counters are not provider billing receipts.

The initial app process could not reach the sources. A supervised restart retried the same jobs after a read-only quota check. The quota endpoint reported991 remaining, unchanged across those checks; this alone does not establish that each failed POST was unbilled. Unknown response acceptance remains conservatively reserved in the application. No cloud state was changed.

One additional diagnostic POST returned10 real URL results, including nullable publication dates. Its response was saved privately and reused for the matching existing query job, without repeating that successful search. The other five failed queries were not recharged after the parsing correction. This is a repaired, partial pilot, not proof that all six newly corrected live query routes have succeeded.

Measured outcome:19 attempted reads,11 successful original-page reads, eight unreadable reads (five HTTP failures and three robots denials), three investigated candidates, two real Groq analyses and **zero saved buyers**. There were no browser page errors, no new outreach conversations and no invented contact/project fields. Reading the public DEWA listing failed with HTTP access denial, so its contractor-row adapter was not live-proven against that page. Captured results were dominated by consulting/inspection and unrelated routes; service-heading identity errors were also caught. The newer identity correction was regression-tested but not rerun with fresh live provider calls in this pass.

The ten-company first-pilot gate is **not passed**. Neither the source recovery/precision benchmark, three-material/two-country coverage gate,50–100-company capacity, live contact enrichment, reply/meeting acceptance nor Vercel cloud execution is passed by this test. The next engineering work is query/source relevance, an accessible lawful directory alternative, original-source replay and then a separately budgeted fresh pilot before outreach or deployment.

Actual screenshots and counters are in ignored `tmp/discovery-acceptance-20261005/index.html`, served locally at `http://localhost:4176`. The production app launcher is `node scripts/start-local-funnel.mjs --discovery`, at `http://localhost:3007`. Its local database and provider configuration remain separate from the cloud. Do not present the old successful L&T search as this pilot's yield.

Final automated verification for this increment:749 tests passed, two optional replay tests skipped; production build/TypeScript and scoped ESLint passed. The directory/PDF/bundle fixtures are synthetic and the live pilot remains a failed yield gate, not a passed client acceptance test.

## Corrected live discovery increment — 6 October 2026

The feature branch remains `feature/guided-prospect-workflow`. All changes in this increment are local and uncommitted; the existing dirty worktree is preserved. No push, public deployment or cloud migration was performed. The local app excludes Neon. Email automation remains disabled, its worker is off, and the same three existing demo conversations remain paused. There were no new email sends or Calendar writes.

### What changed after the measured failures

- Material-consuming company activities are searched before narrower project/news queries. Provider requests use basic depth, explicit settings, up to twenty URL results and supported country boosts; a country boost is not verified geography.
- Bounded search previews only prioritise reading. They are never promoted to original-page evidence. Relevant original domains are read before repeated pages, job boards and general market reports.
- After all collection tasks settle, unused fair shares are recovered from already-saved URLs, within the same global and lane reading limits. This does not issue more paid searches.
- Short literal company branding is accepted without requiring a twenty-character identity quote. Accepted AI JSON is retained before schema validation, allowing source/schema review without silently repeating an accepted chargeable request.
- A deterministic official-company capability path uses the common source/entity/material gates and records `rule:company-application`. An explicit service statement is preferred to branded SEO titles, generic educational paragraphs or third-party directory descriptions. AI remains bounded for ambiguous sources.
- Service/article headings are not company identities. Unrelated words across different service-list clauses do not establish a consuming application. A publisher's roundup, subsidiary office, client work or supplier-only output is not silently attributed to the company being researched.
- Potential-buyer views and saved-result counts exclude rejected opportunities by default; an explicit rejected-review filter preserves their history. Repeated published inbox/telephone values are deduplicated for display without deleting their original evidence.
- The detailed workspace keeps its sidebar, roles, supply-chain tools and search-scoped product. Its legacy pipeline-specialism fallback is not shown as an established business activity for a newly discovered material opportunity.
- A reviewed run with only parked jobs remaining settles as partial rather than remaining “running” indefinitely. Future queued work still prevents premature finalisation. Overview and recent-search labels also distinguish paused research from fully finished work, with a direct progress link. Partial sessions remain ineligible for automatic enrollment.

### Measured source and yield result

Pilot: `bdaae4a4-2998-4732-9a7f-e3cd315f36e2`, Power and control cables, UAE, batch target ten companies. The quota preflight reported 984 remaining plan/key credits. Six basic provider requests were made; one returned twenty URLs and five returned none. No new query was submitted during the subsequent evidence reviews. The target is not a yield promise.

| Measurement | Recorded outcome |
| --- | --- |
| Search requests reserved | 6 / 6 |
| Original-page reads completed | 29 |
| Read attempts reserved | 33 / 60 |
| Unreadable reads | 4: two HTTP failures, one other error, one robots denial |
| Company investigations with saved pages | 7 |
| AI attempts reserved | 8 / 12 |
| Estimated AI tokens reserved | 28,117 / 30,000; not actual provider billing |
| Saved potential companies after source audit | 3 |
| Named provider-validated buyer emails established | 0 |
| New outreach threads, emails or Calendar events | 0 |

The three retained potential companies are **SHAMS AL JUBAIL**, **HELPING HAND LLC** and **Sama Al Shahba**, supported by their original capability pages. Helping Hand has published company phones; Sama has a published company inbox and phones. These are not verified personal contacts. Their current procurement, named awarded project and attributable current activity date are not established. Country fields remain blank rather than assigning UAE from the query or a telephone prefix.

The audit rejected three earlier pilot records: LEDYi's directory-publisher attribution, Elsewedy's unsupported cross-clause application, and a service heading incorrectly stored as a company. They were marked rejected, not deleted. Sama's literal original branding and explicit electrical-services statement were rechecked using the already-read company pages; no new search/read jobs or increased ceilings were needed. The old title remains an identity/history source, not a substitute for the actual service claim.

The ten-company yield gate is **still not passed**. The run retains deferred URLs, an unprocessed analysis, its earlier failed analysis and the original DEWA access denial. A source-backed capability opportunity does not prove a currently active construction buyer or confirmed order. Neither this capture nor the prior L&T demo proves a 50–100-company outcome.

### Verification and next release gates

The full regression suite passed 769 tests with two optional captured-source replays skipped. Subsequent final progress/evidence/presentation corrections passed 64 focused tests across nine files; the final cross-screen status-label correction passed seven additional targeted progress tests. These overlap the full-suite tests and must not be added to its count as distinct tests. Scoped ESLint passed. The isolated production build includes TypeScript checking and clears provider credentials and workers in its child environment.

The final isolated production build and TypeScript check passed. The final browser capture passed with no recorded page errors, unchanged search/read/AI reservations, three retained potential companies and a correctly labelled partial research state. Live screenshots and read-only research diagnostics are stored in ignored `tmp/discovery-acceptance-20261006/`. The report is served at `http://localhost:4176`; the local app is at `http://localhost:3007`. Browser capture navigates the actual search, CRM, lead workspace, loaded contacts, supply chain, email/meeting view and overview. It does not submit another search or send a message.

Remaining gates: accessible lawful directory/record sources and multiple-material/country yield tests; supported current-work evidence; named-contact discovery and live verification; one supervised approved-inbox conversation through an actual reply and Calendar event; controlled PostgreSQL migrations, multi-instance recovery and signed public callback proof before cloud enablement. Google OAuth credentials are configured but Calendar consent is not yet granted. Connect it through Outreach using the approved test account. Client-ready Vercel research/automation remains guarded; nothing was deployed by this increment.

### 6 October: reviewed-prospect demo integration

The saved research-to-email gap is addressed locally with an explicit reviewed-prospect start in the same company's Email & meetings tab. It can queue one source-backed, approved company from a settled partial search without changing that research status or fabricating a contact. Duplicate starts reuse the same conversation; suppressed recipients, source-less/sample/unreviewed/running prospects, prior outreach and per-search caps block new starts. Automatic and explicit enrollment share a transaction lock. Re-enabling automation starts a fresh automatic-enrollment window instead of replaying historical searches.

Setup, Calendar consent, five-stage progress, real message history, conversation controls, offered slots and saved summaries are now visible in that workspace. Calendar consent returns to that exact conversation through an allowlisted path. The prospect-demo guide no longer presents personal enrichment as a mandatory step; detailed evidence and contact tools remain in their tabs. A deterministic offered-slot selection no longer needs another AI decision. Waiting for Calendar consent resumes availability lookup directly, without reclassifying the same meeting request.

`node scripts/start-local-funnel.mjs --demo` starts the bounded production discovery build with its demo email worker available. It retains the existing local database isolation, and does not itself enable app-level sending. Existing demo conversations remain paused. No new email, research request, Google invitation, cloud migration or deployment was performed during this integration acceptance. The user's real Gmail replies and Calendar consent remain required for live end-to-end proof. See [08 Demo UI test](08-demo-ui-test.md).
