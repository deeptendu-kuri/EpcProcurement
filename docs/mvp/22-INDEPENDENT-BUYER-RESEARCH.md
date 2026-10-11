# Independent buyer research and evidence-first repair

Date: 2026-10-11. Local branch: `fix/buyer-first-search`. No cloud migration, push or deployment in this work.

## The requirement

A seller enters a material, its variant and countries. Return real organisations whose own work could consume that material, with original-page evidence, operating country, role and the available time window. Missing contacts, quantities, specifications and purchasing information stay blank. A plausible application is not a confirmed order or validated contact.

## What failed in the preceding live rehearsal

The isolated stainless process-pipe test saved zero buyers after ten minutes. It read 28 originals, made six chargeable Tavily requests and recorded 35,512 AI tokens. It was stopped before natural settlement. The detailed audit remains in the ignored benchmark folder, not cloud data.

Observed defects, not speculation:

- Exact-grade grounding found manufacturers and technical charts before consuming companies.
- Any six-row table was classified as a directory; specification charts incurred list extraction.
- A valid JSON brief contained serialized fragments in owner/place strings, which became search queries.
- Investigation could mark a page as handled without queuing an analysis of the consuming work.
- The same article required several extraction/rating passes before a visible buyer appeared.
- An older contract's date could reject work that an original project-progress page shows is still underway.
- An email address was admitted as a company identity.
- A primary owner release's contract paragraph was present in storage but absent from the model's first-4,500-character excerpt because navigation consumed that window.

## Independent research: primary sources, not search-result snippets

Research material: stainless process pipe, specifically the user's ASTM A312 TP316L wording. The sources below establish plausible process-plant work, NOT that exact grade or an unfilled purchasing requirement.

| Country of work | Potential buying company | Original work evidence | Time basis and caveat |
|---|---|---|---|
| Canada | McDermott International | Woodfibre LNG's owner names its engineering/procurement/fabrication/construction contractor. | Construction page has 2023 metadata; a separate May 2026 owner update reports 65% completion. Preserve both sources; do not relabel 2026 as the award date. |
| UAE | Wison Engineering | ADNOC Gas identifies its EPC scope for the next gas-processing train at Habshan. | Owner's August 2026 release. Exact pipe grade and remaining procurement unknown. |
| UAE | Tecnimont | ADNOC Gas names it for an NGL fractionation train at Ruwais. | Owner's August 2026 release. Potential process-piping application, not an RFQ. |
| UAE | Technip Energies, JGC, NMDC Energy | Contractor's original release names all three partners and the Ruwais LNG EPC package. | June 2024 contract release, within the existing 30-month window in October 2026. Recent project activity can support it but must not change the original contract date. |
| India | Praj Industries | Its own February 2026 corporate release lists a greenfield brewery contract and fermentation work. | Corporate report: identity header and work bullets are separate literal spans. Exact specification and purchasing stage unknown. |

Sources:

- https://woodfibrelng.ca/construction/
- https://woodfibrelng.ca/news/2026/05/25/woodfibre-lng-at-65-complete-partnership-driving-progress/
- https://www.adnocgas.ae/en/news-and-media/press-releases/2026/q2-2026-results/
- https://www.ten.com/en/media/press-releases/technip-energies-jgc-and-nmdc-energy-awarded-major-contract-adnocs-ruwais-lng
- https://www.praj.net/wp-content/uploads/2026/02/Praj-Q3-9M-FY26-Results-Release_12022026.pdf

The same project names Ledcor Bird, but involvement alone does not prove a process-pipe buying package. The replay deliberately rejects a civil/marine-only scope. Undated service capabilities remain a separate early/possible lane; they must not be advertised as recent orders.

Five originals were captured successfully through the application's public-URL/robots-respecting reader. Two additional pages failed the reader; no replacement text or access-control bypass was used. Raw capture is ignored under `tmp/independent-buyer-sources`. The five successful originals form the checked-in regression corpus. This corpus is test-only, never production search seeds.

## The implemented route

```text
Typed material + variant + countries
  -> reviewed consuming-work vocabulary + checked/cached AI brief
  -> consuming-work grounding, owner progress pages, contractor releases,
     genuine contractor lists, official records and capability pages
  -> polite original-page read and semantic page classification
  -> ONE work/role/need check on a consuming company page
  -> literal quote + company attribution + work country + own package
  -> recent contract OR separately cited ongoing progress OR early capability
  -> save company x material x search immediately, even with zero contacts
  -> existing project/trigger extraction and optional later enrichment
  -> existing finished-search top-three approved-inbox email demo
```

