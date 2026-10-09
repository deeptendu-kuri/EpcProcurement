# 17 · Client pilot redesign: search like Google, leads like SuperSearch, a dashboard that says what to do

Status: in progress on `feature/demo-any-country` (local, not pushed).
Audience: product owner, Codex/Claude implementers, the client demo.

## 1. What the client said, and what it means

| Client feedback | What it means for the product |
|---|---|
| "Overview should be a dashboard: an action plan and a way back to everything." | The first screen must answer *what should I do today?* and *where are my searches?* — not list raw runs. |
| "I like the SuperSearch screen. Make it the Leads page; let me filter by my searches; filters must work for what I searched; show which search a lead came from and what we can sell them; filters can stay closed until I open them." | One leads screen, built on the SuperSearch table. The *search* is the main filter. Every row shows its search and the searched product. The filter panel is a slide-over, closed by default. |
| "I'm a normal user. If I type *steel pipe* it must just work, like Google. Steel pipe has types; let me pick one and get the buyers for it. Results must be relevant: people who procure materials for engineering projects, and the smaller subcontractors below them." | Free-text material search. The app interprets the words, shows the product types as one-click choices, explains *who buys this*, and searches the whole chain: owners → EPC contractors → subcontractors → fabrication shops. |
| "Make the UI professional and simple. I must be able to go back to a search's progress." | Fewer words, one primary action per screen, consistent navigation, progress reachable from the dashboard and from leads. |

## 2. What comparable systems do (research)

- **BNC Network** (the leading Middle East project-intelligence database used by Gulf suppliers): projects, companies and products are *interlinked*; every project lists owner, consultant, contractors and subcontractors; status updates are daily; a sales-automation layer runs from lead to quote. → Our leads must link a company to the project/work that makes it a buyer, and show the chain around it.
- **Dodge / ConstructConnect** (US project leads for building-product manufacturers): suppliers win by reaching contractors *before* the tender, and filter projects by product and stage. → Lead with dated triggers (contract won, tender, capability), filter by product and stage.
- **Apollo** (B2B prospecting): search + filters (include/exclude), *saved searches*, then enroll results into an email *sequence*; a home screen of tasks. → Our loop: search → filters → automatic email sequence → dashboard of tasks (replies, meetings).

Sources: big5constructsaudi.com/sponsor/bnc-network, gulfnews.com (BNC largest UAE project database), construction.com (Dodge vs ConstructConnect), knowledge.apollo.io (saved searches, prospecting).

## 3. Where the product is today (audit, 9 Oct 2026)

| Area | Today | Gap |
|---|---|---|
| Search input | Product dropdown of 35 catalogue items; the typed text must match a catalogue name or alias *exactly* (`resolveMaterial`). "steel pipe", "seamless pipe", "seamless pipe ASTM A106" are rejected with a 422 message; catalogue keywords are not used. | Free text fails; no product types; no explanation of who buys. |
| Research | Works per catalogue product (`productId` drives queries, evidence classification, opportunity capture). Extension rounds, found-company list, junk filters, own-site checks and AI fallback were added this week. | Fine once the input maps to a product; the chain below EPCs is searched only through generic list/capability queries. |
| Leads (`/crm`) | 4 tabs (leads, contractors, subcontractors, contacts) + found-companies list, per search. | Client prefers SuperSearch. |
| SuperSearch (`/search`) | Company table across *all* saved leads, 17 working filter groups, evidence drawer, lead lists, saved searches (browser only). | Rows don't know their search (run) or the searched product; filter panel open by default; too many filters for a normal user. |
| Overview | List of searches with status, counts, "View leads", "Research details". | No action plan (replies, meetings, leads to review, companies to check); progress link is small. |
| Email automation | Search → AI buyer-fit check → intro email to approved inbox → reply analysis → slots → Google Meet. Proof shown on each conversation. | Not surfaced as actions on the first screen. |

## 4. Target experience

### 4.1 Navigation (left rail)
`Dashboard` · `Find buyers` · `Leads` · `Email & meetings` · `Settings`. SuperSearch is no longer a separate item — it *is* Leads. Old links (`/overview`, `/search`) redirect.

### 4.2 Dashboard (`/dashboard`)
1. **Action plan** — cards with a number and one click:
   - *Replies to answer* (conversations where the buyer replied and the next step is ours)
   - *Meetings* (booked and upcoming, with time and Meet link)
   - *New buyers to review* (saved in the last 7 days)
   - *Companies to check* (found by searches, not checked yet)
   - *Searches running* (with live progress)
