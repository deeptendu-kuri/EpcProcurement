# 05 · Sources and collection

Owner of: which sources we read, how each is read, source criteria, filtering rules, politeness and legal limits, de-duplication and change detection. Facts were checked on 26 Sep 2026.

## 1. How a source earns its place

A source is added only if it meets these criteria. The same criteria are shown to the client in the product.

| Criterion | Rule |
|---|---|
| Relevant | Publishes projects, tenders, awards or procurement news in the client's sectors and markets |
| First-hand | Official or primary (portal, owner, listed company) ranks as Tier A; reputable press as Tier B; everything else as Tier C |
| Fresh | Updates at least weekly |
| Open and allowed | Public page, feed or API; robots.txt and terms allow reading; never bypasses a login the client hasn't provided |
| Readable | Stable HTML, RSS, API or PDF |
| Language | English, Arabic or Malay |
| Proven | Keeps its place only if its documents turn into accepted leads. `sources.reliability` is recomputed monthly |

## 2. Source catalogue for the MVP

Access: API · RSS · HTML · PDF. Tier: A, B or C. Cadence is the default `schedule_cron`.

### 2.1 India

| Source | Category | Access | Tier | Cadence | What we take | Notes |
|---|---|---|---|---|---|---|
| CPPP (eprocure.gov.in) active tenders | Tender portal | HTML | A | Every 6 h | Tender title, ref, organisation, dates, value; documents where public | No official API. Documents sit behind a captcha, so we store the tender page only. Contact authority name and address are shown |
| GeM bids (bidplus.gem.gov.in/all-bids) | Tender portal | HTML + PDF | A | Every 6 h | Bid PDFs (items, quantities) | Buyer organisation only, usually no person |
| PSU tender pages: ONGC, GAIL, IOCL, BPCL, NTPC, EIL | Tender portal | HTML | A | Daily | Notices, corrigenda | Full packs often need a vendor login (A6) |
| BSE corporate announcements RSS | Exchange | RSS + PDF | A | Hourly | Order wins, contract awards | Order wins are disclosed under SEBI LODR Reg. 30; EPC firms (e.g. L&T) file "significant/major order" notices |
| NSE announcements RSS | Exchange | RSS + PDF | A | Hourly | Same as BSE | — |
| ETEnergyWorld, ETInfra RSS | Trade press | RSS | B | Every 2 h | Project news, awards | — |
| MCA company master data | Registry | HTML | A | On demand | CIN, status, directors | Captcha: manual or cached lookups only |

### 2.2 Arab countries (Saudi Arabia and UAE first; others after)

| Source | Category | Access | Tier | Cadence | Notes |
|---|---|---|---|---|---|
| Saudi Etimad: public tender list + **developer API** (Tenders Inquiry, Contracts Plus) | Tender portal | API (sandbox, then production account) + HTML | A | Every 6 h | Specification booklets need login and a fee (A6) |
| Saudi Exchange (Tadawul) issuer announcements | Exchange | HTML | A | Hourly | Material contract awards announced immediately (CMA rules). No RSS |
| UAE ADGPG tender list | Tender portal | HTML | A | Every 6 h | Documents need supplier registration |
| Dubai eSupply | Tender portal | HTML | A | Daily | Login-based bidding; public titles and closing dates |
| ADX and DFM disclosures | Exchange | HTML | A | Hourly | Standard disclosure forms; no API |
| Qatar Monaqasat | Tender portal | HTML | A | Daily | Includes future tenders; documents paid |
| Oman Tender Board (Esnad) | Tender portal | HTML | A | Daily | Public dashboard and open-data report |
| Kuwait CAPT | Tender portal | HTML (Arabic) | A | Daily | — |
| Bahrain Tender Board | Tender portal | HTML | A | Daily | Opened-bid prices are published: useful for competition sub-criteria |
| Owner newsrooms: Aramco, ADNOC, QatarEnergy, PDO, OQ, DEWA, EtihadWE, SWPC, KAHRAMAA | Newsroom | RSS / HTML | A | Daily | Project announcements, awards |
| Zawya, Arab Finance RSS | Trade press | RSS | B | Every 2 h | MEED RSS is paywalled, so headlines only |
| UAE National Economic Register; Saudi CR inquiry | Registry | HTML | A | On demand | Company verification |

### 2.3 Europe: Norway (assumption A1)

| Source | Category | Access | Tier | Cadence | Notes |
|---|---|---|---|---|---|
| **EU TED search API v3** (`POST api.ted.europa.eu/v3/notices/search`) | Tender + award notices | API, **no key** | A | Every 6 h | Norway's above-threshold notices appear here. Award notices list winners and values as structured fields, which feeds the relationship graph without AI |
| Oslo Børs NewsWeb | Exchange | HTML | A | Hourly | Contract-award disclosures |
| Brønnøysund register (`data.brreg.no`) | Registry | API, no key | A | On demand | Company verification |
| Equinor, Aker and other operator newsrooms | Newsroom | RSS / HTML | A | Daily | Upstream suppliers are largely prequalified through Magnet JQS, so newsrooms matter |

### 2.4 Asia: Malaysia (assumption A2)

| Source | Category | Access | Tier | Cadence | Notes |
|---|---|---|---|---|---|
| MyProcurement: tender adverts and **results** | Tender portal | HTML | A | Daily | English and Malay; results feed the graph |
| Bursa Malaysia company announcements | Exchange | HTML | A | Hourly | Contractors announce awards routinely |
| Petronas and utility newsrooms | Newsroom | HTML | A | Daily | — |
| SSM e-Info | Registry | Paid per record | — | Manual only | Not automated (not free) |