This extends the durable job engine, original-page reader, trigger/roundup/capability lanes and current workspace. It does not introduce microservices, a replacement agent, another recipient API or a dependency on contact enrichment.

### Search planning and cost controls

- Brief version 2 invalidates older cache keys. Reject embedded JSON fragments and generic field-name values before paid queries.
- Ground on consuming work, not a grade/product catalogue query.
- For stainless piping retain reviewed gas-processing, chemical-process and hygienic-process applications. These are planning assumptions, never proof of specific grades.
- Project searches include general original construction/progress pages, not only a news date filter.
- The initial paid requests are spread across countries and project/capability/list lanes. Supplier/stockist searches require explicit reseller selection in the work-based plan.
- A technical/financial table needs company-list semantics before the list extractor runs.
- Current per-run and domain budgets remain explicit and reducible. No provider key, limit or paid subscription changed.
- No contact pass is required to admit a buyer. Company pages can receive a need check even when an investigation has already associated them with a candidate.
- Focus the bounded model excerpt on original contract/scope paragraphs and their immediate context. Tests require the actual role/work spans to appear in the prompt, not only in the full stored document.
- Alternate grounding-page admission across countries, not merely the search requests. Keep unadmitted grounding URLs in the durable checkpoint.
- Free-news task counts cannot demote a country's first paid query. Use stable country ordering for those priorities.
- FT, Business Wire, Upstream and Gulf Today are publishers, never the company's identity. Work-based contact/about follow-ups and extra bundle analyses run after first-pass buyer checks.
- The need prompt labels literal source paragraphs. A bounded integer reference resolves to the stored paragraph, avoiding AI-generated typography/headline concatenation. Invalid indices, unrelated companies, completed work and paraphrases without a valid original span still fail closed.

### Evidence and dates

- Exact source spans are revalidated before saving and before demo qualification.
- Reject email/URL company names, invented locations, completed jobs and unrelated civil/electrical-only packages.
- An own-company report may use a separately verified company header and a literal work bullet. The matching own-domain brand is required; a publisher's name cannot donate identity to another company's work.
- A recent progress paragraph must name the same distinctive project and show ongoing construction or partial completion. An industry word or publication date alone is not enough.
- Link progress evidence and older contractor-role evidence as separate records. Do not change the contract date.
- When progress arrives later, rejudge at most ten already-saved answers without another AI call. Reading order must not determine whether ongoing work is lost.
- Recover explicit publication headings/corporate datelines when metadata is absent; do not use a forecast year as a publication date.
- A capability or progress sentence is not automatically a "Contract won" trigger. Only actual won/awarded/signed-contract language receives that kind.
- All need-inferred material fits stay `potential`. Exact grade, order, quantity and remaining procurement are unconfirmed.

## Verification and honest limits

The independent primary-page replay uses MOCKED model answers and stored real originals. It is intended to prove routing, admission, quote provenance, country/time checks, immediate persistence and zero-contact behaviour. It does not prove live web recall or live model extraction quality.

Expected replay: seven distinct potential buyers, nine evidence links resolving to six distinct original quotes (JV partners share one sentence); zero people/contact rows; five mocked need checks; no provider credits or email deliveries. The pending-job sentinel proves buyers become visible before a run settles. Existing email/meeting tests must also remain green.

A fresh live run after this repair is a separate release check. Do not claim the app reliably finds seven buyers, 50 leads, all countries equally well, or that an email was delivered based on this replay. A stronger paid model can improve extraction consistency, but cannot compensate for the wrong source plan, missing job wiring, poor attribution or fabricated specifications.

For the next live rehearsal, use one isolated local database, no cloud URL/migrations, email/workers off, a bounded deadline and explicit limits. Record actual paid calls, tokens, pages, accepted/rejected organisations and exact evidence links. Do not repeat failed charged queries silently. Review every saved buyer, not just a model score.

### Approved live rehearsal and subsequent repair

Run `a513170f-ee2f-4bc2-88f2-9d9f8a266100`, 11 October 2026, used a fresh isolated PGlite database and the production research engine with real Tavily/Groq responses. No fixture URLs or company names were seeded. The harness prohibited delivery, Calendar, enrichment and cloud database access. Its six Tavily requests consumed six reported credits; twelve actual AI HTTP requests recorded 16,789 tokens (HTTP failures mean provider consumption is not completely known). It stored 23 pages and saved **zero leads**. It was stopped at 155 seconds when no runnable step remained; deferred/provider-waiting work existed, so this was NOT natural completion and NOT a passing quality gate. Vitest's normal live pacing flag was absent; rate-limit/performance behaviour is therefore not equivalent to the production app. Two HTTP 429 responses occurred.

