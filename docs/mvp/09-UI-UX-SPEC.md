# 09 · UI/UX specification

Owner of: screens, layout, wording, states and what's removed from the prototype. Behaviour rules come from [01](01-PRD-MVP.md) and [07](07-SIGNALS-SCORING-RESEARCH.md).

## 1. Principles

1. **Four screens only:** Find, Leads, Lead page, Settings. Plus Login and an admin-only Health page.
2. **One job per screen.** No dashboards of sample data, no configuration panels on work screens.
3. **Plain words.** No internal terms such as "play", "gate", "verdict", "evidence gate", "recovery", "client-safe", "match score" or "pressure".
4. **Proof is one click away.** Every fact has a small "source" link that opens the quote and the page.
5. **Honest states.** "Not found", "Not verified" and "Needs research" are shown, never hidden.
6. **Nothing slow blocks the screen.** Long work runs in the background with a progress line.

## 2. Vocabulary

| Use | Instead of (prototype) |
|---|---|
| Watchlist | Saved search, discovery play, preset |
| Search now | Live search, run play |
| Lead | Candidate, converted CRM lead, opportunity |
| Genuine / Needs research / Watching / Rejected | Client-safe, needs review, weak run, blocked from save |
| Proof | Evidence trail, proof trail, source review log |
| Confidence: High / Medium / Low | Match score, run verdict |
| Score (0–100) | Buyer score, readiness, match score |
| Contact | Decision maker, role target, research slot |
| Research report | — |

## 3. Navigation

A left sidebar with 4 items: **Find**, **Leads** (with a count badge of new Genuine leads), **Settings**, and **Health** (admin only). The user menu has Profile and Log out.

## 4. Screens

### 4.1 Find

```
┌───────────────────────────────────────────────────────────────────────┐
│ Find opportunities                                                    │
│ ┌───────────────────────────────────────────────┐ ┌──────────────┐    │
│ │ What do you offer? e.g. "line pipe", "piping" │ │  Search now  │    │
│ └───────────────────────────────────────────────┘ └──────────────┘    │
│ Markets [India ✓][Saudi ✓][UAE ✓][Qatar][Oman][Norway][Malaysia]      │
│ Looking for  (•) Both  ( ) Tenders to bid  ( ) Supply / subcontract   │
│                                        [ Save as watchlist ▾ weekly ] │
├───────────────────────────────────────────────────────────────────────┤
│ ▶ Running: "line pipe · India, Saudi, UAE"                            │
│   Searched 12 of 18 sources · read 42 pages · 7 relevant · 3 new leads│
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  collecting → reading → checking → scoring      │
│   [ Cancel ]                                    [ See new leads → ]   │
├───────────────────────────────────────────────────────────────────────┤
│ Your watchlists                                                       │
│  Line pipe · IN, SA, AE · weekly · last run today 06:00 · 4 new  [⋯]  │
│  Piping works · NO, MY · daily   · last run today 06:00 · 1 new  [⋯]  │
└───────────────────────────────────────────────────────────────────────┘
```

- The text box accepts plain words. Products and disciplines from Settings are suggested as chips.
- Progress comes from `run_events` through Supabase Realtime. Stage names on the bar are fixed: collecting, reading, checking, scoring.
- The watchlist menu has Run now, Edit, Pause and Delete.
- **Empty state:** "Add your products in Settings so we know what to look for." (shown if there are no products)

### 4.2 Leads (inbox)

```
┌───────────────────────────────────────────────────────────────────────┐
│ Leads   [Genuine 18] [Needs research 11] [Watching 26] [Rejected]     │
│ Market [All ▾]  Product [All ▾]  Type [Both ▾]  Status [Open ▾]  ⤓ CSV│
├───────────────────────────────────────────────────────────────────────┤
│ ● NEW  86  High   Supply · Line pipe                                   │
│ ABC Engineering Ltd → Gas pipeline Phase 2 (India)                    │
│ • Won the EPC contract on 12 Sep (2 sources)                          │
│ • Needs 24" X65 line pipe, ~120 km                                    │
│ • Procurement manager identified                                      │
│                              [ Accept ]  [ Reject ▾ ]  [ Open → ]     │
├───────────────────────────────────────────────────────────────────────┤
│      78  High   Bid · Piping works                                    │
│ Water Authority → Transmission line package 3 (Oman) · closes 18 Oct  │
│ …                                                                     │
└───────────────────────────────────────────────────────────────────────┘
```

- **Tabs are the classes.** Default tab: Genuine. Sort by score, then newest.
- **Card:** score, confidence, lead type and product, buyer → project (country), up to 3 reasons (07 §9), and a closing date when there is one.
- **Reject** asks for a reason: wrong company, not our scope, too late, too small, already known, or other. Reasons feed tuning.
- **Only 4 filters and a CSV export.** No filter drawer.

### 4.3 Lead page

Sections, top to bottom. Each can be collapsed. The page header stays visible.

