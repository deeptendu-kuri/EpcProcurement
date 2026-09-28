# 14 · Buyers, catalogue and SuperSearch

Owner of: how the product describes a lead (as a **Buyer**), the default product catalogue, what each buyer will buy and when, competitor checks, "Why you", contact depth, the SuperSearch screen and the lead sidebar. **This file wins over 07, 09, 12 and 13 wherever they differ.**

The client is a **supplier of engineering and construction materials, mainly pipes**. Everyone in a project's supply chain can buy from them: the project owner, the EPC contractor, subcontractors, manufacturers, fabricators and distributors.

The UI mockup is `docs/mvp/mockups/supersearch-v2.html` (screenshots `docs/mvp/mockups/03-v2-supersearch-buyers.png`, `04-v2-buyer-sidebar.png`, `05-v2-sidebar-contacts.png`). Build the screens to match it.

## 1. Words shown to users

| Internal (unchanged in the DB) | Shown to users |
|---|---|
| lead | **Buyer** (the menu item "Leads" becomes **Buyers**) |
| class `genuine` / `research` / `watch` / `rejected` | **Ready to approach** / **Check first** / **Early — keep an eye** / **Not a buyer** |
| score | **Buyer fit** (0–100) |
| confidence band | **How sure we are**: High / Medium / Low |
| kind `bid` / `supply_subcontract` | not shown; the **buyer role** is shown instead (an open tender shows as "Project owner · open tender") |
| accept / reject | **Good lead** / **Not relevant** |
| compliance to bid | **Can you sell to them?** |
| supplier | never shown; a company that won a supply order is shown as **Manufacturer**, **Distributor** or **Fabricator** |

Every buyer answers five questions: **Who is buying** (buyer + role) · **Why now** (buying reason) · **What they'll buy from you** · **Why you** (their benefit) · **Who to talk to, and when** (buying team + buying window).

Headline pattern (one sentence, built from verified facts only):
> **{Buyer} ({role}, {country}) will likely buy {top 2–3 items} in {window}** for {trigger}. **Why you:** {top 1–2 benefits}.

## 2. Buyer roles

`owner` Project owner · `epc_contractor` EPC contractor · `subcontractor` Subcontractor (with discipline) · `manufacturer` Manufacturer (e.g. pipe mill, valve maker) · `fabricator` Fabricator / spool shop · `distributor` Distributor / stockist. Migration: widen `leads.buyer_type` to these values; map the old `supplier` to `manufacturer` when the text says it makes/manufactures/mill/plant, otherwise `distributor`.

## 3. Default product catalogue (example — editable in Settings)

Stored in `src/mvp/config/catalogue.json`. Each item has an id, category, name, standards, customs (HS) headings and matching keywords. Clearly marked "Example catalogue — replace with your own".