Artifacts: ignored `tmp/live-quality-2026-10-11-1791704967786/report.md` and `audit.json`. Emails: zero, deliberately disabled.

The original results included relevant contractor statements for LNG Canada Phase 2 and Ruwais LNG infrastructure. The queue spent early analysis on repeated India capability/service pages before checking them. Grounding admission filled the discovery share with the first country's URLs; paid priorities were also skewed by the number of preceding free-news tasks. FT and Upstream were mistaken for company sites and acquired irrelevant follow-ups. ISGEC's valid own-site work was rejected because the model regenerated a non-contiguous quote despite supplying the correct identity header. No rejection was caused by missing contacts.

These observations produced the additional routing, publisher and paragraph-reference repairs above. Three real pages from that live audit are regression fixtures, not live production seeds. Tests validate Canadian JV admission, ISGEC literal paragraph selection, country-fair planning/admission, deferred follow-up priority and persistence of accepted proof on a previously quote-less seed. Those tests use mocked extraction answers and do not establish that a live model now returns them correctly.

Do not claim the repaired live search passed until a subsequent approved real-provider test demonstrates saved, source-audited buyers. Do not deploy on the strength of mocked replay counts alone. No further paid requests are allowed under the original six-search/twelve-AI approval.

### Two-request cached-source follow-up

The owner separately authorised at most two AI HTTP requests on the already-stored Canadian and UAE pages, with no further searches or emails. The focused run used its own PGlite database and normal live pacing. It made **one actual Cloudflare HTTP request**, which returned **429 Too Many Requests**. The provider circuit then prevented another HTTP request. No model answer, need check or buyer was saved; recorded successful token usage was zero. No emails or web searches occurred. This is a provider-limited **inconclusive qualification test**, not a passing test of the extraction repair.

Artifacts: ignored `tmp/cached-quality-2026-10-11-1791705744611/report.md` and `audit.json`. Its harness assertion passed only for the two-request ceiling, prohibited integrations and evidence guards. The zero-buyer result must not be presented as successful lead generation. No additional request was made after the circuit opened.

### Root cause summary for handoff

Buyer scarcity is not the observed cause: the captured originals already describe relevant construction companies. The failure is a chain of inefficient discovery admission, wrong page identity/classification, repeated low-yield analysis ahead of country-diverse contractor work, and brittle source-quote extraction. The small AI budget and subsequent provider refusals expose that chain; buying a larger quota alone would spend more on it. Contacts did not block admission. The local repairs have regression coverage, but fresh end-to-end live recall and model extraction remain unproven until an approved provider-available rehearsal passes. No claim of reliable 50/100-lead output is justified.

### Final local checks (11 October 2026)

- Typecheck: passed.
- Lint: passed.
- Full suite, `--maxWorkers=2`: **1,584 passed, 10 skipped**, 157 passing files and four skipped files. Network captures are opt-in. Offline passing counts do not include a lead-quality gate for the failed live harnesses.
- Isolated production build, `node scripts/build-local-proof.mjs`: passed. Cloud database and provider keys were blank; background delivery/research workers were disabled during the build.
- Live lead-quality gate: **not passed**. The fresh rehearsal saved zero; the focused follow-up was blocked by a provider 429. No cloud change or email delivery was performed.

## Subsequent live results and relevance-to-email repair

These results supersede the zero-lead result above for the later rehearsals, not for the earlier failed runs.

| Rehearsal | Scope | Saved buyers | Actual paid calls | Recorded tokens | Delivery |
|---|---|---:|---|---:|---|
| `cached-quality-2026-10-11-1791707300937` | Two already-stored originals, real Groq 20b, isolated PGlite | 2 Canadian contractors | 2 AI requests, no search | 4,129 | Disabled |
| `live-quality-2026-10-11-1791707884311` | Fresh India/Canada/UAE search, normal production pacing, capped | 2 Canadian contractors on one LNG project | 6 Tavily / 6 reported credits; 12 AI HTTP requests (11 successful, one 429) | 21,809 | Disabled |

The fresh run read 26 pages in 294 seconds and ended **partial** under its explicit request ceiling/source failures. India and UAE saved zero in that fresh run. This is not a passing all-country recall gate or a full uncapped search. Request ceilings blocked additional attempts before HTTP. Successful-token totals do not include unknown consumption for provider errors.

Original literal quotes and company roles were valid, but the saved reasoning overstated an ASTM grade; the Canadian construction contract was labelled capability-only. Other checks rejected UAE contractors solely because articles do not specify pipe materials. An EPC event and a government ministry were also incorrectly admitted as found-company candidates, though not saved as leads.

