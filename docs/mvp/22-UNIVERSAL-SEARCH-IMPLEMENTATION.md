# 22 · Universal search: implementation plan

Status: plan for branch `feat/universal-search` (from `main` at 5df6b51). Companion research: [21-UNIVERSAL-SEARCH-SOURCES.md](21-UNIVERSAL-SEARCH-SOURCES.md).

## 1. The problem

The client types any product he wants to sell (pressure vessels, separators, API 660 heat exchangers, centrifugal and axial fans, blowers, pipes, valves…) and expects **open tenders and buyers for exactly that product**, with proof. What he sells or owns does not limit the search.

Today every search is tied to one of 35 example catalogue types (`src/mvp/config/catalogue.json`):

| Where | What happens today for "pressure vessel" |
|---|---|
| Search form (`find-form.tsx`) | "This material is not in your product list yet. Choose the closest type", then a dropdown of 35 types. "Pressure vessel" silently matches **steel plates** (via the market term "pressure vessel plate"), so the search runs for plate buyers. |
| API (`_shared/schemas.ts:8`) | Rejects any product that is not a catalogue id. |
| Queue (`_shared/queue.ts`) and run creation (`research/store.ts:44-45`) | Without a catalogue id the run leaves the durable engine. A typed phrase outside the vocabulary is refused. |
| Source planning (`sourcing/plan.ts:41`) | Throws "Unknown sourcing product." |
| Company analysis (`discovery/bundle.ts:37`, `discovery/index.ts:125,144`) | `getCatalogueItem(id)!`, so a TypeError. |
| Lead saving (`research/likely.ts:48`) | Returns 0 without a catalogue item. |
| Award step (`opportunities/index.ts:48`) | Throws "Search product is not in the catalogue." |
| Email qualification (`automation/ai.ts`) | Needs catalogue evidence, so no email is ever approved. |
| Reading order (`discovery/plan.ts:165`) | **Tender URLs are penalised (−20)**: tenders are treated as noise, not demand. |
| Need check (`research/need.ts`) | No role for an organisation that buys the item through a tender. Owners are "secondary", so a tender issuer can never be a lead. |

The intelligence layer (AI search brief, need check, project follow-ups, rating, email writing) is already free-text capable. The work is the plumbing around a fixed product list, plus a **tender lane** and a **direct-buyer role**.

## 2. Target behaviour

1. He types anything ("API 660 shell and tube heat exchanger", "twin lobe blower", "axial fans"), picks countries, and presses Search. **No product types, no chips, no dropdown.**
2. The first step writes a **search brief** for that exact item:
   - what it is (kind: material, static equipment, rotating equipment, electrical, consumable, service);
   - other names used in tenders;
   - tender wording;
   - the kinds of work that consume it in each country;
   - who buys it directly (utilities, operators, plants);
   - who buys it through projects (EPC, packagers, building-services contractors);
   - who only *looks* like a buyer (makers, stockists = competitors);
   - the item's name in each country's own language.
3. Searches run in three lanes, per country, highest precision first:
   - **Tenders**: open tenders, RFQs and purchase orders that name the item. The issuer is a **direct buyer**, labelled *proven demand*.
   - **Work**: contract awards and current projects for work that consumes the item. The contractor holding the package is a buyer, labelled *active work*.
   - **Companies**: companies whose regular work consumes it, labelled *capable*.
4. Every lead keeps the existing quality rule: named company, named work or tender, dated, quote found on the page, buyer role, in a chosen country. Makers and sellers of the same item are competitors, never leads.
5. Known catalogue products (e.g. "ASTM A312 TP316L pipe") keep their extra pipe knowledge, but **only when every meaningful word typed belongs to that product**. Otherwise the typed item is used as typed.

## 3. Design