| id | Category | Item | Standards | HS |
|---|---|---|---|---|
| line-pipe | Pipes | Line pipe (ERW, LSAW, HSAW, seamless), 1/2"–60", Gr B–X70, PSL1/PSL2 | API 5L, ISO 3183 | 7304, 7305, 7306 |
| cs-process-pipe | Pipes | Carbon steel process pipe, sch 10–XXS | ASTM A106, A53 | 7304, 7306 |
| ss-duplex-pipe | Pipes | Stainless and duplex pipe | ASTM A312, A790 | 7304, 7306 |
| alloy-pipe | Pipes | Alloy steel pipe (P11, P22, P91) | ASTM A335 | 7304 |
| octg | Pipes | Casing and tubing (OCTG) | API 5CT | 7304 |
| di-pipe | Pipes | Ductile iron pipe (water) | ISO 2531, EN 545 | 7303 |
| hdpe-pipe | Pipes | HDPE / PE100 pipe (water, gas) | ISO 4427, ISO 4437 | 3917 |
| grp-pipe | Pipes | GRP / GRE pipe | AWWA C950, ISO 14692 | 3917, 7019 |
| pvc-pipe | Pipes | uPVC / CPVC pipe | ISO 1452 | 3917 |
| bw-fittings | Fittings & flanges | Butt-weld fittings (elbows, tees, reducers, caps) | ASME B16.9, MSS SP-75 | 7307 |
| forged-fittings | Fittings & flanges | Forged fittings | ASME B16.11 | 7307 |
| flanges | Fittings & flanges | Flanges (WN, SO, blind, spectacle) | ASME B16.5, B16.47 | 7307 |
| induction-bends | Fittings & flanges | Induction bends and insulating joints | ISO 15590 | 7307 |
| spools | Fittings & flanges | Prefabricated piping spools | ASME B31.3 | 7307, 7308 |
| gate-globe-check | Valves | Gate, globe and check valves | API 600, 602, 594 | 8481 |
| ball-valves | Valves | Ball valves (pipeline and process) | API 6D, API 608 | 8481 |
| butterfly-valves | Valves | Butterfly valves (process and water) | API 609, AWWA C504 | 8481 |
| control-relief-valves | Valves | Control and safety relief valves | API 526 | 8481 |
| coating-materials | Coating & corrosion | Pipe coating materials (3LPE, 3LPP, FBE powders) | ISO 21809 | 3901, 3907 |
| field-joint-coating | Coating & corrosion | Field joint coating (heat-shrink sleeves, tapes) | ISO 21809-3 | 3919, 3926 |
| cathodic-protection | Coating & corrosion | Cathodic protection (anodes, test posts, rectifiers) | NACE SP0169 | 8543, 7616 |
| paints | Coating & corrosion | Protective coatings and paints (epoxy, PU) | ISO 12944 | 3208 |
| stud-bolts | Bolting & sealing | Stud bolts and nuts | ASTM A193 B7, A194 2H | 7318 |
| gaskets | Bolting & sealing | Gaskets (spiral wound, RTJ, sheet) | ASME B16.20, B16.21 | 8484 |
| welding-consumables | Welding & consumables | Welding electrodes, wire and flux | AWS A5.1, A5.17, A5.18 | 8311 |
| abrasives | Welding & consumables | Abrasives, cutting and grinding discs | EN 12413 | 6804, 6805 |
| structural-steel | Structural & civil | Structural sections (beams, channels, angles) | ASTM A36, A572, EN 10025 | 7216 |
| plates | Structural & civil | Steel plates and sheets | ASTM A516, A36 | 7208 |
| rebar | Structural & civil | Reinforcing bar | ASTM A615, BS 4449 | 7214 |
| gratings-handrails | Structural & civil | Gratings, handrails and pipe supports | — | 7308, 7326 |
| cables | Electrical & instruments | Power and control cables | IEC 60502, BS 5467 | 8544 |
| cable-trays | Electrical & instruments | Cable trays and ladders | NEMA VE 1 | 7308, 7326 |
| instruments | Electrical & instruments | Gauges and transmitters (pressure, temperature, flow) | — | 9026 |
| insulation | Insulation | Thermal insulation and cladding (mineral wool, aluminium jacketing) | ASTM C547 | 6806, 7606 |
| pumps | Water & utilities | Pumps (water and process) | API 610, ISO 2858 | 8413 |

## 4. Strengths (example — editable in Settings)

Stored in `src/mvp/config/strengths.json`. Each strength has an id, a short text and the conditions under which it is a benefit to a buyer.

| id | Strength (example) | A benefit when… |
|---|---|---|
| stock-hubs | Stock in Jebel Ali (UAE), Dammam (KSA) and Mumbai (India) for standard sizes | the buyer or site is in or near those countries |
| fast-delivery | Ex-stock delivery in 1–2 weeks; mill orders in 8–14 weeks | the order or project has a short delivery time (≤ 9 months) or is urgent |
| one-stop | One vendor for pipe, fittings, flanges, valves, bolting and gaskets | the buyer needs 3 or more catalogue categories |
| certified | Mill test certificates (EN 10204 3.1/3.2), third-party inspection supported; ISO 9001 | the project names standards or specs (API, ASTM, NACE, ISO) or the owner is an oil & gas major |
| approved-vendor | Registered with major owners' vendor lists (example: ADNOC, Aramco) | the project owner uses an approved vendor list (oil & gas owners) |
| local-content | ICV certificate (UAE) and IKTVA registration (KSA) (example) | the owner scores local content (Aramco, ADNOC, QatarEnergy, PDO, India public tenders) |
| delivery-to-site | Delivery to site or port, with export documents | the site or delivery port is known, or the buyer is in another country |

