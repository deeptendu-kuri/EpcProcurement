# 21 · Universal search: where tenders and buyers are found (research, 14 Oct 2026)

**Purpose.** This document says where and how to search so that any item the client types finds:
- its **open tenders**, where the issuer is a direct buyer;
- its **buyers**, meaning the companies doing current work that needs the item.

It is for India, Saudi Arabia and the UAE first, then the other Gulf states and multilateral sources. The implementation is described in [22-UNIVERSAL-SEARCH-IMPLEMENTATION.md](22-UNIVERSAL-SEARCH-IMPLEMENTATION.md).

**Method.**
- About 60 live web searches.
- Sample pages fetched for each source.
- The TED, World Bank and GDELT APIs called directly.

Status labels:
- **V**: page fetched, fields confirmed.
- **PV**: indexed by search engines, but only snippets were seen, or the reader was blocked.
- **NV**: not verifiable.

Search engines that honour domain filters (Tavily `include_domains`, Google `site:`) can use every domain below.

## A · Source map

### India
| Source | What it gives | Visible without login | Status | Notes |
|---|---|---|---|---|
| **tender18.com** | Keyword pages listing live tenders from CPPP, GeM, PSUs and states (`/all-india-tenders/keyword-tenders/{item}-tenders`) | **Named issuer** (NPCIL, BHEL, GSECL, SAIL…), title, quantity, location, published and closing dates, original reference, source portal | **V** | Best India source. The twin-lobe-blower page listed 6 live tenders and the centrifugal-fan page 8. Value and EMD are behind registration. |
| **publicservicesmap.in** | Copies of CPPP, NIC state and GeM tenders, with the NIC tender ID in the URL | Issuer, tender ID, title, dates, EMD | **PV** | Surfaced EIL pressure-vessel and heat-exchanger requisitions and ID-fan tenders. |
| **tenders.infralens.in** | Copies of NIC and GeM bids | Issuer, quantity, closing date, eligibility | **PV** (403 to readers) | Example: GeM "Knock Out Drum ×2, closes 3 Sep 2026". |
| **tenderdetail.com** | Keyword pages | Title, state, closing date | **V** | Issuer often masked ("Petroleum PSU"): good for titles, weak for the buyer's name. |
| **tender247.com** | Keyword pages | Snippets: count, city, titles | **PV** (403) | Indexed well ("pressure vessel": 22 live). |
| **bidplus.gem.gov.in** | GeM bid PDFs | Item, quantity, specification | **V** (PDF) | The bid list is JavaScript only; `mkp.gem.gov.in` is a product catalogue, **not** bids. |
| **CPPP / NIC GePNIC portals** | Official listings | Dates, title, organisation | **V** (but stale) | Keyword search needs a captcha. Indexed detail pages are 2020–21. Fresh tenders reach search engines through the copies above. |
| **PSU portals** (NTPC, BHEL, NRL, IOCL) | NITs and PDFs | NIT number, title, dates | NTPC **V**, others **PV/NV** | Mostly older pages indexed; secondary only, with a strict date filter. |
| **NSE / BSE filings** | Order-win disclosures (Reg. 30) | Company, customer, date, scope, value | **V** | Example: Konstelec–NRL LoA, 3 Sep 2026, ₹58.48 Cr. |
| **PARIVESH** | Environment clearances | n/a | **NV** (JavaScript app) | Clearance letters are findable as owners' PDFs instead. |

### Saudi Arabia
| Source | Status | Notes |
|---|---|---|
| **Etimad** (`tenders.etimad.sa`, `monafasat.etimad.sa`) | **PV** | Every direct read hits a bot captcha; only search snippets are usable. |
| **bidsfactory.com** (copy of Etimad) | **V** | Agency (e.g. Saudi Water Authority), title, reference, dates, document fee. Also copies Dubai eSupply, Oman Tender Board and AfDB. |
| **Argaam / Tadawul disclosures** | **V** | Listed-company contracts: date, supplier, buyer, value (e.g. Arabian Pipes–Aramco SAR 104M). |
| **MEED guest pages** | **V** | Awards with client, contractor, value (e.g. Uthmaniyah gas compression EPC → SNSH, $1.24bn, Jun 2026). |
| Aramco, SABIC, Ma'aden, NEOM procurement | **NV** | Supplier portals need registration; RFQs are not public. |