2. **Your searches** — one row per search: material · countries · date, status (running with progress / finished), buyers saved, companies found, emails/meetings, and two buttons: **Progress** and **Leads**.
3. **Pipeline** — companies found → buyers saved → emailed → replied → meetings.

### 4.3 Find buyers (`/find`)
- One search box: *"What do you supply?"* — free text, like Google. Suggestions appear as you type.
- Under it, the app's interpretation in plain words:
  *"Steel pipe — choose a type: [Line pipe (API 5L)] [Process pipe (A106/A53)] [Stainless & duplex] [Alloy (A335)] [Casing & tubing]"*
  and *"Who buys this: pipeline EPC contractors, pipeline-laying subcontractors, oil & gas project owners."*
- Countries: any country, chips.
- One button: **Find buyers**. Advanced options stay folded.
- Never a hard rejection: if the words map to several types, the best type is pre-selected and the others are one click away; if nothing matches, the closest products are offered.
- After submit: the progress view with **buyers saved / companies found / pages read**, and links to the leads.

### 4.4 Leads (`/crm`, SuperSearch layout)
- Top bar: **Search: [Line pipe · India · 9 Oct ▾]** (default: latest; "All searches" available), keyword box, **Filters** button (slide-over, closed by default), **Search progress** button.
- Table columns: Company · Role in the chain · Why they buy (trigger + date) · Where · What we can sell (the searched product) · From search · Contacts · Email status · Fit.
- Filters that matter to a normal user first: country, role in the chain (owner / EPC / subcontractor / fabricator), buying trigger (contract won / tender / does this work), contacts available, email status; advanced filters folded.
- Row click → evidence drawer (source quote, *why they need the product*, contacts, chain, email progress).
- Below the table for the selected search: **Companies found, not checked yet** with "Check now".

## 5. Search precision plan

1. **Material interpreter** (`interpretMaterial`): scores every catalogue item against the typed words using names, short names, aliases, keywords and standards (e.g. "A106" → process pipe; "API 5L", "LSAW" → line pipe; "casing" → OCTG). Generic words ("steel pipe", "pipe", "valves") return a *family* with type chips instead of a rejection. Unknown words return the closest items.
2. **Who buys this**: a reviewed buyer-segment list per product (line pipe → pipeline EPCs, pipeline subcontractors, O&G owners; process pipe → refinery/petrochemical EPCs, piping subcontractors, spool fabrication shops; plates → pressure-vessel and tank fabricators, shipyards, steel-structure fabricators …). Shown before searching and used as search hints.
3. **The chain below**: the plan already searches triggers (contract won), lists (top contractors) and capability (company sites). The capability lane uses the buyer segments, so subcontractors and fabrication shops are searched directly, and extension rounds check found companies first.
4. **Relevance gates stay strict**: a company becomes a lead only when its own pages or a dated source show matching work; the reason is shown as *"Why they need steel plates: …"*.
5. **Capacity**: free AI tier = 200k tokens per model per day; a full search uses 60–120k. The daily fallback to the smaller model doubles capacity. A paid Groq tier (cents per search) removes the cap for the pilot.

## 6. Email automation in the loop
- Dashboard *Replies to answer* and *Meetings* come from the automation threads.
- Leads table shows each company's **email status** (not started / intro sent / replied / meeting booked).
- Evidence drawer and Email & meetings cards show the proof and "why they need it".

## 7. Delivery plan and acceptance

| Phase | Scope | Acceptance |
|---|---|---|
| A · Search that understands words | `interpretMaterial`, type chips, who-buys, no 422 for normal words, buyer-segment capability queries | "steel pipe", "seamless pipe ASTM A106", "steel plates", "casing tubing", "ductile iron pipe" all start a search; "pipe" offers types; a mismatch ("power cables" + line pipe) is still caught |
| B · Dashboard | `/dashboard` action plan, searches with Progress/Leads, pipeline; nav rename; redirects | Every search's progress is two clicks from anywhere |
| C · Leads = SuperSearch | Search filter, From search + What we can sell + Email status columns, filters slide-over closed by default, found companies, progress button | Filtering by a search shows only that search's companies; every filter changes the rows |
| D · Polish + live check | Consistent headings, plain words, mobile; one live search with email automation | Live search → leads → intro email accepted |

Risks: free-tier AI limits (mitigated by fallback; recommend paid tier for the pilot), search duration 10–25 minutes (shown honestly in progress), coverage varies by country (shown as coverage notes).

Out of scope for this pass: materials outside the catalogue as fully custom products (closest-product suggestion instead), paid project databases (BNC/MEED) integration, multi-user roles.