The UI must mark these as examples until the client edits them. "Why you" only shows strengths whose condition matches verified facts.

## 5. What each buyer role buys, and when (needs map)

Stored in `src/mvp/config/needs-map.json` as rules: role (+ discipline/project type) → catalogue items → buying window relative to the trigger date.

| Buyer role (situation) | Items (catalogue ids) | Buying window after trigger |
|---|---|---|
| EPC contractor — pipeline (oil, gas, water) | line-pipe, ball-valves, gate-globe-check, induction-bends (long-lead) | 0–3 months |
| | bw-fittings, flanges, stud-bolts, gaskets, field-joint-coating, cathodic-protection | 2–9 months |
| | welding-consumables, abrasives, paints | 3–18 months (during construction) |
| EPC contractor — plant or facility (refinery, petrochemical, power, water treatment) | cs-process-pipe, ss-duplex-pipe, alloy-pipe, valves (all), spools | 1–6 months |
| | bw-fittings, forged-fittings, flanges, stud-bolts, gaskets, structural-steel, plates, gratings-handrails | 3–12 months |
| | cables, cable-trays, instruments, insulation, paints | 6–24 months |
| EPC / contractor — water and sewage | di-pipe, hdpe-pipe, grp-pipe, pvc-pipe, butterfly-valves, gate-globe-check, pumps | 0–6 months |
| Subcontractor — piping / mechanical | pipes for the package, bw-fittings, forged-fittings, flanges, stud-bolts, gaskets, welding-consumables, gratings-handrails | 0–9 months after subcontract |
| Subcontractor — civil / structural | rebar, structural-steel, plates | 0–6 months |
| Subcontractor — electrical & instrumentation | cables, cable-trays, instruments | 3–12 months |
| Subcontractor — insulation / painting | insulation, paints | 6–18 months |
| Subcontractor — coating / testing | coating-materials, field-joint-coating, abrasives | 0–6 months |
| Manufacturer — pipe mill | plates, coating-materials, welding-consumables, abrasives | 0–3 months after an order win |
| Manufacturer — valve or equipment maker | stud-bolts, gaskets, forged-fittings, instruments | 0–3 months |
| Fabricator / spool shop | cs-process-pipe, ss-duplex-pipe, bw-fittings, forged-fittings, flanges, plates, structural-steel, welding-consumables | 0–6 months |
| Distributor / stockist | items in their product range that you sell (resale stock) | continuous; peak 0–3 months after a big order |
| Project owner | approved-vendor-list registration, owner-supplied long-lead items (line-pipe, valves), maintenance spares (gaskets, stud-bolts, valves) | before tender and during the project |
| Owner — upstream drilling | octg | 0–6 months |

The buying window is drawn as steps (e.g. Order won → Materials & consumables → Coating & testing → Delivery). A step is `done` if in the past, `now` if today falls inside it, `next` otherwise.

## 6. Competitor check (per item)

- A buyer is a **competitor for an item** when it makes or stocks that item: a pipe mill makes the pipe types it produces; a valve maker makes valves; a distributor stocks its product range.
- The check uses the text ("manufacturer of …", "pipe mill", "produces …"), the buyer role and a small list in `src/mvp/config/known-companies.json` (e.g. EPIC, Welspun: line pipe makers; examples only, clearly marked).
- Competing items show **✕ Competitor — they make it** and are hidden from "What they'll buy" chips, outreach and drafts.
- If a buyer competes on every item it would buy, it becomes **Not a buyer** with the reason "Competitor for all your products".
- Filter: **Hide competitors** (on by default).

