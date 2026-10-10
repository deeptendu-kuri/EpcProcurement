# 20 · Work-based buyer search: any material, any country, only buyers with proof

**Goal.** He types anything he sells, in his own words ("A234 WPB elbows", "Cryogenic globe valves BS 6364",
"HDPE pipe PN16", "B7 stud bolts"), and picks his countries. He gets companies that will buy it soon, each with
the work they are doing, why that work needs his item, and a dated source. Few genuine leads beat many vague ones.

**Why (10 Oct, deployed search "Cryogenic Valves"):** both saved leads were Norwegian contract winners for road,
water and sewage work and for plumbing. The words matched the generic "gate / globe / check valves" catalogue
item, "cryogenic" was dropped, the search looked for anyone installing valves, and every contract winner became a
"Verified buyer" whose only proof was "Winner: Dovre Entreprenør AS".

## 1. The method (the same for every material)

Nobody buys a material for its own sake; they buy it for work.

**Item → the work that uses it → that work happening now in his countries → who buys for it → the sentence that proves it**

| Signal (strongest first) | Example | Who becomes the lead |
|---|---|---|
| Competitor order | "AMPO to supply 600+ cryogenic ball valves for Ruwais LNG" | The project's EPC; the maker is a competitor |
| Award | "Tecnimont wins $4.3bn Ruwais NGL train 5 EPC" | The winner (and its package subcontractors) |
| Tender / prequalification | "Contractors submit prices for Ruwais NGL" | Bidders (later, "Monitoring") |
| Capability | A fabricator's own page: "cryogenic tank piping" | The company (steady demand) |

How the item is bought decides where the search effort goes: **per project** (pipe, valves, fittings,
structural steel, cables) leans on award, competitor-order and follow-up searches; **steady** (gaskets, bolts,
welding consumables, paints) leans on capability, maintenance-contract and tender searches.

Live checks behind these rules (10 Oct): product-name searches return sellers and definitions only; work + award
+ country returns real dated projects (LNG/NGL, water transmission); search engines mix countries and events, so
location is checked after reading; a winner can be a maker (Group Five Pipe), so roles are read per company;
competitor orders are only found when the query names the project, so projects are followed up.

## 2. What stays exactly as it is (proven architecture)

Durable research jobs, budgets and extension rounds, pause / resume / finish, any of 249 countries searched in
parallel with local-language news (Bing market, translated terms, GDELT country news), EU TED and other tender
sources, roundups and directories, the AI rating with its read-time guards (owner ceiling, competitor, reseller,
outside markets, non-buyer kinds, list names without a website), verification levels (website / listing /
rating), quote verification against the saved original, website checks, the supply-chain search, likely-lead
saving, contacts, email automation, the Groq → Cloudflare fallback and the AI allowance. The catalogue stays as
the seed knowledge and the fallback when the AI is unavailable. The 97-company audit stays a regression gate.

The change is only **what we search for** (work, not product words) and **one need check** that every lead must
pass, awards included.

## 3. Changes by stage