### 3.1 Search item identity (foundation)
New `src/mvp/discovery/item.ts`:
- `searchItemId(text)` gives `q:<slug>` (lower-case, accents removed, letters, digits and spaces only, at most 80 characters, spaces become `-`). For example, "API 660 Heat Exchangers" becomes `q:api-660-heat-exchangers`.
- `isSearchItemId(id)`, `searchItemName(id)` (decodes the slug).
- `searchItemFromId(id)` returns a `CatalogueItem`-shaped object: `category: 'Searched item'`, `name`/`shortName` = the decoded words, `standards` parsed from the words (ASTM, API, ASME, EN, ISO, IEC, BS, DIN), `keywords` = item phrases (singular and plural, the phrase without its standard) plus terms registered from the brief.
- `registerSearchItemTerms(id, terms)` is an in-memory map, filled from `input.brief.synonyms` whenever a job loads its run. It is deterministic per process, and every job loads the run first.
- `getCatalogueItem(id)` (`config/buyers-config.ts`) returns `searchItemFromId(id)` for `q:` ids. All about 20 read-only call sites then work unchanged: bundle, discovery, likely, found, shortlist, workspace, dashboard, registry, labels.
- `resolveSearchItem(query)` (in `discovery/material-catalogue.ts`) works as follows:
  - **Catalogue id** only if the matcher is exact, or a standard match (score ≥ 90), or strong **and** every significant typed word is in that product's vocabulary.
  - **Otherwise `searchItemId(query)`.**
  - So "pressure vessel" is not plates, and "ball valve actuator" is not ball valves.

### 3.2 Evidence that a page names the item
`materialEvidenceKind(text, productId)` (`discovery/plan.ts`) for `q:` items:
- **explicit**: a section contains a multi-word item phrase or registered synonym (word boundaries; plural and singular; hyphen and space).
- **Single-word items** ("blowers", "separators") count only with industrial context in the same section (plant, project, tender, supply, process, industrial, ventilation, wastewater…). Ambiguous words (vessel = ship, fan = supporter, whistle-blower) never count alone.
- There is no "application" class for typed items. Work-based evidence comes from the brief (`namesWork`) and the need check, as today.

`materialOutputOnly` (maker or seller of the item) works unchanged, because it uses `materialEvidenceKind`.

### 3.3 Run input and API
- `schemas.ts`: `productId` is optional and must be a catalogue id **or** a valid `q:` id.
- `queue.ts`: if `productId` is missing, set it from `resolveSearchItem(query)`. The `resolveMaterial` gate is removed (it existed only to force a catalogue type), so every live search goes to the durable engine.
- `research/store.ts` `createResearchRun`: no material gate. `productId` is required (always set by the queue).
- `pipeline/index.ts` (legacy in-process path): skip the material gate for `q:` items.
- Saved searches: unchanged schema. A saved search with no product resolves at run time.

### 3.4 Search brief v3 (`discovery/brief.ts`, `BRIEF_VERSION = 3`)
New fields, all validated and length-bounded. Old briefs default to empty arrays.

| Field | Meaning | Guard |
|---|---|---|
| `kind` | material / static_equipment / rotating_equipment / electrical / consumable / service / other | enum, default other |
| `synonyms` | other names used in tenders and specifications ("shell and tube heat exchanger", "TEMA exchanger") | ≥ 2 words or a standard code; generic single words dropped |
| `tenderWords` | how tender titles phrase it ("supply of pressure vessels", "procurement of centrifugal fans") | ≤ 6 |
| `directBuyers` | organisation types that tender for it themselves (water utilities, refinery operators, metro authorities) | ≤ 6 |
| `makers` | who makes or sells it (fabricators, OEMs, stockists) = competitors | ≤ 6 |
| `localItem` | the item's name in each non-English country's language (e.g. Arabic for SA and AE) | per market, ≤ 3 |

The prompt becomes universal ("industrial products and equipment"), explains the kinds, and states that equipment is bought early (FEED, tender, right after EPC award) by EPCs, packagers and operators. The catalogue fallback fills `synonyms` from catalogue keywords and `tenderWords` = `supply of <item>`.

If the AI brief fails for a typed item, the run still searches the **tender lane and direct item mentions** and says so in its progress line ("Couldn't describe the work for X; searching tenders and direct mentions only"). It never searches an unrelated catalogue product.

