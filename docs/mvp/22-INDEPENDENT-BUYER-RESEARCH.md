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