| # | Stage | Today | Change | Files |
|---|---|---|---|---|
| 1 | Understand | Words → one of 35 catalogue items; spec reader keeps method, grade, standard, size, finish | **Search brief** (§4): one AI call per new wording, grounded, checked, cached; stored on the run. One line in the search form: "Looking for companies doing: LNG · NGL · air separation" | new `discovery/brief.ts`; `research/store.ts` (run input `brief`); migration 029 `search_briefs` cache; `find-form.tsx` |
| 2 | Plan | Product/activity words; piping-only award queries (fix 6) | Per country, queries from the brief: award ("<use words> contract awarded <country>"), tender, competitor order, capability ("<use> fabricators <country>"); local-language versions through the existing term translation; GDELT words = use words; lanes weighted by `buying` | `sourcing/plan.ts`, `sourcing/local-terms.ts`, `discovery/plan.ts` (budget) |
| 3 | Screen | Action + pipeline/piping scope words | Scope = the brief's use words (hook from fix 6: `scopeFor`); not-buyer words reject; a place word of a chosen country required (city list per country from `country-meta`) | `research/sources.ts`, `pipeline/filter.ts`, `config/country-meta.ts` |
| 4 | Read | Award extraction: winners; "Potential need" from the fixed `needs-map.json` | Extraction also returns project, project country, matched use (or none) and each company's role: owner, EPC, JV partner, subcontractor, seller of the item, other supplier, consultant, financier, with the exact sentence. "Potential need" text = the use's reason from the brief | `pipeline/extract.ts`, `sourcing/triggers.ts`, `opportunities/index.ts` |
| 5 | Follow | Chain search for subcontractors of top contractors | Also for the strongest in-market projects: "<project> subcontract awarded", "<project> <item> supply order" | `research/chain.ts`, `research/engine.ts` |
| 6 | Decide | Rating ≥45 and a buyer role = likely lead; every award winner = verified | **Need check**: a lead needs (a) a buying role, (b) a checked sentence tying it to a brief use or the item, (c) the project in his countries, (d) within 18 months, (e) not a seller. Rating prompt gets the brief (must-haves, uses, not-buyers) and returns the need sentence; read-time guard caps a lead without it below 45. Award winners go through the same rating and guards | `research/shortlist.ts`, `research/likely.ts`, `research/engine.ts` (`shortlistAwardWinners`) |
| 7 | Prove | "Winner: X" | Evidence card: **Their work** (quote) → **Why it needs the item** (use reason) → source and date. "Verified buyer" only with a checked need sentence; otherwise "Won a contract · need not shown" (kept under Companies found, not a lead) | `evidence/index.ts`, `evidence-drawer.tsx`, `research/found.ts` |
| 8 | Leads table | "Also can sell" column | Removed. Last column **Open details** → `/opportunities/<id>` (the evidence panel's "Open workspace" page), back returns to the table; "Save as buyer first" when there is no saved opportunity | `search/results-table.tsx` (+ test) |
| 9 | Measure | 97-company pipe audit | Six-material test set (§6) with must-find and must-not lists; offline replay from saved pages plus a live run per material | `research/eval/` |

All new behaviour sits behind `MVP_WORK_SEARCH` (default on after the tests pass) so old and new can be compared
on the same search.

## 4. The search brief

Same fields for every material:

| Field | Meaning |
|---|---|
| `item` | Short name of what is sold |
| `mustHave` | Conditions that restrict where it is used (service temperature, sour service, pressure class, standard) |
| `buying` | `project`, `steady` or `both` |
| `uses[]` | 3–6 kinds of work that need exactly this item, biggest first: name, headline words (English + local language), one-line reason |
| `buyerRoles` | Who procures it for that work |
| `notBuyers` | Work and companies that look related but do not need this exact item |
| `owners` | Main project owners in his countries (for follow-up and competitor-order queries) |

Checks before a brief is used (from the proof run, §7):

1. **Grounded in the market.** One Tavily search per country ("<item> project <country>") is given to the AI,
   so the uses rank what is actually being built there, not what is typical worldwide.
2. **Catalogue knowledge merged.** The nearest catalogue item's standards, activities and buyers are given as
   seed facts; the brief may add, never silently drop, the seed's main uses.
3. **Seller words are fixed, not generated.** Makers and traders are recognised by trade words (manufacturer,
   mill, trading, stockist, distributor, supplier of …) and the brief's own item words are never seller words.
4. **Shape limits.** 3–6 uses, each with at least one headline word; must-haves must appear in the typed words or
   be standard for them; failing checks → catalogue fallback.
5. **Cached and editable.** Stored per normalised wording; shown as one line; later the POC can correct it.

## 5. Countries

Every stage runs per country as today: queries carry the country name; Tavily `country` boost for general
searches; Bing in the country's market and language with translated use words; GDELT country news with the use
words; location re-checked from the article after reading (project country must be one of his countries).

## 6. Test set

| Material | How it is bought | Must find (examples) | Must not save |
|---|---|---|---|
| Cryogenic valves | Project | Tecnimont, Wison, TJN Ruwais (Technip Energies, JGC, NMDC Energy), CB&I, Técnicas Reunidas | Dovre, Bravida, AMPO, valve traders |
| A234 WPB elbows | Project | Audit A-grade contractors and fabricators | Audit D-grade |
| A106 Gr.B pipe | Project | Audit A-grade | Audit D-grade |
| HDPE pipe | Project | Water transmission and network contractors | Pipe mills, traders |
| Cable trays | Project | Electrical and MEP contractors on plants, substations, data centres | Tray makers |
| Gaskets / stud bolts | Steady | Maintenance contractors, fabricators | Fastener traders |

Target per material: real buyers ≥70% of saved leads, non-buyers ≤10%, every lead with a checked need sentence.
The 97-company audit must not get worse.

## 7. One proven test (10 Oct)

A throwaway prototype (`tmp/proof-brief.mts`, not app code) ran stages 1–8 for **"Cryogenic Valves" in UAE and
Saudi Arabia** with the engine's AI providers, its country data and its **unchanged rating guards**
(`consistentRating`, `consistentType`, `LIKELY_MIN`, `leadRoleFor`). No hand-research hints were given.

Cost: 29 AI calls, 47k tokens, 16 Tavily searches. 44 results → 30 screened → 28 read (16 from follow-ups).

| Lead (duplicates merged) | Proof found by the run | Independent grade |
|---|---|---|
| Tecnimont (MAIRE) | $4.3bn EPC, fifth NGL fractionation train, Ruwais (Aug 2026) | A |
| Wison Engineering | $4.04bn EPC, RGD phase 2 gas processing train, Habshan (Aug 2026) | A |
| Technip Energies | Ruwais LNG EPC (TJN Ruwais JV); AMPO supplies 600+ cryogenic ball valves to it | A |
| JGC | TJN Ruwais JV partner, same proof | A |
| NMDC Energy | TJN Ruwais JV partner, same proof | A |
| Técnicas Reunidas | Riyas NGL packages 1 and 2 (Saudi Arabia) | A |
| Global Infrastructure Partners | "holds a 49 per cent stake" in Jafurah midstream | **D** (investor read as a contractor) |

**6 of 7 are real buyers (86%), 1 non-buyer (14%).** The deployed search for the same words saved 2 leads, both
irrelevant (Dovre, Bravida); neither kind of company appears here because water and plumbing work is never
searched. Of the hand-research must-find list, 6 of 7 were found; **CB&I (Ruwais LNG cryogenic tanks) was
missed**, as were the industrial-gas companies (Gulf Cryo, Abdullah Hashim Industrial Gases). AMPO was correctly
marked a competitor. Owners (ADNOC Gas, Aramco) were held back by the existing owner rule; US, Iran and other
off-market projects were rejected by the location check.

What the run showed, now part of the plan:

| Finding | Change |
|---|---|
| Ungrounded brief guessed hydrogen refuelling and helium labs, missed NGL, gave generic standards (IEC 60715) and "cryogenic" as a seller word | Grounding search and fixed trade-word seller list (§4 checks 1 and 3) fixed this in the second run |
| Grounded brief put a size ("3–24 inch") into must-haves | Must-haves: conditions only, never sizes (§4 check 4) |
| A third of the reads were US / Iran news | Screen also requires a place word of a chosen country (stage 3) |
| An investor holding a stake was read as a contractor | Need check rejects stake / investment / acquisition sentences (existing non-buyer kinds, applied to the quote) |
| Same company under three names (Tecnimont, Tecnimont SPA, Tecnimont (MAIRE Group)) | The engine's existing `sameCompany` merge already handles this |
| Saudi project tagged UAE (prototype shortcut) | Country per company comes from the article read (stage 4) |
| Many sources undated | Date from the article text when the search gives none (stage 4) |
| Tank builder and industrial-gas companies missed | Follow-up searches also cover the project's packages ("<project> tanks / package contract"); `both`-bought items also run the capability lane |

## 7b. Rules learned from 13 proof runs (10 Oct, rounds 1–5)

Materials: cryogenic valves (project-bought, oil & gas), HDPE pipe (water sector), stud bolts and spiral wound
gaskets (steadily bought for maintenance); countries UAE, Saudi Arabia, India, Norway. Every rule is general
(no material- or country-specific code) and is part of the build.

| # | Found in | Rule |
|---|---|---|
| 1 | HDPE (23% real buyers) | Need verdict per piece of work: would this work buy the item as a real package? yes / no / unclear. Only "yes" makes leads and follow-ups |
| 2 | HDPE | An owner's name alone does not pass the screen (it pulls in the owner's unrelated mega-projects); use words do |
| 3 | HDPE | The work's date comes from the sentence ("In 2005, …", or when it got the work), not the article's date |
| 4 | HDPE | Developers, sponsors and shareholders of a concession (IWP, IPP) are owners, not contractors |
| 5 | Cryogenic (no Saudi lead) | Follow-ups take the top projects of every country, not the first ones overall |
| 6 | Stud bolts | A use's search words are the work, never the item's own words |
| 7 | Stud bolts | Steady-bought items also search the owners' plants: "<owner> maintenance services contract awarded", "shutdown turnaround contract <country>" |
| 8 | Cryogenic (Tecnimont rejected) | The need verdict judges from what the work is (news never names valves); "no" only when the work is not a use or a different material does that job (GRE, steel) |
| 9 | All | Quotes are checked with the engine's `verifyQuote` (97% match, company name in the quote) |
| 10 | Stud bolts | The reading budget is shared across search lanes and countries, so maintenance pages are read too |
| 11 | Stud bolts (1 lead) | A use is a kind of plant, project or service contract, never a part or assembly; the catalogue's `needs-map` and activities are given as seed facts |
| 12 | Norway (0 leads) | Uses are ranked per country, with headline words in the country's own language; place words per country (own-language name, industrial cities) |
| 13 | Stud bolts (Eni, TotalEnergies as "contractors") | Equity partners that co-own or co-develop a field or plant are owners, never joint-venture contractors (reader role definitions; a word list was tried and rejected by offline replay) |
| 14 | Stud bolts (Technip, engineering only) | An engineering-only package (detailed engineering, FEED, design) buys no material; judged on the company's own package, not the sentence |
| — | All | linkedin.com is added to Tavily's excluded sites (no LinkedIn scraping); the reading step already skips social sites |