## 7. "Why you" (their benefit)

For each buyer, match the strengths in §4 against the verified facts (country and site, delivery time, specs named, owner type, number of categories). Show at most 3, each with a short reason, e.g. "Stock in Dammam — the buyer is in Saudi Arabia". Never show a benefit whose condition is not met.

## 8. Contact depth

Level 0 project → level 1 companies named in sources → level 2 companies around the project (PMC, subcontractors, mills, stockists; from other sources or "not identified yet") → level 3 people (buying team) → level 4 contact details → level 5 decision-maker check.

**Buying-team slots per company (by role):**

| Role | Slots |
|---|---|
| EPC contractor | Head of procurement (decision maker) · Category buyer, piping/materials (buyer) · Project manager (influencer) · Construction manager (influencer) · QA/QC manager (technical approver) · Expediting / planning (buyer) · Vendor registration |
| Subcontractor | MD / owner (decision maker + approver) · Procurement (buyer) · Site manager (influencer) |
| Manufacturer | Head of procurement / supply chain (decision maker) · Buyer, raw materials & consumables (buyer) · QA/QC (technical approver) · Plant manager (influencer) · CEO/MD (approver) · Vendor registration |
| Fabricator / distributor | Procurement / purchasing (decision maker) · Branch or plant manager (influencer) · Owner/MD (approver) |
| Project owner | Procurement head (decision maker) · Project director (approver) · Package manager (influencer) · Vendor registration / approved vendor list |

- A slot is filled by a person named in a verified source whose title matches (title → slot rules), otherwise shown as **Not found** with **Find** links (web searches: company + slot title; LinkedIn people search; contact page). No scraping.
- Decision-maker status: **Not found** → **Likely** (a named person whose title and department match the slot) → **Confirmed** (a user marks it after a reply, call or Sales Navigator check; stored as an activity).
- Counts: "X of Y found" per buyer; "N contacts to approach (M found)" across the results.
- **Other buyers on this project:** the chain around the buyer (owner, EPC, subcontractors, parent group), each with its role, whether identified, and its own "X of Y found".
- Designed so a contact provider (Apollo, Cognism) can fill slots later behind **Find contacts**.

## 9. Data contract (`src/mvp/buyers/types.ts`)