### 3.5 Source plan (`sourcing/plan.ts`)
- No throw: the product comes from `getCatalogueItem` (a typed item included).
- **Tender lane** (lane `trigger`, task ids `…:tender:…`, highest Tavily priority so every country's tender search runs first). Per country:
  1. Tavily general: `"<item>" tender <country>`, restricted to that country's tender portals and aggregators (`TENDER_DOMAINS`, from doc 21).
  2. Tavily general: `<tenderWords[0]> tender <country>` with no domain filter (catches PSU or owner pages and global aggregators).
  3. Bing News RSS (free): `"<item>" tender <country>`.
  4. Local language (Gulf): local-news with `<localItem> مناقصة` (no translation call).
  5. Order news (free): `"<item>" order <country>`. A supplier's order names the buyer.
- The existing work lanes (awards, owners' maintenance, contractor lists, capability) stay.
- **Own allowance.**
  - Tender searches use a separate budget kind, `tender_search` (`TENDER_SEARCHES_PER_COUNTRY = 2`), like the brief's grounding and the project follow-ups.
  - So tenders never crowd out award, contractor-list and company searches. They run first (priority 1290).
  - The shared `researchBudget` is unchanged.
- **Brief-based search only** (production, `MVP_WORK_SEARCH=on`). The legacy catalogue plan is unchanged.
- **Tavily settings.** Tender searches ask Tavily for the **page text it read** (`include_raw_content`, ≤ 15,000 characters per page) and for the **last year** only (`time_range: year`). Tender portals often refuse our reader (doc 21 §D3).

### 3.6 Reading and routing
- `discovery/plan.ts` `tenderForItem(text, productId)`:
  - true when the page has tender, RFQ, bid, NIT or purchase-notice wording (English or Arabic: مناقصة, منافسة) **and** names the item (`sourcing/tender-sources.ts` `TENDER_WORDING`);
  - `classify.ts` is unchanged, because this check decides.
- `discovery/plan.ts` `buyerResearchPriority`: a tender page that names the item gets +18 (it was −20). Tender pages that don't name it keep −20.
- `research/engine.ts` read step:
  - `candidate = buyerPageCandidate || workPage || tenderPage`;
  - a tender page goes straight to the need check (priority 1350), even when the brief describes no work.
- A tender page naming the item skips the article triage, so it is never dropped as "no consuming work".
- **Blocked tender page.** Two conditions must both hold:
  - Tavily gave no page text;
  - our reader is refused.

  Then a tender-lane result whose own search text names the item is kept as that text, labelled in its source name: "search result text: the tender page refuses automated reading; open the link for the full notice". This applies only in the tender lane; any other unreadable page is still dropped.

### 3.7 Need check: direct buyers (`research/need.ts`)
- New role **`direct_buyer`**: the organisation that issues a tender, RFQ or enquiry, or places a purchase order, **to buy the item** (the quote must name the organisation and the item).
- The prompt adds the item's other names and these rules:
  - A tender or RFQ issuer is a `direct_buyer`.
  - A company that won a contract or order **to supply** the item is `seller_of_item`.
  - Makers and fabricators are `seller_of_item`.
- `judgeNeed`: a `direct_buyer` is a **lead** when all of these hold:
  - the quote is verified and names the company;
  - the quote names the item (`materialEvidenceKind` explicit, synonyms included);
  - the tender is in a chosen country. Tender listings rarely repeat the country, so the page's own country stands when no other chosen country appears;
  - `buysItem` is not "no" (a tender for services or spare parts of the item doesn't count);
  - it has a date within **12 months** (`DIRECT_BUY_WINDOW_MONTHS`). Undated tenders are rejected.

  The use match is not required, because the tender itself is the demand.
- `likely.ts`: direct buyers are saved as leads with:
  - `buyer_type = 'owner'`;
  - `material_fit_kind = 'explicit'`, `activity_status = 'recent'`;
  - trigger `kind = 'tender'` with its date;
  - reason "Tender / purchase for <item>: <quote>".

  They skip the work-sentence filter (`supportedWorkProof`), which is for contractors.
- Email qualification (`automation/work-proof.ts`, `automation/ai.ts`): `direct_buyer` checks count as product evidence. The intro email can reference their tender.

### 3.8 Remaining call sites
- `opportunities/index.ts`: product via `getCatalogueItem`. A typed item never throws.
- `chain.ts`: the subcontractor search uses the brief's first use or the item name, never the literal "piping".
- `config/product-label.ts`: a typed item shows the user's words.
- `automation/engine.ts` (`startEmailTest`): accepts typed items.
- `evidence/need-card.ts`: a direct buyer's card says "Buyer: its own tender or order for the item", shows the tender's own reason (not "a potential application of its work"), and lists checks such as "It names the item" and "Dated within the last 12 months".
- `research/likely.ts`: a direct buyer's reason uses the same "Why it needs <item>:" form, so the Leads table shows the tender sentence and the reason as bullets.

### 3.9 Search screen
- `find-form.tsx`:
  - removed: the product-type chips, the dropdown, "Not in your product list", and the submit block "Choose the product type".
  - added: one line, "We'll search tenders and buyers for exactly: <what you typed>. Add a grade or standard (e.g. API 660, ASME VIII) for more precise results."
  - `productId` is no longer sent.
- `find/page.tsx`: no "No products yet" gate. Search does not depend on the company profile.
- Run progress: the brief line shows "We understood: <item> (<kind>), also called … Searching tenders, current work and companies in …".
- Settings → Catalogue: note that search is not limited to this list.

### 3.10 Fixes from the first live run (14 Oct, "pressure vessels", UAE + Saudi Arabia)
- **Makers and direct buyers must be kinds, never names.** The AI listed "Larsen & Toubro, Technip Energies, Hyundai Heavy Industries, Al Jaber…" as makers. Several of those are EPC contractors, which would have rejected real buyers.
  - The prompt now asks for kinds.
  - `parseBrief` keeps only entries that name a kind (`MAKER_KIND`: manufacturers, fabricators, suppliers, stockists…; `BUYER_KIND`: operators, utilities, authorities, plants…).
- **Other names must be the same item.** "API 650 tank" (an atmospheric tank) was offered as a pressure-vessel synonym. Synonyms must now share a word with the item.
- **A typed item's own fabricators and suppliers sell it.** A metal fabricator was saved as a pressure-vessel buyer.
  - For typed items, `materialOutputOnly` now treats fabricate, supplier, vendor, exporter and maker as output.
  - For catalogue materials, fabricating *with* them still consumes them.
  - Tender and RFQ wording ("invites tender for supply of") always counts as buying, never as selling.
- **Tender pages were found but never checked** (India runs: tendersniper "Centrifugal Fans eTenders in India", tenderdetail "Pressure Vessel Tenders", tenderjeeto…). A Quick search had spent its 20 AI pages on news before the tender pages were read, and an older reading rule pushed "open tender" pages to the back. Now:
  - tender-lane pages are read first (`TENDER_READ_PRIORITY = 1340`, and +60 in the admission order when they name the item);
  - tender checks get their own AI allowance on top of the search's: `TENDER_AI_PAGES_PER_COUNTRY = 3`, `TENDER_AI_TOKENS_PER_COUNTRY = 12,000` (`analysisBudget` in `research/engine.ts`).
- **Tender results were deferred** (19 of 19 from one tender search): tender pages shared the discovery reading share. Each tender search now has its own share (`TENDER_READS_PER_SEARCH = 6`).
- **AI rate limits silently dropped pages** (this existed before this branch). With Groq's free tier (8,000 tokens a minute), an award or tender page's buyer check that hit a 429 was recorded as "Need check unavailable" and never retried.
  - It is now rethrown (`rateLimited` in `research/engine.ts`), so the step waits and retries like every other AI step.
  - The retry clears that page's unfinished AI reservations first, so it is not refused as an uncertain paid call.
- **Tenders without the buyer's name in the Gulf** are confirmed as a source limit (doc 21 §D1, §D3). Gulf searches find buyers mainly through award news. The tender lane matters most where tenders are public (India, Kuwait via copies, multilateral).

### 3.11 Tender list pages (live probe, 14 Oct, tender18 keyword pages)
The live runs found tender aggregator pages but saved no tender buyer. A probe on two real pages (tender18 "centrifugal fan tenders" and "twin lobe blower tenders") found the cause, and four fixes followed.

- **The check read the menus, not the tenders.** On these pages each tender sits over several lines (reference, location, title, "Agency / Dept :", agency, "Due Date :", date) after about 100 lines of navigation. The check's text picker only looks for award paragraphs, so it fell back to the page top, and the AI found 0 companies.
  - `tenderListingBlocks` (`research/relevance.ts`) now builds one block per listing whose title names the item. It takes the lines around the title, joined by spaces, and keeps a block only when it carries a buyer or date label.
  - `workAnalysisText` puts these blocks first on a tender page. Because the quote check tolerates whitespace, each block is still a literal quote from the page.
  - `namesItem(..., loose)` accepts a title that splits the item's words ("air cushion fan, type- centrifugal"), but only for spans of 900 characters or fewer.
- **The AI accepted tenders for parts and repairs** (impeller, pulley, spares, overhaul) even though the prompt says not to.
  - `partOrServiceTender` (`research/need.ts`) now rejects these in code: "buys services or spare parts, not the item".
  - It does not apply when the searched item is that part, e.g. a search for "fan impellers".
- **Listings had no date the check could use.** The AI often leaves the date empty on a list page, so every listing was rejected as undated.
  - `tenderDueDate` reads the date printed on the listing, in these formats: "Due Date : Oct 23, 2026", "Bid End Date: 23-10-2026" (day first), "05 Nov 2026", ISO.
  - An open tender (due date ahead) counts as this month's demand. The reason shows "(due 2026-11-03)", or "issued a tender for the item (closed …)" once the date has passed.
- **Answers for list pages.** The output cap is 3,000 tokens when a page has 3 or more listing blocks. The parser also accepts the shape `{"tenders":[{…,"companies":[…]}]}`, which the AI sometimes returns for list pages.

Probe result after the fixes (real page, real Groq model, run twice, same verdicts both times):

| Listing | Verdict |
|---|---|
| UCIL, air cushion fan, type centrifugal (due 3 Nov) | lead |
| BHEL, backward curved centrifugal fan (due 15 Oct) | lead |
| Indian Army, centrifugal fan blower (due 14 Oct) | lead |
| NPCIL Rawatbhata, centrifugal radial fan (due 22 Oct) | lead |
| NPCIL, DIDW impeller for centrifugal fan | rejected: part |
| GSECL, repairing and overhauling of centrifugal fans | rejected: service |
| DPS, pulley for supply fan | rejected: part |
| Balmer Lawrie, Yantra India, SCL, GMDA (×2), PHED: twin lobe blowers | lead |
| MAHAGENCO, blower spares | rejected: part |

### 3.12 Fabricators of a typed fabricated item
In the Gulf "pressure vessels" run, a Saudi metal fabricator (AlNafie) was still saved twice: by the discovery path (role "fabricator") and by the rated-company path ("Steel fabricator", type end_user). Both paths came from the catalogue rule that a fabricator consumes plate and pipe.

- `fabricatedItem(brief)` (`discovery/brief.ts`) is true for a typed item of kind `static_equipment` (vessels, separators, exchangers, tanks).
- For such an item:
  - a fabricator or workshop rated as end user or subcontractor is a competitor (`consistentType`, rating capped at 5);
  - the discovery path refuses role `fabricator`.
- EPC contractors are unaffected. So are catalogue materials (a fabricator still buys plate) and rotating equipment (skid and package builders buy fans and blowers).

### 3.13 India's tender list page, read directly (live run 5, 14 Oct)
In the live run for "centrifugal fans" in India, the tender searches found seven tender pages and every one was checked. None produced a buyer, and the AI judged each page correctly:
- tendersniper hides the buying agency ("GEM Title: Centrifugal radial fan · Due Date: 22-Oct-2026");
- the other pages were for scavenge blowers, a kitchen blower, axial fans and centrifuge machines.

The source that names the agency (tender18) was not among the search results. So for India the plan now reads it directly:

- **Source `tender-page`**:
  - `tenderListPages(item, country)` in `sourcing/tender-sources.ts` gives `https://tender18.com/all-india-tenders/keyword-tenders/<singular-item>-tenders`, e.g. centrifugal-fan, pressure-vessel, api-660-heat-exchanger.
  - The page is collected as a raw doc with no text, and the normal read step fetches it.
  - It uses no search credit and is tagged `:tender:`, so it gets the tender reading share, the tender AI allowance and the read priority.
  - It runs before the paid tender searches (`TENDER_PRIORITY + 20`).
- **Allowed and safe.**
  - tender18's robots.txt allows all crawlers, AI crawlers included.
  - An unknown keyword shows general latest tenders; `tenderListingBlocks` keeps only listings whose title names the item, so those are ignored.
  - Checked on 14 Oct for pressure-vessel, centrifugal-fan, axial-fan, blower, heat-exchanger, separator and api-660-heat-exchanger: every page answers with listings.
- **Other countries:** no equivalent public page names the buyer (doc 21). Gulf searches keep the Tavily tender searches and award news.

**Live run 6** (14 Oct, Quick, India, real providers, local database, email off):

| Search | Direct buyers (open tenders, fit 95) | Other leads | Rejected tender listings |
|---|---|---|---|
| centrifugal fans | BHEL (backward curved centrifugal fan, due 15 Oct), Indian Army (centrifugal fan blower, due 14 Oct), UCIL (air cushion fan, type centrifugal, due 3 Nov), NPCIL Rawatbhata (centrifugal radial fan, due 22 Oct) | VA Tech WABAG (award) | NPCIL impeller, GSECL overhaul, DPS pulley (parts and services) |
| pressure vessels | Engineers India Ltd ("pressure vessel – CS (up to 25 mm) for Bina Petchem and Refinery Expansion Project", due 19 Oct), IOCL Paradip/Kujang ("complete pressure vessel tag 217-V-001/002", due 14 Oct) | JNK India, Technip Energies (awards, run 5) | BHEL, GSECL, NTPC, ONGC (spares or services); BPCL, HPCL, CPCL, MRPL (a glossary page with no dated tender) |

Run 6 also saved "Defense GEM" and "Generation GEM". These are tendersniper's sector and portal labels, which the site shows in place of the hidden buyer. `maskedIssuer` (`research/need.ts`) now rejects portal or sector labels and catch-alls as the buyer: "the listing does not name the buying organisation". Leads also show the listing on one line.

### 3.14 The item's kind
The AI called "centrifugal fan" static equipment, and the fallback brief (when the AI brief fails) had no kind at all. `parseBrief` now classes fans, blowers, pumps, compressors, turbines, agitators, mixers and gearboxes as `rotating_equipment` whatever the AI says. `kindFromWords` also gives the fallback brief a kind: vessels, separators, exchangers, tanks, columns, reactors and drums are static equipment, and fans and blowers are rotating. The kind matters because it decides whether fabricators are competitors (§3.12): skid and package builders buy fans, while vessel fabricators make vessels.

### 3.15 MVP completion: his products, tender emails, every language
**His products (the client asked "where is the list of our products").**
- Settings has a new, editable tab, **Our products**. It starts with his seven products: Pressure Vessels, Separators, Centrifugal Fans, Axial Fans, Blowers, Heat Exchangers, API 660 Heat Exchangers.
- Storage is table `company_products` (migration `031_company_products.sql`). The API is `GET/POST /api/mvp/products` and `DELETE /api/mvp/products/[id]`.
- The Dashboard shows a **Your products** card: one-click searches (`/find?q=<product>` fills in the form) and a **Manage** link to Settings.
- The list is never read by the search. Any product can be searched in any of the 254 countries. A test searches "ball valves" in Brazil (not his product, not a default country) and saves the Petrobras tender buyer.
- Emails name his *other* products ("We also supply …", at most five, never the searched one).

**Tender leads get emails.**
- Tender buyers are saved as company type "owner", which the demo approval path skipped, so they would never have been emailed.
- `qualifyBuyer` now approves a company whose own tender for the searched item was accepted by this search's need check and is verified on its page (`basis: verified_tender`), without an AI opinion. This is not a confirmed order, and contacts are still validated separately.
- The opening email names the tender and its closing date: "I came across your tender for complete pressure vessel tag no: 217-v-001 (closing 14 Oct 2026) and would be glad to quote against it." A closed tender says "which closed on …, and would welcome being considered for similar requirements."
- The lead's reason adds: "bids go through its tender portal before the closing date."

**Every language.**
- `TENDER_WORDING` now covers French, Spanish, Portuguese, German, Italian, Dutch, Turkish, Indonesian/Malay, Polish, Russian, Chinese, Korean and Japanese tender words, as well as English and Arabic.
- The item's local-language names from the brief (`localItem`) now count as naming the item (`itemTerms` in `research/engine.ts`).
- In a tender, a one-word local name ("Druckbehälter") counts as naming the item.
- The tender trigger accepts tender wording in any of these languages.

**Live run 7** (14 Oct; "ball valves" in Brazil, which is not his product or a default country; "heat exchangers" in Saudi Arabia):
- **Brazil:** "ball valves" matches the catalogue entry, so the catalogue path ran, with a Portuguese brief: "válvula esfera", "válvula de bola". Petrobras was correctly rejected: the article was about Strohm's composite-pipe contract, not ball valves.
- **Brazil country leak, now fixed:** the one saved lead, Hanging H Companies, is a US pipeline contractor rated from a US list. Its line names no country. A likely buyer saved without a need check must now be placed in a chosen country by its own line, its source page's title or its website's country domain (`inChosenCountry` in `research/likely.ts`).
- **Saudi Arabia:** one capability lead. Tender pages were found and checked: SPPC's battery-storage tender and BAPCO's spare-parts and Bahrain items were correctly rejected. This matches the Gulf limits in doc 21.
- **Known AI limit:** the brief's Arabic name for heat exchanger was wrong ("مكافحة الحرارة"; the right one is "مبادل حراري"). A wrong local name adds no false leads by itself: a lead still needs a verified quote and the other checks. But it can miss local pages. Checking the AI's translations is left for the main build.

### 3.16 Is each buyer a true claim? The claims golden set
A lead is a claim: "this company buys this product, as this source shows". Every claim from the 14 Oct live runs was audited by hand: 64 claims from 14 runs. 53 have a readable source and form the claims golden set: 12 buyers, 8 potential buyers and 33 false claims. Three sources could not be re-read.

**How it works.**
- `src/mvp/research/eval/claims-golden.json` holds, for each claim:
  - what the AI said (company, role, country, date);
  - a source excerpt read with the app's reader (full-page mode, as the engine reads it);
  - the brief its run used;
  - the hand label.
- `claims.test.ts` replays every claim through the current rules (`judgeNeed`) on every test run.
  - It fails if a false claim becomes a lead, or if a real buyer is missed that is not on the known list.
  - The score goes to `tmp/eval-claims-rules.json`.
- `EVAL_LIVE=1` asks the live AI about each source again and scores its answers too (about 4k Groq tokens a claim, roughly a day of the free allowance).

**What the audit found, and fixed.** These false claims passed because the rules trusted the AI:

| Claim | Why it was false | Rule now |
|---|---|---|
| XPLOIL (heat exchangers, Saudi Arabia) | On-site supervision and commissioning: a service | `engineeringOnlySource`: supervision, commissioning, inspection and "engineering … services" are not buying |
| KBR (Aramco Marjan) | Engineering-services contract | Same |
| EIL (pressure vessels, India) | Fertilizer complex in Nigeria ("contract from Nigerian group") | Countries are also read from adjective forms (Nigerian, Brazilian, Omani…). A headline placing the work only abroad outweighs the AI's country unless the company's sentence names a chosen country |
| BHEL machining, GSECL inspection, NTPC and ONGC "custom bid for services" | Service tenders, caught only by the AI's answer | `PART_OR_SERVICE` also covers machining, inspection, examination, certification, calibration, radiography, NDT, hire and "custom bid for services" |
| AlNafie (pressure vessels, Saudi Arabia) | Steel fabrication subcontractor: makes, not buys | Need check: for fabricated equipment, a fabrication subcontractor is a competitor |
| Hanging H (ball valves, Brazil) | US company | `inChosenCountry` (§3.15) |
| "Defense GEM", "Generation GEM" | Portal labels | `maskedIssuer` (§3.13) |

**Score with the current rules: 18 leads, all true claims (precision 1.0). 18 of 20 real buyers found (recall 0.9).**

**Known misses (recall work for the main build):**
- HPCL "tender for the supply of six specialised refinery reactors": a reactor is a pressure vessel, but the words differ. This needs the item's sub-types.
- MES "Supply and fitment of pressure vessel": the agency name is on a separate line of the notice.

Every new live run should add its claims to this set. A false lead found by the client becomes a labelled row and a failing test first, then a fix.

## 4. What is NOT in scope
- Editable "Our products" and company profile in Settings (separate change; used for email context, not for search).
- Paid project databases or trade data (MEED, Volza).
- Logging in to portals, solving captchas, LinkedIn.

## 5. Tests
Unit:
- `item.test.ts`: ids, decoding, phrases, `resolveSearchItem`:
  - pressure vessel → `q:`;
  - "stainless steel pipe 316L" → `ss-duplex-pipe`;
  - "seamless pipe A106" → `cs-process-pipe`;
  - "ball valve actuator" → `q:`.
- `materialEvidenceKind` for typed items:
  - "centrifugal fans" explicit;
  - "fan base" none;
  - "whistle-blower" none;
  - "separators" only with industrial context.
- Brief v3 parse (new fields, guards, v2 defaults).
- Source plan for a typed item, with and without a brief: tender tasks first in every country; no throw.
- Need check:
  - tender issuer → lead;
  - supplier of the item → competitor;
  - old tender rejected;
  - item not named → rejected.
- API schema: no product is fine; a bogus id is rejected; `q:` ids are accepted.

Integration (PGlite, mocked providers, existing harness):
- A typed-item run is created on the durable engine, the brief is planned, and a tender page is read.
- The direct buyer is saved as a lead with tender evidence, plus an award page contractor lead.

Whole suite: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

Tests written:
- `src/mvp/discovery/item.test.ts` (19 tests);
- `src/mvp/research/universal-search.test.ts` (28 tests: the end-to-end run from tender to direct buyer, a tender18-style list page, due dates, parts and repairs, fabricators);
- updated: `find-form.test.tsx`, `work-search.test.ts`, `brief.test.ts`, `buyer-first-replay.test.ts`.

Known failure not caused by this change: `src/mvp/automation/engine.test.ts` › "limits chasing to two working-hour follow-ups…" fails the same way on `main` (5df6b51). It belongs to the email follow-up workflow, outside this change.

Live (local, real providers, small budget): Quick searches for "pressure vessel" (UAE, Saudi Arabia) and "centrifugal fans" (India). Check:
- tenders found;
- every lead's evidence;
- competitors excluded;
- no plate or pipe drift.

## 6. Rollout
1. Checkpoint commit: these docs.
2. Implementation on `feat/universal-search`, with no commits until every check passes, then one commit.
3. The user tests locally and on a Render preview. Merge to `main` (deploys) only on approval.
4. Database: one migration, `031_company_products.sql` (a new table, seeded with his seven products). It needs approval before it runs on the cloud database. Otherwise no migration is needed:
   - `product_id` columns are text, and `q:` ids fit;
   - `need_checks.role` is free text;
   - trigger kind `tender` and buyer type `owner` are already allowed.
