# Reliable engineering material discovery plan

7 October local automatic-workflow update: start with [09 Current local demo guide](09-local-automatic-demo.md). New source-backed companies from settled/partial searches can qualify and enroll automatically; supported searched wording is preserved, account setup lives in Settings, and meeting scheduling/recovery is integrated. The earlier full run passed 826 tests. One fresh real search saved one company and its introduction was accepted by Resend for the approved inbox. Genuine Gmail replies exposed wrapped-header and copied-slot parser bugs, now fixed with **110 focused automation/API tests passing** and a successful production build. Calendar consent is complete. The user's actual copied Slot 1 selection was recovered once; the normal worker created a **real Google Calendar event and Meet link for 8 October, 10:00–10:30 Asia/Kolkata**, and Resend accepted the confirmation for Hritik's approved Gmail. The app shows `meeting_booked`; follow-ups stop and the CRM summary contains the link. Final confirmation inbox delivery awaits user verification. Real buyer delivery remains disabled. The dated notes below remain history, not current instructions to manually start every lead.

6 October demo integration update: the approved-inbox research-to-conversation controls are integrated locally. The email worker is available in `--demo` mode; the app-level switch remains off until user enablement. Existing conversations stay paused. Calendar consent and the user's live inbox/meeting acceptance remain outstanding. Start with [08 Local UI test guide](08-demo-ui-test.md). Earlier discovery-first status notes below describe that earlier test phase, not the current worker launch mode.

This documentation package translates the seller's requirement into an implementation and release plan. It is for the product owner, engineering team and client demonstrator. The recommendation is to repair company discovery and evidence handling first, then add scalable research execution and safe outreach. More subscriptions alone will not repair the current false negatives.

Status: original proposal followed by local implementation and supervised live acceptance, 5–6 October 2026. Read the dated implementation updates and document07 for measured behavior; the proposal sections are not proof that every planned capability shipped. Documentation itself does not authorize migrations, deployment or messages.

6 October implementation: material-specific query ordering, provider country boosts, source/domain reading priority, fair-share recovery of saved URLs, short literal company-name identity support, retention of accepted AI JSON before validation, and deterministic first-party consuming-work extraction are implemented locally. The deterministic path uses the same individual-source evidence gates and records `rule:company-application`, not a fictitious AI extraction. Live outcomes and remaining gates are recorded in document07; outreach remains disabled during discovery testing.

Latest direction: discovery first, contacts independently, outreach paused. Following the one-company cables test, the user requested broader company/project/subcontractor coverage rather than more email tests. Local automation is disabled and all three existing nonterminal demo conversations are paused, with history preserved. No fresh app search, email, cloud change or engine implementation was performed in this follow-up audit. See the discovery-first revision in document02 and its work order in document06.

## Accepted decision and next phases

