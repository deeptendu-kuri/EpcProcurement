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

### 3.9 Search screen
- `find-form.tsx`:
  - removed: the product-type chips, the dropdown, "Not in your product list", and the submit block "Choose the product type".
  - added: one line, "We'll search tenders and buyers for exactly: <what you typed>. Add a grade or standard (e.g. API 660, ASME VIII) for more precise results."
  - `productId` is no longer sent.
- `find/page.tsx`: no "No products yet" gate. Search does not depend on the company profile.
- Run progress: the brief line shows "We understood: <item> (<kind>), also called … Searching tenders, current work and companies in …".
- Settings → Catalogue: note that search is not limited to this list.

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
- `src/mvp/research/universal-search.test.ts` (12 tests, including the end-to-end run from tender to direct buyer);
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
4. No database migration is needed:
   - `product_id` columns are text, and `q:` ids fit;
   - `need_checks.role` is free text;
   - trigger kind `tender` and buyer type `owner` are already allowed.
