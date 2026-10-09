# 19 · Any material, any country: the right buyers, searched in parallel with local news

**Goal.** He types any material ("Welded Stainless Steel Pipes", "steel plates") and picks one or more countries. He gets companies that will actually buy that material: end users, main contractors and the subcontractors below them, and (if he sells wholesale) stockists who resell to contractors. Every country is searched in parallel, including its local news in its own language. Each step is measured, so paid APIs later add more relevant leads rather than more noise.

Decisions taken (defaults from the 10 Oct discussion):

- **Resellers:** counted as buyers, ranked below end users and contractors, with a per-search toggle.
- **Variant words:** used for ranking, not as a hard filter.
- **Subcontractors found under a contractor:** related companies until their own website verifies them.

## 1. Where we are (code facts, 10 Oct)

| Area | Today | Gap |
|---|---|---|
| Material | Words map to one catalogue item; the search uses the catalogue name. | "Welded", "316L", "A312" are ignored for searching and judging. |
| Buyer types | End users and contractors kept. Stockists rejected as "sales-only"; the shortlist rates them 0–5. | Resellers lost; no buyer-type labels. |
| Countries | Any of 249 can be picked. Query text, the Bing market and place-name checks are built for 9. | Weak outside the 9; English only. |
| Local news | GDELT and RSS exist but are off. GDELT is English-only, with the country named in the query. | No local-language or local-outlet news. |
| Parallel | One worker step at a time, so 5 countries run one after another. | Slow; the first country takes the budget. |
| Chain | Tier 2/3 come from a static example map plus 7 directory rows. | Nothing searches for a contractor's subcontractors. |
| Measurement | No labelled set; `docs/mvp/11` specified one but it was never built. | Changes cannot be shown to help. |

## 2. Methods used, with sources