### UAE
| Source | Status | Notes |
|---|---|---|
| Dubai eSupply | **NV** directly (401) | The bidsfactory copy is **V**, but titles are often generic. tendersinfo carried a descriptive Dubai Municipality item (fan-blower assemblies, 3 units). |
| **DEWA RFQ PDFs** (`dewa.gov.ae/api/RfxDownload/Get/{rfq}`) | **PV** (403 to readers) | Snippets show RFQ number, date, item and closing date. |
| ADGPG (Abu Dhabi), ADNOC, SEWA | **NV** | Registration only. Use award news instead (Zawya, MEED guest, Gulf News). |
| DFM / ADX disclosures | **PV** | Building-services and subcontractor awards. |

### Qatar, Oman, Kuwait, Bahrain
- **Qatar.**
  - Monaqasat lists the companies that bought tender documents (**PV**: TLS error for readers).
  - QatarEnergy's tender page is JavaScript only.
  - Affiliates post PDFs (QAFCO, **PV**).
- **Oman.** The Tender Board needs login; the bidsfactory copy is **V**. OQ uses a supplier portal.
- **Kuwait.** KNPC and KOC RFQs are visible through **biddetail.com** global pages, with the buyer named (**V**): 8 live heat-exchanger RFQs closed 15 Oct–1 Nov 2026.
- **Bahrain.** The Tender Board home page shows counts only; details need login.

### Multilateral and global
| Source | Open API | Status | Notes |
|---|---|---|---|
| World Bank procurement notices | Yes, no key | **V** | Full-text matching is noisy; keep rows whose `bid_description` names the item. |
| EU TED | Yes, anonymous | **V** (already used for EU countries) | Use CPV codes, not free text. |
| UNGM | No API seen | **V** (page) | Public notices; sample was old. |
| GDELT DOC 2.0 | Yes | **PV** | Throttles hard (≥ 5 s per call); equipment orders rarely appear. |

## B · Search lanes, by precision

1. **Tender copies with item pages** (highest precision for tenders).
   - India: tender18, publicservicesmap, infralens, tender247, tenderdetail, GeM bid PDFs, tendersinfo.
   - Gulf: bidsfactory (Etimad, eSupply, Oman Tender Board), biddetail, tendersinfo, globaltenders, DEWA, Monaqasat.

   **→ Engine:** `TENDER_DOMAINS` (`src/mvp/sourcing/tender-sources.ts`). For each country, one Tavily search is restricted to these domains (`<item> tender <country>`, last year, page text from Tavily), plus one general search (`<tender wording> tender <country>`).
2. **Free news searches for tenders and orders**: `"<item>" tender <country>` and `"<item>" order <country>` (Bing News RSS). A supplier's order news names its customer, who is the buyer.
3. **Own-language tender search** (Gulf): `مناقصة <item in Arabic>`. Recall is low; a hit is treated as a lead to confirm.
4. **Multilateral**: TED for EU countries (already in the engine). World Bank is a possible later addition.
5. **Award and contract news** (buyers through current work), as in docs/mvp/20: contract awards for the work that uses the item, the project's subcontracts and packages, and exchange filings.
6. **Project pipeline**: FEED, prequalification and clearance letters. Earliest signal, lowest precision; not automated yet.

**Blocked noise domains** (added to `junk-domains.json`): omnionlinestrategies.com, tradeindia, indiamart, aajjo, lntsufin, pharmaceutical-tech, mkp.gem.gov.in (catalogue), scribd, gminsights, cbinsights.

Without a country, foreign tender sites dominate the results (UK, Australia, Germany), so every tender search names the country or uses its domains.

## C · Playbook by item type

| Kind | Who buys | When | Best signals | Competitors (never leads) | False hits to guard |
|---|---|---|---|---|---|
| **Material** (pipe, fittings, flanges, valves) | EPC procurement; owners on long-term agreements; PSU spares tenders | After the EPC award, through construction; turnarounds | Tender copies, GeM, EPC awards, filings | Pipe mills, stockists | "pipe" alone (plumbing, PVC) |
| **Static equipment** (pressure vessels, KO / flash drums, separators, API 660 / 661 exchangers) | EPC / EPCM (e.g. EIL requisitions for BPCL, NRL), packagers, owners for replacements (IOCL, BPCL, KNPC tube bundles) | Long-lead: at or right after the EPC award; replacements at turnarounds | EIL "VV-MR" (vessels) and "EX-MR" (exchangers) requisitions; KNPC RFQs; EPC awards; Monaqasat purchaser lists | Vessel and exchanger fabricators (Zamil, Arabian CBI, Olayan Descon…; United Heat Transfer, Patels Airtemp) | Inspection or hydrotest services; RO **FRP membrane** pressure vessels; reactor-vessel ISI; "vessel" = ship; aircraft exchangers; gaskets and spares |
| **Rotating equipment** (centrifugal / axial / ID / FD fans, jet fans, twin-lobe / turbo / aeration blowers, pumps) | Utilities and gencos directly (NTPC, MAHAGENCO, GSECL); water bodies (GMDA, PHED) and STP EPCs for blowers; building-services contractors for HVAC fans; tunnel and metro contractors for jet fans | Owners: continuous replacement and spares; projects: 6–12 months after the civil or EPC award | tender18 keyword pages, Etimad copies, DEWA RFQs, water-treatment and FGD awards | Fan and blower makers | **Spares and services** (motors, VFDs, blades, overhaul); ceiling (BLDC) fans; hot-air blowers; sports "fans" |
| **Electrical** (cables, motors, transformers) | Electrical subcontractors; utilities | Construction | NSE / BSE LoA filings, GeM, DEWA | Cable makers | "cable TV", "cable car" |
| **Services** (overhaul, re-tubing, inspection) | Owners | Turnarounds | Tender copies | Service firms | Separate bucket when he sells supply only |