The user approved the discovery-first direction on 5 October 2026. The accepted design is recorded as [DISCOVERY-001](02-discovery-engine.md#accepted-decision-discovery-001); the next implementation order and phase gates are in the [phase plan](06-execution-tests-and-prompts.md#approved-next-phase-plan). This approval records the direction, not proof that the new engine already works or permission for unlimited API usage, buyer emails or cloud changes. This documentation turn makes no application changes.

Keep the existing application, database, durable research jobs and detailed lead workspace. Use existing Tavily/Groq first. Add permitted directory/PDF ingestion and per-company source investigation; test Crawl4AI as an optional reader behind the existing interface. Adopt it only if measured extraction gains and resource/safety checks justify it. Do not install competing crawler stacks or rebuild proven email adapters without a demonstrated need.

Execution order: baseline and budgets -> reader/PDF proof -> source coverage -> company evidence and relationships -> live discovery/CRM acceptance -> contacts -> approved-inbox outreach/meeting proof -> cloud readiness. The first useful milestone is a measured multi-company material search with all emails off. Directory candidates, eligible companies, supported projects, active-work evidence and validated contacts are separate counts. A 50-100-company claim requires an actual bounded deep run, not a target setting.

Current evidence supports confidence that richer sources can produce additional real potential companies. It does not establish a numerical accuracy rate, confirmed purchasing, personal-email yield or client-ready availability. Until the phase gates pass, those outcomes remain unproved.

## The requirement in plain language

An engineering procurement seller can source construction and industrial materials, including pipes, steel, wiring and electrical equipment. Instead of visiting hundreds of websites, the seller wants to search a material and geography and receive real potential buying companies, associated projects when supported, and available business contacts. Unknown details stay blank. Relevant current work should receive priority. Results must remain traceable to original sources and the user's exact search.

The desired deep-research target is 50 to 100 distinct potential buying companies where market coverage and the research budget permit. This is not a minimum output count. One hundred pages, companies, people and validated emails are four different quantities. Neither a 100-company yield nor 20 to 30 validated personal emails is currently measured or guaranteed.

Demo outreach is explicitly routed only to `hritikdebnath00@gmail.com`. The demo inbox is transport configuration, never a substitute stored as a buyer's contact. Real-buyer delivery remains disabled. Follow-ups must be bounded and stop on rejection or opt-out; a meeting objective does not authorize indefinite emailing.

## Read the documents in this order

| Document | Decision it supports |
| --- | --- |
| [01 Requirements and evidence criteria](01-requirements-and-evidence.md) | What is a legitimate prospect and what may remain unknown |
| [02 Discovery engine architecture](02-discovery-engine.md) | How to find companies across materials and recover interrupted research |
| [03 Scoring and CRM experience](03-scoring-and-crm.md) | What ranking means and how the user sees leads and contacts |
| [04 Outreach and meeting automation](04-outreach-and-meetings.md) | When automation may act and how replies and meetings are proved |
| [05 Cloud deployment and provider budgets](05-cloud-and-budgets.md) | What free tiers can support and what Vercel requires |
| [06 Execution tests and improved prompts](06-execution-tests-and-prompts.md) | The implementation sequence, measurable release gates and prompt contracts |
| [07 Runtime implementation and live evidence](07-runtime-implementation.md) | What shipped locally, what was actually tested and remaining cloud blockers |

## Implementation update — 5 October 2026

The reliability implementation is now on `feature/guided-prospect-workflow`; it has not been pushed or deployed. See [runtime implementation and cloud gates](07-runtime-implementation.md) for shipped versus pending execution behavior. The audit below describes the pre-change baseline, not the current implementation.

Implemented: all 35 material activity mappings, country-fair query planning, optional unknown geography/project fields, company-attributed original evidence, activity/priority metadata, durable local stages, contact visibility independent of email, active-first CRM groups and partial-search resume. The existing approved-inbox funnel retains actual provider acceptance, reply analysis and Calendar adapters; new protections share one 10-attempt daily cap and stop no-reply follow-ups after two.

Desktop/mobile UI proof uses isolated fictional fixtures. Offline source replay recovers one previously extracted KPIL buyer from a 27-page capture; it does not prove 50–100 new buyers. Fresh multi-material discovery, live inbox replies and a real Calendar event are the next joint acceptance test. Vercel background execution remains guarded pending cloud proof.

## Ground reality from the audited code (pre-change baseline)

The last recorded live line-pipe search in India and UAE read 46 pages, identified 30 candidate pages, analysed 15, deferred 15 and saved zero prospects. It sent zero introductions. Evidence is in the ignored local artifact `tmp/engineering-material-audit-20261005/proof.json`; the associated run ID is `0ff957a4-e7de-45b7-873a-91724b14d645`. This is one observed run, not a general market estimate.

Important code findings:

- `src/mvp/discovery/index.ts` demands exact company identity inside its quote; `evidence.ts` requires product evidence to name that company or sit inside the identity quote. Multi-paragraph official websites can fail these checks.
- An unsupported optional project can reject a supported company. We should discard that project field instead.
- The catalogue has 35 items, including cables, rebar and pumps; `discovery/plan.ts` has consuming-activity mappings for only eight pipe categories.
- Tavily currently runs three targeted queries by default, eight URLs each. Query slicing favors the first country. `pipeline/index.ts` caps total documents at 60; the observed local fresh-AI-page cap was 12. These settings are not a credible guarantee of 100 companies.
- The live product-scoped path uses `analyseBuyerPages` and direct `saveBuyer`, bypassing legacy lead scoring. Its `fit_score` is rounded model confidence, not a calibrated buyer score. The legacy opportunity-capture path still requires awards; it is a policy consistency issue, not the cause of this live run's zero.
- Search does not automatically populate published contacts through the existing separate enrichment flow. Current activity dates are not modeled in discovery.
- Outreach persists threads and messages, but search waiting jobs are memory-only. `runtime.ts` deliberately blocks Vercel until durable execution is integrated.

Some earlier documents describe superseded behavior. This package does not silently overwrite them. Implementers must reconcile them after the approved changes ship.

## Research evidence and its limits

Public-source research established plausible consuming companies for several materials:

| Search | Example | What the source supports |
| --- | --- | --- |
| Line pipe | [CIEL Contracting](https://cielcontracting.com/pipeline-plant-works/) | Pipeline EPC services and published company contacts |
| HDPE pipe | [Silver Screen Contracting](https://silverscreenuae.com/) | HDPE installation, company phones and named leadership |
| Stainless steel pipe | [NM Technical Solution](https://www.nmts.in/erection-services/) | Stainless piping fabrication and erection plus published contacts |
| Structural steel | [Hematite Steel Contracting](https://hematitesteel.com/) | Structural fabrication and installation plus a company phone |
| Cables | [Alamagroups](https://www.alamagroups.com/Services.html) | Cable installation and electrical contracting services |

Material purchasing is an inference from supported work, not a confirmed order. These sites do not by themselves establish current procurement, independent legal-entity verification, or email deliverability. They are benchmark candidates, not hardcoded production results. Current project activity requires separate dated evidence.

## Accepted direction for the next revision

1. Keep grounded potential companies even without project names or contacts; leave optional values null and show blanks.
2. Separate product fit, current activity, contact coverage and outreach eligibility. Never use one score as all four.
3. Use bounded, resumable research batches with a visible target, budget and partial state.
4. Begin with public permitted sources and existing Tavily/Groq; buy contact enrichment only after measuring discovery quality.
5. Keep automation off throughout discovery evaluation; later outreach retains the approved single-inbox restriction and sending caps.
6. Implement and prove durable jobs before enabling Vercel research or automation. Choose a hosting plan permitted for client/business use.

## Completion standard

Success is a user performing a fresh search, seeing source-backed companies for that material, opening real available contacts, understanding missing data, and observing an accurately recorded single-inbox conversation through a real calendar event. Passing mocked tests, generating a large spreadsheet or receiving one email does not establish that end-to-end outcome.