| Need | Method | Source |
|---|---|---|
| Local news in any language | GDELT DOC 2.0: free, 65 machine-translated languages searchable with English keywords, `sourcecountry:` and `sourcelang:` operators, 3-month window, `maxrecords` ≤ 250, about 1 request per 5 s | [GDELT DOC 2.0 API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) |
| Country editions of news | Google News RSS search per edition: `news.google.com/rss/search?q=…&hl=<lang>-<CC>&gl=<CC>&ceid=<CC>:<lang>`, with all three kept consistent | [NewsCatcher: Google News RSS parameters](https://newscatcherapi.com/blog/google-news-rss-search-parameters-the-missing-documentaiton) |
| Country-aware web search (paid, already used) | Tavily `country` (boost, 150+ countries, general topic), `language` plus `filter_by_language`, `include_domains`, `time_range`; basic = 1 credit | [Tavily search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) |
| Tenders and awards per country | Open Contracting Data Standard (OCDS): 100+ publishers with APIs or bulk JSON (e.g. UK Find a Tender, AusTender); EU TED is already integrated | [OCP Data Registry](https://data.open-contracting.org/) |
| Supplier/buyer links from text | Zero-shot AI extraction of companies and their relations from news, building a supply-chain graph beyond tier 1 | [arXiv 2410.13051](https://arxiv.org/abs/2410.13051), [arXiv 2408.07705](https://arxiv.org/abs/2408.07705) |
| Qualify by fit with reasons | Judge each company against a profile of the ideal buyer, giving a score and the reason (the pattern used by open-source lead finders) | [OpenOutFind](https://pypi.org/project/openoutfind/) |

## 3. The plan

### Phase 0: measure first
- **Golden set.** About 200 companies from our real runs (steel plates, steel pipe, welded stainless), each labelled: end user, contractor, subcontractor, reseller, competitor, owner or not a buyer. Stored as a fixture.
- **`scoreShortlist`.** Precision of the top 20, junk among likely buyers, reseller/competitor confusion and buyer-type accuracy.
- **Pass mark:** top-20 precision ≥ 80%, junk ≤ 5%.
- **Cost.** Runs offline on stored ratings for free, or re-rates the frozen inputs with AI (about 25k tokens) when the prompt changes.

### Phase 1: the material, precisely
- **`parseMaterialSpec(words)`** reads the manufacturing method (welded/ERW/EFW/LSAW/SAW/seamless), grades (304/304L/316/316L/321/2205/2507, X42–X80, A106 B…), standards (ASTM A312/A358/A778/A790, API 5L/5CT, EN 10216/10217, IS…), sizes (NPS/inch/mm/schedule) and uses.
- **Stored with the search** and used in:
  - the queries (variant terms, plus the uses that need that variant);
  - the rating prompt;
  - the "Will buy" label and the email.
- **Match strength** per company: *names the variant* > *uses the product* > *its work needs it*. This ranks; it never filters, except for clear contradictions ("seamless only").

### Phase 2: buyer types
- **Rating v2** returns a `buyerType`: end user, main contractor, subcontractor, owner, reseller, competitor or not a buyer, plus the match strength (migration 025).
- **Per-search toggle** "Also sell to stockists and traders" (default on). When on, a stockist that supplies contractors is a reseller buyer; when off, it is a competitor.
- **Discovery** accepts reseller evidence ("stockist and supplier of … to contractors") when the toggle is on.
- **Leads and the workspace** get buyer-type filters and tabs.

### Phase 3: any country, local news
- **Country details for every ISO country:** main language(s), Google News edition, GDELT country name, Tavily country name and Bing market, with fallbacks.
- **Local-language terms:** the material and its uses are translated once per language by AI and cached. Queries go out in English and the local language.
- **New free sources, run per country:**
  - GDELT with `sourcecountry:` (local outlets in any language, searched in English);
  - Google News RSS for that country's edition and language.
- **Tavily** gets `country` for every supported country (not 12), and `language` for local-language queries.
- **Place-name check:** any country is recognised by its name, its local name and its capital and big cities, using country details instead of a 9-country table.

### Phase 4: parallel search
- **Several steps at once.** The worker runs up to N steps together (default 4): searches and page reads in parallel, AI steps limited to 1–2 at a time (Groq allows about 8k tokens per minute).
- **Fair across countries.** The next step is taken from the country with the fewest steps in flight, so every country progresses together and none takes the whole budget.
- **Per-country progress** in the workspace: companies found, likely and verified for each country.

### Phase 5: follow contractors down their chain
- **For the top 5 rated main contractors and owners,** targeted searches: "<company> piping subcontractor", "<company> awarded subcontract <work>", "<company> approved vendor list".
- **Companies found** are recorded as "found via <contractor>" and rated, and appear as subcontractors under it.

### Phase 6: proof
- **Golden-set scores** before and after each phase, recorded here.
- **Live runs** with ratings checked by hand:
  - one core country (UAE) and two others (Germany, in German; Kenya, in English) for one material;
  - "Welded Stainless Steel Pipes" across three countries.
- Live AI runs are limited by the free Groq daily allowance (about 200k tokens per model, resetting at 00:00 UTC), so most testing reuses stored inputs.

## 4. What paid APIs add later

Each slots into the same steps, and is measured by the same golden set:

- **More web searches and page reads (Tavily plan):** more companies verified per search.
- **Paid AI:** no daily cap, so deep mode on every search.
- **Trade (shipment) data:** who actually imports the material, the strongest reseller and big-buyer signal.
- **Company databases:** websites, size and country without spending searches.
- **OCDS tender feeds per country:** awarded contracts as triggers.

## 5. Results

### Baseline: the rater before this work, on the golden set

| Search | Top-20 precision | Junk among "likely" | Recall |
|---|---|---|---|
| Steel plates | 0.90 | 13% | 90% |
| Steel pipe | 0.70 | 48% (projects rated as companies) | 88% |
| Welded stainless | 0: only pipe makers were found | — | — |
| **Overall** | **0.53** | **30%** | **89%** |

Welded stainless shows the gap is mostly *where* we search, not only the rating.

### Built and tested (commits 75306ee, f2f6c9b)

| Phase | What | Proof |
|---|---|---|
| 0 | Golden set: 184 companies, 19 marked unclear; scorer | `src/mvp/research/eval/*` |
| 1 | `parseMaterialSpec`: method, grade, standard, size, finish; typical uses of the variant | 12 phrase tests |
| 2 | Rating v2 (buyer type, variant match); reseller toggle; verification accepts stockists that supply the material | shortlist, reseller and form tests |
| 3 | Country details for 247 countries; local-language terms (cached); local news (Bing, in its language); GDELT country news; Tavily country boost for 150+ countries | Live check (`LIVE_NEWS=1`), below |
| 4 | Up to 4 steps per search at once, AI one at a time; budgets grow per country; countries alternate | Claim test |
| 5 | Top contractors and owners followed down their chain ("works under") | Chain tests |
| 6 | Variant chips and stockist toggle on Find buyers; workspace buyer-type filter, badges and per-country strip | Component tests, screenshots |

**Live local-news check, 10 Oct:**

- **Saudi Arabia (Arabic, `ar-SA`):**
  - "East Pipes signs a steel pipe supply contract with the Saline Water Conversion Corporation, SAR 497m" (argaam.com)
  - "Arabian Pipes signs a contract with Aramco to supply pipes, SAR 96m" (mubasher.info)
  - "Contract awarded to build a pipeline in Jazan, SAR 50.98m" (argaam.com)

  None of these appears in English-only searching.
- **Germany (German):** contract news found.
- **GDELT:** reachable but often rate-limited; when busy, the search carries on without it.