**→ Engine:**
- The brief (v3) asks for the item's kind, other names, tender wording, direct-buyer types, makers and local names.
- The need check makes a tender issuer a **direct buyer**, and makes a supplier or maker a **competitor**.
- It rejects tenders for services or spare parts of the item, tenders older than 12 months, and undated tenders.

## D · Honest limits
1. **Private EPC RFQs** (L&T, Saipem, Tecnimont, SNSH sub-packages) and owner supplier portals (Aramco, ADNOC, OQ, ADGPG, IOCL) need registration. They leave no public trace until an award. *What we do:* detect the EPC award, then treat the winner as the buyer.
2. **Approved vendor lists, prices and estimated values** are not public. Tender copies hide value and EMD.
3. **Bot protection**: Etimad captcha, CPPP keyword captcha, GeM JavaScript list, eSupply 401, and 403 from DEWA, tender247, bidassist, infralens. *What we do:*
   - The tender searches ask Tavily for the page text it read itself.
   - When that is missing **and** our reader is refused, a tender result whose own search text names the item is kept as that text. It is labelled "search result text: the tender page refuses automated reading; open the link for the full notice". This happens only in the tender lane.
4. **Masked issuers** (tenderdetail "Petroleum PSU"): sources that name the buyer are preferred. A direct buyer must be named in the sentence.
5. **Staleness**: indexed tender pages go back to 2013. Tender searches use the last year, and a direct buyer needs a source date within 12 months.
6. **Arabic recall** is low for item-level tenders.
7. **GDELT** throttles hard, and world news rarely covers equipment-level orders.
8. **Not verified**: PARIVESH search, CAPT (Kuwait), ADB and AfDB direct pages, Saudi Gazette, Arab News, The National, Construction Week.

## E · Evidence URLs checked (selection)
- **India:**
  - tender18.com/all-india-tenders/keyword-tenders/centrifugal-fan-tenders and …/twin-lobe-blower-tenders (V)
  - tenderdetail.com/Indian-tender/shell-and-tube-heat-exchanger-tenders (V)
  - publicservicesmap.in/tenders/pressure-vessels--cpp-2026-eil-912190-1 (snippet)
  - tenders.infralens.in/gem/knock-out-drum-7874616 (snippet)
  - bidplus.gem.gov.in/showbidDocument/7279726 (V)
  - eprocure.gov.in/cppp/latestactivetendersnew (V)
  - nsearchives.nseindia.com/corporate/KONSTELEC_04092026232125_Work_order_03rd_sep_2026.pdf (snippet)
- **Saudi Arabia:**
  - tenders.etimad.sa/Tender/AllTendersForVisitor (captcha)
  - bidsfactory.com/en/tenders/60020382-saudi_etimad-a0ac1021d53722db (V)
  - argaam.com/en/article/articledetail/id/1816812 (V)
  - guest.meed.com/aramco-awards-contract-for-uthmaniyah-gas-compression-project/ (V)
- **UAE:**
  - esupply.dubai.gov.ae (401)
  - bidsfactory.com/en/tenders/12610346-std-dubai_esupply-07b263da39f1e1a6 (V)
  - tendersinfo.com/tenders_details/fan-blower-assemblies-pac-fcu-units-534485430 (V)
  - dewa.gov.ae/api/RfxDownload/Get/2012600248 (403; snippet)
- **Gulf:**
  - biddetail.com/global-tenders/heat-exchangers-tenders and …/pressure-vessel-tenders (V, KNPC)
  - bidsfactory.com/it/tenders/source/oman-tb (V)
  - monaqasat.mof.gov.qa (TLS error)
- **Global:**
  - search.worldbank.org/api/v2/procnotices (V)
  - api.ted.europa.eu/v3/notices/search (V)
  - ungm.org/Public/Notice/63378 (V)