Last measured precision per material (round 4/5, graded against hand research): cryogenic valves 5/5 real
buyers; HDPE pipe UAE/KSA 5/7 (one non-buyer); HDPE India 3/3; stud bolts 5 real of 9 before rules 13–14
(with them, 5 of 6). Non-buyers stayed at or below about 15%, mostly 0.

## 7c. Monitoring: new work adds new leads

Saved searches already refresh every 6, 12 or 24 hours (scheduler every 5 minutes) and on "Refresh now".
The build makes refreshes run the work-based search with the saved brief, adds only new companies (a known
company's lead gets the new proof and date), marks "New since last check", and can email the POC. Render's free
plan sleeps after 15 minutes idle, so a Render cron job (or an uptime ping) calls the refresh on schedule.

## 7d. Testing without slow live runs

The pages and AI answers from the proof runs become saved fixtures; the decision rules (need check, roles,
dates, places, guards) are replayed against them in seconds on every change, at no cost. Live runs happen after
deploy, behind `MVP_WORK_SEARCH`, with the old search as fallback. With a paid Groq key, reads run about ten at a
time, so a live check takes minutes, not half an hour.

## 8. Effort

| Step | Days |
|---|---|
| Leads table | 0.5 |
| Brief with grounding, checks, cache, form line | 1.5 |
| Plan per country from the brief | 1 |
| Screen, place words per country, location check | 1 |
| Read: roles, project country, use, quote; need text from the brief | 1 |
| Follow-up searches per project | 1 |
| Need check in rating, guards, award path | 1 |
| Evidence card and labels | 0.5 |
| Six-material test set (hand research for three new materials) and replay | 1.5 |
| Live runs, fixes, full checks, report | 1 |
| Monitoring: saved-search refresh with the brief, new-only, "New since last check" | 1 |
| Saved-page fixtures from the proof runs, offline replay tests | 0.5 |
| **Total** | **≈ 12 working days** |

Milestones: day 3, brief + plan + screen live behind the flag, cryogenic re-run in the app; day 6, read +
follow-up + need check, cryogenic and A234 pass their test sets; day 10, all six materials and the 97-company
audit pass, live runs reviewed, ready for your approval to push.

## 9. Cost per month (≈90 searches)

Groq Developer (no daily cap) ~$10; Tavily Project plus top-up for follow-up searches ~$45; optional Claude
Haiku for the brief and need check ~$10. **≈ $55–70.**