### What this additional local repair builds

- A deliberately bounded, reviewed stainless-process-pipe application rule corrects only missing-material/specification false negatives. It still requires a matched brief use, a literal company-attributed scope, country and time checks, and a material-consuming contractor role. An explicit `buysItem: no`, unrelated use, fabricated quote, design/civil-only work, old work or future work still fails closed.
- Split multi-company paragraphs into attributed clauses before inferring applications. ENPPI/Petrojet's LNG pre-conditioning package and Petrofac's compression package are potential process-pipe applications; the other contractor's transmission-pipeline package cannot borrow those applications. LPP's literal definition is retained as separate application evidence.
- Persist and display a controlled potential-demand explanation. The model's raw answer remains available in the durable job audit, but is not shown as proof of an exact grade, quantity, order or remaining purchasing requirement.
- Recognise EPC selection with an actual contract/Notice to Proceed as a won construction package, not a prize. Separate literal publication-date evidence from contract/work evidence; publication alone never becomes an award date. Recent/ongoing physical work is not labelled capability-only.
- Reject event/expo headings and government departments as contractor candidates. Common legal words such as "Corporation" cannot establish an unrelated company identity.
- Preserve full-name and short-name work paragraphs separately when an original EPC announcement establishes the legal name. A sourced legal short name such as JGC can then be used by the existing outreach attribution guard; invented acronyms and another company's work remain invalid.
- Retain same-package location context as a separate literal quote, so the saved operating country comes from the work, not company headquarters. An event-heading filter must not discard a legitimate contractor merely because its name includes "Summit".
- Extend the existing research/email modules; no new recipients, routes, dependencies, migration, external settings or architecture replacement.

### Why no email arrived in the live lead-quality test

The isolated harness explicitly disabled workers, cleared delivery credentials and prohibited email HTTP. There was **no send attempt**, not a failed Resend delivery. Missing buyer contacts did not cause this. The normal approved-inbox demo enrolls a source-backed finished/partial search, after automation was enabled, without requiring a buyer contact. Paused/running searches wait for completion; cancelled searches and historical runs do not enroll automatically. Demo sends remain limited to the configured top three and the approved inbox, not all researched companies.

### Offline proof and remaining live gate

`captured-need-answers.json` is an exact replay of the two retained real Groq responses, checked against the ignored audit file. It is not a fabricated successful model response or a production seed. With the repaired judge/persistence, those same originals and answers save **five potential buyers**: Fluor Corporation, JGC Corporation, ENPPI, Petrojet and Petrofac Emirates LLC. No contacts are invented. The transmission contractor and owner are not saved as stainless process-pipe buyers.

`automation/research-handoff.test.ts` runs those captured answers through real need checking, candidate registration, saving, Pause/Finish control, outreach eligibility, source/ID attribution, qualification and seller introduction. Only the qualification model decision and Resend provider delivery are mocked. It asserts zero people/contact rows, zero enrollment while active or paused, three best-rated approved-inbox introductions after Finish, correct seller/customer identities, no duplicate send, and no HTTP. A passing offline mock delivery is **not proof of Gmail receipt**.

Remaining release check: a separately authorised, bounded fresh live search followed by actual approved-inbox delivery, with worker/config readiness inspected first. This local patch is not pushed/deployed and does not modify historical or cloud data. No new provider credits or actual email deliveries are used by its regression tests.

Final offline suite for this repair: **1,603 passed, 10 skipped** (159 passing files, four opt-in skipped files), using `--maxWorkers=2`. The 19 added tests include captured-answer relevance and real persistence/qualification-to-mocked-delivery handoff. Typecheck, lint and the isolated production build also pass. None of these results constitutes live inbox-delivery proof or a fresh multi-country lead-volume gate.

## Production-app local rehearsal with real delivery, and checkpoint repair

Both runs below used the actual production Next.js app, its browser search form, normal provider pacing, real Tavily/Groq, a fresh isolated local PGlite database, and automation enabled before submission. Input: stainless steel pipe ASTM A312 TP316L for process piping; India, Canada and UAE; Quick, no auto-pause or extra rounds. No fixture company, URL or answer was seeded into either fresh search. No Render, cloud database, migration, push or deployment was performed.

