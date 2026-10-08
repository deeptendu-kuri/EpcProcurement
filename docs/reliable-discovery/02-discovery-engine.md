# Discovery engine architecture

The proposed engine researches consuming companies and attributable work rather than extracting buyers from isolated keyword pages. Keep the existing Next.js UI, PostgreSQL abstraction, evidence storage and safe fetcher. Refactor the discovery path incrementally instead of replacing the application with an autonomous browser bot.

The architecture below mixes the original proposal with later implementation. Document07 records what shipped locally. The discovery-first revision at the end is the next proposed increment, not an implemented source adapter or proven yield.

## Accepted decision DISCOVERY-001

Date: 5 October 2026. Status: accepted design; implementation and measured acceptance pending. The latest user instruction authorizes documenting the decision and planning the next phases. No engine changes, installation, fresh app search, message, migration, commit, push or deployment are performed by this record. See [the approved phase plan](06-execution-tests-and-prompts.md#approved-next-phase-plan).

### Decision

Prioritize useful source-backed material customers before contact enrichment or email automation. Retain the existing Next.js application, canonical company/project/contact tables, durable research jobs, safe fetcher, search-scoped CRM and detailed workspace. Add complementary discovery routes, bounded directory/PDF parsing, company website follow-up and company evidence bundles. Test Crawl4AI as an optional extraction adapter; do not replace the application or adopt it solely because its library is free.

Company eligibility needs original evidence of identity and relevant material-consuming activity. A directory row is a seed; a supported material application is a potential opportunity; an explicit requirement is confirmed demand. Missing projects, current activity, people or contact details remain null. Scores order eligible companies. Contact validation and sending permission never decide whether a supported potential customer is visible.

Discovery automation and delivery automation are separate controls. Search may collect, analyze, rank and save companies while all enrollment, sends, replies, follow-ups and calendar writes remain disabled. Current approved-inbox email adapters are preserved for a later controlled funnel proof, not enabled during the discovery experiment.

### Why this decision

The live UAE cables run saved one company after only two targeted web searches and four AI page analyses; its remaining source jobs were mostly news/RSS. The present reader skips PDFs, extraction limits each response to five companies and there is no directory cursor, official-domain investigation loop or same-entity multi-page evidence bundle. More contacts or a different email sender would not address these losses.

Reviewed public sources establish additional candidate coverage: [DEWA's cable contractor publication](https://www.dewa.gov.ae/en/builder/useful-tools/Approved-Distribution-11KV-33KV), [DEWA's broader contractor directory](https://www.dewa.gov.ae/en/builder/useful-tools/consultant-and-contractor-listing), [CIDB's contractor search](https://convince.cidb.gov.my/SearchDirectory/) and [DDA's enlisted-contractor publication](https://www.dda.gov.in/list-dda-enlisted-contractors-dda-march-2026). These locations require per-source access/reuse and freshness review; their existence is not proof of unrestricted automated access or active purchasing. Original company service pages establish material-fit examples, while project pages may contain historical or undated claims. Collection date and an Ongoing page title cannot establish current activity.

Confidence is high that targeted sources can increase the pool of real potential companies in known-rich markets. Numerical accuracy, fixed yield, current demand, validated employee email and dependable cloud operation remain hypotheses to measure. Do not turn this confidence assessment into an accuracy badge or sales guarantee.

### Crawler choice and boundaries

[Crawl4AI](https://github.com/unclecode/crawl4AI) offers a free self-hosted Python library with browser rendering and structured extraction. The library/own server does not supply general web search; its hosted search/extraction products have separate account and pricing conditions. Continue using Tavily or reviewed seed sources for initial URLs. Pin a reviewed release and preserve required license notices/attribution if adopted.

Its [PDF strategies](https://docs.crawl4ai.com/advanced/pdf-parsing/) need both PDF-aware crawling and content scraping. A successful placeholder response is not extracted document evidence. Text PDFs and table row associations need tests; scanned documents do not receive OCR by default. Detect content type as well as URL suffix, including `.ashx` attachments. Bounded PDF support is an early discovery requirement whether or not Crawl4AI passes its comparison.

Configure [robots checking](https://docs.crawl4ai.com/api/parameters/) explicitly, since the documented default is false. Configure [depth/domain/page limits](https://docs.crawl4ai.com/core/deep-crawling/) explicitly, since deep crawling can otherwise be unbounded. Keep redirects, browser subresources and downloaded documents under public-network/egress controls; reject private/local/file targets. Never bypass CAPTCHA, logins, robots restrictions or access controls. Website text cannot authorize arbitrary scripts, configuration changes or actions. Do not expose a general-purpose crawler to unauthenticated callers.

Use the existing lightweight reader first when it already returns adequate original content. Use table/CSS extraction before model calls on consistent sources. Preserve entity headings, source-defined aliases, dates and contact/table context rather than filtering them away to reduce tokens. An optional Crawl4AI worker renders only eligible pages needing it, with bounded concurrency, response size, timeout, CPU/memory and cumulative request budgets.

[Crawlee for TypeScript](https://crawlee.dev/js/docs/introduction) is the alternative if a Python worker creates unnecessary operational complexity. Compare only the chosen optional reader with the existing baseline; do not install both stacks. Hosted Firecrawl/Tavily extraction is a later alternative if rendering is still the bottleneck and dashboard quotas/terms support a small experiment. No additional provider key is required to begin the local design and parser work.

### Source and reader integration contract

- Registry entry: stable source ID, canonical URL, source type, geography/material scopes, supported claim types, permission/reuse assessment, freshness assessment, parser profile and pagination cursor. Directory registration, project execution and contact verification are distinct supported claim types.
- Read request: authorized run/job ID, public URL, content/parser type, depth/domain policy, effective request/page/byte/time ceilings and extraction version. Credentials are transport configuration, never URL parameters or task payloads.
- Read result: requested/final URL, status/failure category, collected timestamp, original extracted text with content hash, bounded source links, document/page/row references, publication date if established and truncation/parser metadata. Store enough original context to validate claims; no AI summary substitutes for source evidence.
- Failure detail: distinguish robots/access denial, network/HTTP/timeout, unsupported type, PDF parse/OCR needed, empty content, quota and resource exhaustion. The current durable reader collapses failures to `unreadable=true`; preserve safe categories in the new implementation so coverage can actually be diagnosed.
- Company bundle: established entity identity/aliases, official-domain association and independent evidence references for material, geography, project relationship, activity and contacts. Pages may corroborate claims only after resolving that they refer to the same entity. Preserve contrary facts and historical status.
- Persistence: reuse current jobs/leases/outbox and canonical data wherever possible; add migrations only for demonstrated schema gaps. Node-side validation remains authoritative for eligibility and saves, even when an external worker fetches text. Each discovered link becomes a bounded, deduplicated task; never let an in-memory crawler run invisibly beyond the saved run budget.

The optional crawler does not own company qualification, CRM status, recipient policy, contacts verification or message/calendar side effects. Existing mocked/offline tests do not prove the new worker's safety or cloud compatibility.

### Deferred work and non-goals

Contact discovery/provider verification follows useful company discovery. Email-reply and meeting proof follows contact/identity policy, using only the approved demo inbox until separately authorized. Cloud follows durable execution, hosting eligibility and recovery gates. Larger budgets, local-language searches and licensed project/contact datasets are later growth phases after measuring the limiting stage.

No guaranteed 50-100 results per arbitrary material/country; no claims that all source-listed firms currently buy; no invented dates/people/projects; no unrestricted LinkedIn scraping; no blind restoration of mixed tender/supplier legacy results; no wholesale CRM or email-stack rebuild; no always-on free-cloud promise.

## Execution flow

```text
Material and countries
  -> validated material interpretation
  -> persistent research plan and budget
  -> company searches | project searches | permitted directory seeds
  -> safe original page reads and company identity resolution
  -> evidence bundles for identity, material, geography and activity
  -> grounded potential companies saved progressively
  -> published contacts attached independently
  -> explainable ranking and search-scoped CRM
  -> optional policy-controlled outreach
```

The browser creates a run and observes it. It must not keep the research alive. Research and contact extraction can finish independently, and a blocked provider must not delete already saved results.

## Material interpretation

Extend the existing catalogue with consuming activities, target company roles, exact synonyms, exclusions, related materials that must not substitute, and optional standards. Cover mechanical piping, civil steel, cables and wiring, trays, instruments, pumps, valves, insulation and consumables. Separate products that have different buyers or incompatible specifications.

Known catalogue items use reviewed deterministic mappings. For custom material input, a model proposes a structured interpretation that is validated and shown to the user before spending. Ask a brief clarification for ambiguous terms such as wire, panel or insulation. Never silently map unsupported cement or switchgear input to a pipe item. Do not claim to supply certifications, brands or categories the seller has not approved.

Persist the interpretation with the run. Query wording may change across batches, but CRM keyword and sellable product remain the user's selected intent.

## Search planning and breadth

Use complementary query lanes, not one enormous query containing every requirement:

- Company capabilities: material-consuming activity plus country and relevant company type.
- Material-specific work: exact material plus installation, fabrication or procurement terms.
- Project execution: attributable award, mobilization and progress updates.
- Permitted directories: approved contractors, associations and public business registries as seeds.
- Targeted follow-up: official-domain services, projects or contact pages for an identified company.

Example for cables: cable-laying and electrical installation contractors; MEP contractors with power distribution work; recent substation execution contractors. Avoid merely searching cable suppliers. For welding consumables, fabrication and welding operations can support an application without an electrode purchase announcement.

Persist tasks by country, lane and activity variant. Round-robin country coverage before spending multiple calls in the first market. Show which countries and lanes remain unsearched. Broad local-language variants are a later extension with translation and original-source preservation.

## Bounded research modes

Proposed demo experiment budgets, subject to dashboard quota confirmation:

| Mode | Target | Maximum initial search calls | Suggested original-page ceiling |
| --- | --- | --- | --- |
| Preview | Establish an initial useful result set | 3 basic queries | 30 reads |
| Research batch | Expand the selected material and countries | 6 basic queries | 60 reads |
| Deep research | Aim toward 50 to 100 unique eligible companies | Up to 24 basic queries over resumable batches | 200 reads initially |

These are ceilings, not expected yields. They do not override the present code caps until implemented and approved. A company may require several pages; 200 reads do not imply 200 companies. Reserve the separate AI budget before expanding pages. Stop on quota limits, repeated low-yield lanes, cancellation or target reached.

Proposed first-batch AI ceiling: 12 calls and 30,000 total estimated input/output tokens. Proposed deep-experiment ceiling: 40 calls and 100,000 total tokens cumulatively, not per resumed batch. Include at most two repair calls inside those ceilings. Limit normal evidence bundles to four pages per established company/domain; exceptions for permitted structured directories have an explicit separate page allowance. Extract at most five company candidates per AI chunk, retaining a cursor rather than discarding remaining candidates. Every ceiling is reduced to the available account/model quota and remaining daily application allowance at preflight. These are deliberately bounded experiment settings, not known free-account entitlements or claims that 100 companies fit them.

Measure unique relevant companies per credit and material/country coverage. Expand the best unexplored lanes rather than repeatedly querying the same words. Existing snapshots and extraction caches should avoid duplicate calls. More result URLs do not automatically imply more unique prospects.

## Safe fetching and extraction

Reuse `pipeline/read.ts` and `net-guard.ts` for public-IP checks, redirect validation, robots and domain pacing. Preserve the existing 3,000,000-byte response limit, expose truncation in evidence/coverage metadata, add bounded PDF-specific limits and record per-page failures. Revalidate all fetched links, including sitemap and contact links. Bound requests per domain and run; no unlimited recursive crawl.

Select sections before the AI text limit, including identity and relevant service context, instead of taking only the first 22,000 characters. Preserve navigation/footer separately when useful for identity or contacts. Website content is untrusted data, never agent instructions.

PDF reading is currently skipped. Add bounded text-PDF support early in the accepted discovery-first increment because contractor lists and project profiles can be valuable. Validate page/byte limits and table associations; store page references. Scanned documents need an explicit OCR budget and may remain unreadable. A PDF parse failure must not report zero market buyers.

## Company evidence bundles

Build one bundle for each established entity with references to original documents. Its claims include identity, consuming activity, exact material application, geography, project relationship, dated activity and published contact coverage. Quotes can span sections or verified pages, but each claim retains its own original span.

The model extracts candidate claims; deterministic validators check literal evidence and relationships. A bounded repair pass can resolve a rejected alias or missing company context using already collected text. Version cache keys by content, material interpretation, schema and prompt. Do not reuse a stale empty extraction indefinitely after a logic upgrade.

Deduplicate on supported entity identity, normalized legal name and geography with documented domain associations. Shared group domains are evidence hints, not automatic entity merges. Aggregate multiple projects under one company card while preserving distinct project-company-product relationships. Count the company once per search/product, not once per article or contact.

## Proposed persistence

Preserve `runs`, `source_documents`, `run_documents`, `evidence`, `companies`, `people`, `contact_points` and `search_opportunities`. Add expandable schema through new migrations:

- `research_plans`: immutable material interpretation, target, effective budget and policy versions.
- `research_jobs`: stage, cursor, due time, state, attempts, dedupe key, lease owner and expiry.
- `research_candidates`: entity seeds, validation state, nullable facts and scoped rejection reasons.
- `company_claims`: typed evidence-backed statements including geography and dated activity.
- `provider_budget_reservations`: atomic credit/token reservations and reconciliation state.
- `event_outbox`: committed work to publish; IDs rather than secret or document payloads.
- Opportunity extensions: fit kind, activity class, supporting event date, rank components/version and official-domain status.

Use existing migrations for published contacts where possible. Do not replace canonical company/contact tables with competing datasets. Add authenticated paginated result APIs rather than increasing the existing 2,000-row list limit forever.

## Durable job behavior

States are proposed as queued, running, retryable, succeeded, paused_budget, failed and cancelled. Runs distinguish complete, partial and paused budget from failed. Avoid presenting budget exhaustion as a successful exhaustive search.

Claim a job atomically with a lease token. Perform network calls outside long DB transactions. Commit results, counters and successor outbox entries together. Accept at-least-once transport; unique constraints and provider keys prevent duplicate effects. Lease expiry alone does not prove a provider request failed: reconcile uncertain calls before repeating chargeable or irreversible actions.

Use delayed jobs for rate-limit resets instead of sleeping inside a function. Cancellation stops future work and outreach enrollment, but does not retract already accepted email or delete saved source-backed companies.

## Events and progress

Proposed typed events include `research.created`, `interpretation.confirmed`, `query.completed`, `page.read`, `page.blocked`, `company.discovered`, `claim.accepted`, `candidate.review_needed`, `prospect.saved`, `activity.classified`, `contacts.updated`, `budget.paused`, `research.partial`, `research.completed` and `research.failed`.

Each event carries run/job/opportunity IDs where applicable, schema version, timestamp, dedupe key, sanitized reason and counters. No credentials, full private email text or raw provider error bodies in progress events. Counts distinguish pages, candidate companies, eligible companies, recent activity and contact types. Errors stay inspectable without overwhelming the client's default screen.

## Discovery-first revision after the one-company live run

Audited 5 October 2026. The user wants real potential customers first, including relevant subcontractors and input-consuming businesses, with unknown details blank. Contacts and automated outreach must not determine company visibility. This section is a proposed implementation order; it does not report a newly completed multi-company search.

### What actually happened

Run `18f753d2-7211-4c33-9bcb-feb034821fd8` searched Power and control cables in UAE. Its 22 source jobs were two targeted Tavily queries, six Bing news queries, thirteen RSS feeds and one GDELT request. These are tasks, not 22 independent company databases. After one explicit resume, the run recorded 19 pages read, 15 unreadable pages, four AI analyses checked and one saved potential company, L&T. The failed GDELT job and incomplete coverage remain visible. Four extraction responses contained five mentions of four distinct company identities, not dozens of rejected valid buyers.

Both Tavily queries combined an activity with EPC/contractor/project wording and cables; the project lane additionally asked for awards. Several returned pages were inaccessible directories/social sites, jobs or generic lists. News/RSS also introduced unrelated articles. Only L&T had sufficient accepted company/material/UAE evidence in the four analysed responses. This is a coverage and extraction limitation, not evidence that the UAE has only one cable customer. The one-prospect demo sending cap does not limit CRM company results.

Current gaps confirmed in code:

- `discovery/plan.ts` creates company/project/activity queries, not structured directory jobs or per-entity website investigations. Deep mode cannot bypass environment ceilings: this local configuration clamps search queries to three and AI pages to twelve.
- `pipeline/read.ts` skips PDF URLs and PDF responses, including `.ashx` PDF attachments.
- `discovery/index.ts` extracts at most five companies per response. There is no directory cursor to recover subsequent rows; increasing only the response limit is not safe for large lists.
- The accepted roles are EPC contractor, subcontractor and fabricator. Supplier/owner/unknown are rejected; mixed input-consuming businesses and channel buyers need explicit new policy and evidence, not blanket inclusion.
- Company claims are checked within one source page. Several official pages cannot yet be assembled into a verified company evidence bundle.
- The target-company setting is a stored research target, not an adaptive query-generation/yield loop. Legacy supply-chain role slots are not evidence of actual named subcontractors.

### A concrete missing source, not a hypothetical subscription

The [official DEWA contractor page](https://www.dewa.gov.ae/en/builder/useful-tools/Approved-Distribution-11KV-33KV) links a [two-page July2026 cable-contractor list](https://www.dewa.gov.ae/-/media/Files/PVT/DEWA-Private-Cable-Laying-contractor-Approved-list-dated-01-july-2026.ashx). Its header covers 1 July to 31 December2026. Page1 contains eleven named cable-installation contractors and published business contacts, including OHL Contracting, AASA Middle East Contracting, ARAR Utility, Danway EME and Wade Adams. The file contains revision/disclaimer details and a confidentiality header despite being publicly linked; preserve its provenance, review reuse permissions and avoid bulk republication of personal contact data.

These eleven rows are candidate seeds, not eleven independently verified active purchases. The notes explicitly discuss free-issued materials and recommend approval confirmation. Do not infer that contractors buy cables for every DEWA job, treat the approval interval as a project date or label the listed contact a procurement manager without evidence. The earlier January2026 list has an expired approval interval and must not silently substitute for the July publication.

[ARAR Utility's official company page](https://arargroup.com/utility/) separately documents UAE underground cabling, substations and installation services with company contact channels. That supports a potential cable-material application, not a confirmed current order or verified personal email. It is a useful cross-document benchmark and must not be hardcoded as a result for unrelated materials.

### Admission and relationship rules

1. Save a named real company with sourced consuming activity relevant to the selected material. Award, named project, score threshold and contact availability are not admission requirements.
2. Classify EPCs, relevant MEP/civil/mechanical/electrical contractors, installation subcontractors and fabricators by documented activity. Manufacturers qualify for material inputs, not merely because their outputs resemble the search. Record procurement responsibility as unknown unless established.
3. A distributor/reseller can be a separate potential channel customer when sourced business activity supports stocking/buying the searched material for resale. This remains an inference, not proof of current demand. Supplier-only competitors remain excluded from direct-buyer results; unresolved roles go to a labeled review bucket, not fabricated buyer status.
4. A project yields only its explicitly named contractors, joint-venture members or subcontractors. Investigate their official sites for additional relationships. Do not turn anonymous work packages, an owner, a parent company or a contractor directory into a fabricated project/subcontractor relationship.
5. Supplier customer lists or historical case studies can identify a company to investigate, with relationship date/status retained. They do not establish current demand. Current/ongoing work needs independently attributable activity evidence.
6. Unsupported project, person, phone, email, quantity, grade and activity date remain null. Scores order accepted companies; they never manufacture evidence. The sellable-product field contains only the selected product, with exact versus application-inferred fit distinguished.

### Execution increment

Keep existing research jobs, CRM and detailed workspace; change coverage before another UI rewrite:

- Add source-registry entries by material, country, source type, permission and freshness. Prioritize official contractor/utility lists, associations with allowed reuse, company services/projects and attributable award announcements. Read utility lists for contractors, not to add the utility itself as a buyer by default. General news becomes supplementary.
- Add bounded text-PDF/table ingestion with stable row/page citations, byte/page limits and chunk cursors. Recover every identifiable row within the budget; unparseable/scanned files become coverage warnings. Do not equate a directory listing with supplier responsibility or email deliverability.
- Plan short complementary searches such as UAE cable laying contractors, UAE electrical installation contractors, DEWA approved cable contractors and UAE substation EPC awards. Do not require every term, an award and a person in every query. Rotate country/activity/lane fairly.
- Resolve each candidate's official domain, then inspect up to four permitted services/projects/contact pages. Establish identity/aliases before combining source claims. Deduplicate entities without merging different subsidiaries or discarding multiple project relationships.
- Support attributed subcontractor/JV/customer edges, each with its own source and date. Preserve unsourced supply-chain role suggestions only as research tasks, never named leads or counts.
- Add an adaptive bounded continuation: measure unique eligible companies per query/read/AI call, explore unused productive lanes and stop visibly on target, budget, cancellation or low-yield saturation. Do not repeatedly charge for the same query or automatically bypass access restrictions when a page fails.
- Publish companies progressively to the existing selected-search CRM. Group under sourced projects where known and under company-level opportunities otherwise. Display separate counts for companies, supported projects, active work and contacts. Explain incomplete coverage without implying an exhaustive search.

### Provider choices checked on 5 October2026

| Service | Current published free allowance | Proposed use and caveat |
| --- | --- | --- |
| [Tavily](https://docs.tavily.com/documentation/api-credits) | 1,000 credits/month; basic search1, advanced2 | Existing integration first; shorter queries and selective official-domain extraction. Verify remaining dashboard quota. |
| [Serper](https://serper.dev/) | 2,500 free queries, no card | Optional complementary Google-result coverage through `SERPER_API_KEY`. This is not a claimed monthly renewal. Read original sources before accepting evidence. |
| [Firecrawl](https://www.firecrawl.dev/pricing) | 1,000 credits/month, no card | Optional permitted-site extraction fallback through `FIRECRAWL_API_KEY`, not wholesale crawling. Scrape is1credit/page; some error-status responses are charged; extra features cost more. |
| [Apify](https://apify.com/pricing) | $5 monthly usage, no card | Later targeted source adapter if a permitted actor fits; actor fees/compute/storage consume the same budget. Not a ready verified-buyer CRM. |

Do not ask for every account initially. Existing Tavily/Groq plus official HTML/PDF sources suffice to implement and measure the first revision. Serper is the preferred optional additional search key; Firecrawl is optional if readable-page coverage remains the bottleneck. Provider storage/reuse terms and account-level limits require review before persisting external results. No new provider was integrated or charged by this documentation audit.

[LinkedIn prohibits unauthorized scraping and automation](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software?intendedLocale=en&lang=en-us). Do not make logged-in profile scraping a critical discovery dependency. Contacts can follow through permitted public company pages, user-authorized/manual data or a licensed enrichment source with reviewed terms; no guessed email or account/access-control bypass. Emailable validates an already known address, not company discovery or person/email finding.

Paid search/crawl and licensed industry databases can increase coverage, access and repeat frequency later. They cannot fix wrong entity/material attribution, stale project claims, missing table support or false precision. Cloud deployment also does not increase discovery recall by itself; retain document07's durable-execution gates for Vercel.
# Implementation refinement — 6 October 2026

Small research budgets prioritise several material-consuming company activities before generic award and directory routes. Markets remain round-robin; job priorities preserve planned order rather than random UUID order. The Tavily adapter explicitly keeps basic search, disables automatic upgrades, requests up to20 URLs, excludes noisy social/job domains and uses supported country boosts. A boost is never location evidence. Parameters follow the [official Search contract](https://docs.tavily.com/documentation/api-reference/endpoint/search).

Reading admission ranks original URL/title and bounded search previews, visits distinct domains first, and reclaims unused query shares after collection settles. Previews are never `text`, fallback evidence or contact proof. No extra search occurs during this recovery; global/source/domain caps still apply. Blocked pages remain failures, not rewritten facts.

An explicitly corroborated first-party company capability can produce a potential-buyer record deterministically. It requires literal company branding plus a company-attributed consuming-work statement matching the selected material. It rejects output-only fabrication, unrelated sales, jobs, tenders and other companies' work through the common validator. It preserves an evidenced office location, rejects clearly out-of-market identity, and leaves dates/projects/contacts unknown. A contractor role is a capability-based classification, not proof of an awarded subcontract or current procurement. Ambiguous pages still use bounded AI extraction and human review.

Accepted AI JSON is saved before schema validation so parser defects can be reviewed without repeating a paid provider call. Unknown acceptance and unparsable responses do not trigger automatic retries. No new provider, crawler stack, cloud deployment or buyer-delivery permission is implied.