```
┌───────────────────────────────────────────────────────────────────────┐
│ ABC Engineering Ltd · Gas pipeline Phase 2        86 / 100 · High     │
│ Supply / subcontract · Line pipe            Status [Accepted ▾] Owner │
│ [ Draft email ] [ Add note ]                        Next step: [____] │
├───────────────────────────────────────────────────────────────────────┤
│ WHY THIS LEAD                                                         │
│ • EPC contract awarded 12 Sep 2026 — BSE filing ⓘ, ETEnergyWorld ⓘ    │
│ • 24" API 5L X65, ~120 km — tender BOQ ⓘ                              │
│ • Procurement manager identified — company site ⓘ                    │
├───────────────────────────────────────────────────────────────────────┤
│ PROJECT                                                               │
│ Owner: State Gas Co · Location: Gujarat → Rajasthan · Value: ₹2,400 cr │
│ Stage:  concept ─ FEED ─ tender ─●awarded─ engineering ─ procurement… │
├───────────────────────────────────────────────────────────────────────┤
│ SUPPLY CHAIN                                                          │
│ State Gas Co (owner) → ABC Engineering (main EPC)                     │
│   ├ Pipeline package — owner ABC · needs: line pipe 24" X65 ~120 km,  │
│   │   delivery Kandla port, by Q1 2027 ⓘ                              │
│   ├ Mechanical & piping — subcontract (typical for ABC) ⓘ             │
│   └ Coating — XYZ Coatings (subcontractor) ⓘ                          │
├───────────────────────────────────────────────────────────────────────┤
│ PEOPLE                                                                │
│ R. Sharma · Procurement Manager · ABC · email: domain accepts mail ⓘ  │
│ A. Khan  · Project Director    · ABC · not found                     │
│ Tender contact · State Gas Co tender cell · official ⓘ               │
│ Contact rules (India): email with opt-out ✓ · phone: 140-series only  │
├───────────────────────────────────────────────────────────────────────┤
│ BUYER HISTORY (5 years)                                               │
│ 11 projects · pipelines, refineries · India, Oman                     │
│ Usually subcontracts: piping, coating · Regular suppliers: 3 ⓘ        │
├───────────────────────────────────────────────────────────────────────┤
│ SCORE BREAKDOWN          Scope 23/25 · Timing 18/20 · Buyer 17/20 ·   │
│ ▸ expand all 17 checks   Access 16/20 · Commercial 12/15 = 86         │
├───────────────────────────────────────────────────────────────────────┤
│ COMPLIANCE TO BID / SUPPLY              (checklist, 08 §2.2)          │
├───────────────────────────────────────────────────────────────────────┤
│ RESEARCH REPORT                         generated 27 Sep · 8 sections │
├───────────────────────────────────────────────────────────────────────┤
│ ACTIVITY                                notes, status changes, drafts │
└───────────────────────────────────────────────────────────────────────┘
```

- **ⓘ** opens a side panel with the quote (highlighted), source name, tier, date, and a link to the page.
- **The score breakdown** lists each sub-criterion with its points out of the maximum, ✓ / ✗ / "unknown", and its evidence. Unknown items say "Research running" or "Not found yet".
- **Draft email** opens a panel: pick a contact → generated draft (06 §6.3) → edit → Copy → Mark as sent. It is disabled with a reason when the outreach rule is `consent_needed` or the contact has opted out.
- **Rejected-class leads** show the failed gate in a banner, e.g. "Rejected: the project was completed in 2024 (source ⓘ)".

### 4.4 Settings (admin)

Tabs:
1. **Company:** disciplines (checkboxes), adjacent disciplines, sectors, value range (minimum, sweet spot), served ports and regions.
2. **Products:** table of name, discipline, customs (HS) codes, keywords, spec ranges. Add, edit or import CSV.
3. **Markets:** the 4 market groups with country toggles.
4. **Eligibility:** certifications, portal registrations and local-content status per country, each with an expiry date.
5. **Exclusions:** competitors and do-not-contact companies.
6. **Users:** invite, and set roles.

### 4.5 Health (admin)

Queue depth per queue, last successful run per source (red if older than twice its schedule), AI tokens used today per provider against budget, dead-letter items with retry, and a sanctions review queue.

## 5. States

| State | Behaviour |
|---|---|
| Loading | Skeleton rows; never a blank screen |
| Empty inbox | "No genuine leads yet. Your watchlists run daily; the next run is at 06:00." |
| AI quota paused | Banner on Find: "Reading is paused until 00:00 UTC (free AI limit). Collection continues." |
| Source failing | Only on Health; never on work screens |
| Unknown value | Text "Not found" in grey, with "Research running" when a task exists |

## 6. Design system

- Keep the prototype's Tailwind tokens and lucide icons. Remove unused components.
- **Colours:** one accent colour for actions. Confidence colours: High green, Medium amber, Low grey. Red only for blocks and warnings.
- **Type:** 16 px base on work screens; numbers use tabular figures.
- **Accessibility:** keyboard navigation for the inbox (j/k to move, a to accept, r to reject); WCAG AA contrast; ⓘ panels reachable by keyboard.
- **Responsive:** desktop first; the inbox and lead page stay readable on a tablet.

## 7. Removed from the prototype

| Prototype element | Why it goes |
|---|---|
| Dashboard with hardcoded sample companies | Fake data |
| SuperSearch: discovery plays, presets, filter drawer, run verdict, client-safe audit, coverage and pressure panels, save lock, 7 score bars, candidates table, queues, converted-leads table, static results table | Too complex; replaced by Find + Leads |
| Leads CRM static contact table | Fake data |
| Lead Lists (3-step workflow) | Replaced by inbox filters + CSV export |
| Signals, Enrichment, Exports, Settings (placeholder) and Usage pages | Placeholders with no function |
| Company page (static) | Replaced by the lead page |
| 17-field manual contact form | Replaced by automatic contacts; a small "Add contact" form (name, title, email) remains |

All of these stay reachable under `/legacy` for admins until MVP acceptance, then they're deleted.