| Stage | Original saved prospects | Requests/cost | Outcome |
|---|---:|---|---|
| Run `1648f22b-72ce-414e-9fc8-593c7cc5289b` | 3: Fluor, JGC and Worley Engineering | 12 actual Tavily requests; 23,591 recorded research tokens; Cloudflare 429 failures | 320 seconds. Two introductions delivered, but Worley's FEED-only scope was an admission failure and JGC was held for review incorrectly. User confirmed Fluor receipt. Worley's demo conversation was paused. **Quality gate failed.** |
| Fresh run `d020dc0d-bd7d-4699-8ed5-03957d537947` | 4 Canadian entities: Fluor Corporation, JGC Corporation, Fluor Canada Ltd and JGC Constructors (No2) BC Ltd | 12 Tavily requests/credits; 22 actual AI HTTP requests including two Cloudflare 429s; 31,581 recorded research tokens, 35,689 successful HTTP-response tokens including qualification | 427 seconds. Three introductions automatically delivered only to the approved inbox: Fluor Corporation, JGC Corporation and Fluor Canada Ltd. JGC was no longer held and Worley was rejected. India/UAE still saved zero. **Fresh country-coverage gate failed.** |
| Same-run checkpoint recovery after the next judge repair | +4: Larsen & Toubro (India); ENPPI, Petrojet and Petrofac Emirates LLC (UAE) | Zero new HTTP, AI or email requests | Exact stored real answers and original pages passed through the production need-check, candidate-registration and saving functions. The local UI now displays 8 opportunities. **This is recovery, NOT another fresh search or a passing fresh-search gate.** |

The four Canadian entities represent two corporate groups on one project. Do not market them as four unrelated customers. Contacts remain zero; role placeholders are not identified people. Exact grade, quantities and remaining purchasing needs remain unconfirmed.

The fresh runs settled at `runs.status=done` and `research_sessions.state=done`, but requests were blocked by the explicit rehearsal ceiling and additional analysis was skipped at its budget. The UI correctly labels the latter run "Finished · partial". Completion does not establish exhaustive source coverage. Two blocked Tavily attempts in the second run were never sent; the UI's 14 reserved search units are not 14 paid requests. Its hard request guard persisted counters across the later local restart.

### Repairs grounded in these failures

- Inspect original company-attributed clauses for design/FEED-only scope before saving or qualifying a buyer. An invented model package such as "EPC" cannot override a literal FEED contract. Rated candidates cannot bypass this guard.
- Supply the bounded email fit request with stainless-process application guidance. Physical LNG EPC/JV work supports a potential application, not proof of ASTM A312 TP316L. Preserve AI rejection for incompatible work and require real cited evidence IDs.
- Recover a null model use only when its reason is missing material/specification wording and the original company-attributed application matches the reviewed stainless rule. Unrelated-use, explicit own-package rejection, country, time, quote and role guards remain.
- Distinguish a polymer-manufacturing unit's output from its piping material. A polyethylene plant can have potential stainless-process applications; an explicitly polyethylene/HDPE/PVC piping package cannot borrow that inference.
- Store each company's recovered application separately, not another contractor's scope. The transmission-pipeline contractor remains excluded.

The second run's two exact responses and pages are test-only `live-app-need-regressions.json`. They are never production seeds. Regression tests check both rejections and recovery. A separate ignored, no-HTTP checkpoint harness applied the same production persistence functions to the stopped local test database and confirmed all evidence quotes exist in that run's originals, four recovered prospects and zero person/contact rows.

Final checks after these repairs: **1,613 tests passed, 10 opt-in tests skipped**, typecheck, lint and isolated production build passed. The separate local-database checkpoint test also passed. Browser proof confirmed the eight loaded rows, functioning evidence drawer/workspace links and three email conversations; screenshot waiting was adjusted for hydration and combined company/product link text, not product code.

Artifacts are ignored: `tmp/live-app-20261011/` and `tmp/live-app-20261011-r2/`. The latter preserves `audit.json` before recovery, `audit-recovered.json`, `checkpoint-recovery.json`, network counters, delivery receipts and screenshots. Private configuration and browser state are not committed.

### Still unproven / follow-up

- A NEW uncached search with the final null-use/polymer repairs has not run. The zero-additional-cost recovery must not be presented as fresh live recall. Another charged search needs separate approval.
- Repeated news coverage still spends analysis on the same project before later country pages. Country-aware first-pass prioritisation, project-story dedupe and postponing optional extraction remain efficiency improvements; merely raising token caps is not a demonstrated fix.
- Corporate-group outreach dedupe is not implemented. The current cap is three legal-company opportunities, not three unrelated groups.
- This isolated database has no Google Calendar consent. Reply analysis and meeting booking were not exercised in this rehearsal; do not reuse older meeting proof as proof for this database.
- Cloud deployment remains separate. A working persistent cloud database is needed before the later Render rehearsal; a new API key alone does not resolve database quota exhaustion.