### 2.5 Global

| Source | Category | Access | Tier | Cadence | Notes |
|---|---|---|---|---|---|
| **GDELT DOC 2.0** | News index | API, no key | B | Every 30 min | 65 languages machine-translated; searched in English; 3-month rolling window; max 250 results per query |
| **GLEIF LEI API** | Registry | API, no key | A | On demand | Company identity |
| OFAC, UN, UK, UAE sanctions lists | Sanctions | Download | A | Daily | EU list needs a free EU Login account |
| Company websites ("projects", "news", "careers" pages) of companies already in the graph | Company site | HTML | A (own claims) | Weekly | History, partners, hiring for project roles |
| Brave Search API (optional) | Search | API ($5 free credit a month) | C → the landing page's tier | On demand | Used by the research agent only |

## 3. Reader contract

Every reader implements the same interface, so adding a source means adding a reader and a row in `sources`.

```python
class SourceReader(Protocol):
    key: str                                   # matches sources.reader_key
    def discover(self, source: Source, query: RunQuery | None) -> Iterable[DiscoveredItem]: ...
    def fetch(self, item: DiscoveredItem) -> FetchedDocument: ...   # raw bytes + metadata

@dataclass
class DiscoveredItem:
    url: str
    title: str | None
    published_at: datetime | None
    hints: dict            # structured fields the source already gives (e.g. TED winner, value)
```

- **Structured fields first.** When a source gives structured data (TED winners and values, Etimad API fields, tender reference and closing date), the reader writes them as **rule-extracted evidence** with `extracted_by='rule:<reader>'`. No AI is needed for them.
- **Query handling.** Watchlist keywords, products and disciplines become source-specific queries: GDELT query strings, TED expert-search expressions, portal keyword searches. Queries are stored on the run for audit.

## 4. The read step

1. **Fetch** with httpx. Crawl4AI/Playwright is used only if the page needs JavaScript (flagged per source).
2. **Clean:**
   - Web pages: trafilatura main text.
   - PDFs: pdfplumber text and tables. If a page has almost no text layer, run Tesseract OCR (English + Arabic).
3. **Normalise:** Unicode NFC, collapse whitespace, keep character offsets.
4. **Detect language** (lingua). Arabic and Malay are passed to AI as they are; the models are multilingual.
5. **Hash** the normalised text (sha256), then check the result against what's already stored:
   - Same hash already stored: stop.
   - Same URL with a new hash: re-process it as a change.
6. **Store** the full text in Supabase Storage (`documents/<yyyy>/<mm>/<id>.txt`). Only metadata goes in the database.
7. **Rules filter** (§5). If the document passes, chunk it (§4.1) and embed the chunks.

### 4.1 Chunking

- Split by headings and pages first, then into chunks of 1,500–2,000 tokens with a 150-token overlap.
- Keep `char_start` and `char_end` so evidence quotes map back to the document.
- **Relevance chunks only:** after filtering, only chunks that contain a trigger term (§5) or a named entity near one go to AI. This is the main way we stay within free quotas.

## 5. Rules filter (before any AI)

A document passes only if all of the following hold.

| Check | Rule | Example trigger terms (per language, kept in config) |
|---|---|---|
| Buying action | Contains at least one action term | tender, RFQ, RFP, prequalification, award, awarded, contract, order, subcontract, EOI; Arabic: مناقصة، ترسية، عقد; Malay: tender, sebut harga, anugerah |
| Scope | Contains a client discipline or product keyword, or a synonym | pipeline, piping, line pipe, API 5L, valves, static equipment, EPC, mechanical works |
| Market | Mentions a watched country or city, **or** the source is market-specific | — |
| Freshness | Published or updated within 18 months, **or** a future date (closing or delivery) is mentioned | — |
| Not noise | Not a job ad for unrelated roles, market report, price index, court or crime story, or procedure manual (patterns carried over from the prototype's filters) | — |

- **Uncertain documents** (they pass buying action and scope, but market or freshness is unclear) go to the small AI triage model (06 §3, pass P0).
- **Target:** 80% or more of fetched documents never reach extraction. The filter reason is stored on each document for tuning.

## 6. Politeness and legal limits

| Rule | Setting |
|---|---|
| robots.txt | Checked at source setup and monthly; disallowed paths are never fetched |
| Terms of use | Reviewed per source; recorded in `sources.terms_notes`; sources that forbid automated access are disabled or read by hand |
| Rate limit | Default 1 request every 5 seconds per domain; configurable per source; exponential backoff on 429 or 503 |
| Identification | Clear user agent with a contact email |
| Logins | Only with the client's own credentials, for the client's own use (A6); stored encrypted; never shared across clients |
| LinkedIn | Never fetched; profile URLs are stored as links only |
| Paywalls | Headlines and public summaries only |

## 7. Retention

| Data | Kept for |
|---|---|
| Raw documents in Storage | 90 days (the free tier is 1 GB), then pruned |
| Evidence quotes and URLs | Permanently (small, and needed for proof) |
| Filtered-out document metadata | 30 days |
| Contacts unused for 24 months | Purged (08) |

## 8. Adding a market later

1. Add the market code to the `market_code` enum.
2. Add rows to `sources` with readers (a new reader only when the site is new).
3. Add trigger terms for the language to the filter config.
4. Add `compliance_rules` for bid and outreach.
5. Add 50 labelled documents to the test set (11).

No other code changes are needed.