```ts
export type BuyerRole = 'owner' | 'epc_contractor' | 'subcontractor' | 'manufacturer' | 'fabricator' | 'distributor';
export type BuyerStage = 'ready' | 'check' | 'early' | 'not_buyer';           // from class
export type FitLevel = 'good' | 'possible' | 'competitor';
export interface SellItem { itemId: string; name: string; category: string; fit: FitLevel; why: string; window?: string; evidenceIds: string[] }
export interface WindowStep { label: string; from: string | null; to: string | null; state: 'done' | 'now' | 'next' }
export interface WhyYou { strengthId: string; text: string; reason: string; isExample: boolean }
export type SlotRole = 'decision_maker' | 'buyer' | 'technical_approver' | 'influencer' | 'approver' | 'vendor_registration';
export interface ContactSlot {
  slotId: string; role: SlotRole; title: string; description: string;
  person: { id: string; name: string; title: string | null; evidenceIds: string[] } | null;
  status: 'not_found' | 'likely' | 'confirmed';
  findLinks: { label: string; url: string }[];
}
export interface ChainCompany { companyId: string | null; name: string; role: BuyerRole | 'pmc' | 'parent_group'; identified: boolean; found: number; total: number; note: string }
export interface ProofItem { evidenceId: string; sentence: string; highlight: string; source: string; date: string | null; url: string | null; verified: boolean }
export interface BuyerView {
  leadId: string; companyId: string; name: string; shortName: string;
  role: BuyerRole; roleLabel: string; subRoleLabel: string | null;       // e.g. "Pipe mill", "Piping subcontractor"
  country: string | null; city: string | null;
  stage: BuyerStage; fitScore: number; howSure: 'high' | 'medium' | 'low';
  headline: string; buyingReason: string; buyingReasonEvidenceIds: string[]; triggerDate: string | null;
  sellItems: SellItem[]; competitorFor: string[];
  window: WindowStep[];
  whyYou: WhyYou[];
  team: ContactSlot[]; found: number; total: number;
  chain: ChainCompany[];
  reach: { country: string | null; email: 'allowed' | 'opt_out_only' | 'consent_needed' | 'blocked'; summary: string };
  proof: ProofItem[];
  status: string; isSample: boolean; updatedAt: string;
}
export interface BuyerRow { /* list row: subset of BuyerView */
  leadId: string; name: string; subRoleLabel: string | null; role: BuyerRole; roleLabel: string;
  buyingReason: string; sellSummary: string; competitorNote: string | null;
  country: string | null; fitScore: number; howSure: 'high' | 'medium' | 'low'; stage: BuyerStage;
  found: number; total: number; isSample: boolean; triggerDate: string | null;
}
export interface BuyerSearch {
  location?: { any?: string[]; not?: string[]; basis?: 'hq' | 'site' };
  roles?: { any?: BuyerRole[]; not?: BuyerRole[] };
  sell?: { any?: string[] /* item ids */; hideCompetitors?: boolean };
  signals?: { any?: ('order_won' | 'contract_won' | 'tender_open' | 'expansion')[]; withinDays?: number };
  contacts?: { departments?: string[]; slotRoles?: SlotRole[]; onlyWithFound?: boolean };
  industry?: string[]; valueUsd?: { min?: number; max?: number };
  lookalikeOf?: string; companyList?: string[];
  reach?: ('allowed' | 'opt_out_only' | 'consent_needed')[];
  stage?: BuyerStage[]; minFit?: number; howSure?: ('high' | 'medium' | 'low')[];
  q?: string; sort?: 'latest' | 'fit' | 'window'; page?: number; pageSize?: number;
}
```

Server functions: `getBuyerView(leadId)`, `searchBuyers(search) → { rows, total, facets, contactsFound, contactsTotal }`, `searchContacts(search) → rows of { person or slot, company, role, status }`. API routes under `/api/mvp/buyers/*`.

## 10. SuperSearch screen and sidebar

- Route `/search` becomes the main work screen (menu: Overview · **SuperSearch** · Lead lists · Pipeline · Settings · Help). `/leads` redirects to `/search`.
- Layout as in the mockup: icon rail · collapsible filter panel (sections with "Is any of / Is not any of" chips) · results with tabs **SuperSearch | Lead Lists**, count line "N buyers found · M contacts to approach (K found)", switch **Buyers | Contacts**, Select all, Add to list, Export, **Find contacts**.
- Buyers table columns: Buyer (name + sub-role) · Buyer role · Why they buy now · What we can sell them (+ competitor note) · Location · Buyer fit + how sure · Contacts (X of Y found).
- Clicking a row opens the **buyer sidebar** exactly as in the mockup: header (name, role chip, country, fit) → Why they will buy now → What we can sell them (Good fit / Possible / Competitor with reasons) → When they buy (steps) → Buying team (slots with Find) → Other buyers on this project → How to reach them (country rule) → Proof (full sentences, highlighted) → footer: Good lead · Not relevant · Add to list · Open full page.
- **Lead Lists**: save selected buyers into named lists (new table `lead_lists`, `lead_list_items`).
- Filters are held in the URL; saved searches reuse the existing saved-search table.
- Keep the existing full lead page (`/leads/[id]` → `/buyers/[id]`), restyled with the same five-question structure at the top.

## 11. Data fixes in this iteration

- Merge the same order reported in different currencies (convert to USD; same buyer + owner + product within 30 days and values within 15% → one project).
- Merge company name variants ("Welspun Corp", "Welspun Corp Associate", "Welspun Corp Unit" → one company; "Saudi Arabian Oil Co" = "Saudi Aramco").
- Drop place names mistaken for companies (a gazetteer check plus: no company suffix and appears after "in/at/near") and implausible values (> USD 20B for a single order).
