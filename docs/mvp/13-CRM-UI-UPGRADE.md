# 13 · CRM UI upgrade (after the showcase slice)

Owner of: the second iteration of the showcase UI. It makes the app look and feel like a modern, simple CRM; adds richer filters, pagination, automatic refresh and a guided tour. **Where this file and 09 differ, this file wins** (09 asked for 4 filters and no dashboard; the client now wants more filters and an overview).

Rules for this iteration:
- Keep it simple: one job per screen, plain words, nothing that needs training (the tour covers the rest).
- No fake data. Sample leads only when the user asks for them or live sources fail, always with the "Sample data" badge.
- **One commit, only when every check in §9 passes.** No partial commits.

## 1. What changes, in one table

| # | Change | Why |
|---|---|---|
| U1 | **Modern CRM shell**: collapsible sidebar, top bar with global search, fluid responsive layout, toasts, skeletons, smooth transitions | Looks like a product, not a prototype |
| U2 | **Overview** page (new home): 4 KPI tiles, leads by market and by category, latest leads, last refresh | The client sees value at a glance |
| U3 | **Leads**: table view (default) + cards view, quick-preview drawer, **filters built from the data**, sort by *Latest*, **pagination** | Finds the right lead fast |
| U4 | **Pipeline board**: leads by status (New → Accepted → Contacted → RFQ → Quoted → Won / Lost), drag to move | The CRM part: follow leads to a deal |
| U5 | **Lead page** refresh: two-column layout, in-page section nav, right rail with status, next step, contacts, compliance summary, draft email | Easier to read and act |
| U6 | **Saved searches with auto-refresh** (default every 6 h while the app runs) + "Updated x min ago" + *Refresh now* | Answers "when does the data update?" |
| U7 | **Guided tour**: starts on first login, can be restarted any time from *Help*, walks through the whole flow across pages | The client learns the tool in 2 minutes |
| U8 | **Load sample leads** button on empty states (clearly badged) | The tour and a demo never show an empty screen |

## 2. Shell (U1)

- **Sidebar** (collapsible to icons; hamburger on mobile): Overview · Find · Leads · Pipeline · Settings · Help (Take the tour, Keyboard shortcuts). Leads shows a count badge of new Genuine leads. The "Demo mode: AI simulated" badge stays when no AI keys are set.
- **Top bar**: global search (company or project, jumps to the lead), *Search now* shortcut, last refresh ("Updated 12 min ago"), user menu (Log out).
- **Look**: neutral greys, one accent colour, 8-px spacing, rounded cards, subtle shadows, tabular numbers, WCAG AA contrast, visible focus rings. System font stack (no build-time font download).
- **Feel**: skeleton loaders (never a blank screen), optimistic Accept/Reject/status changes with an *Undo* toast, 150–200 ms transitions, sticky headers, filter state kept in the URL (back button and shared links work).
- **Responsive**: desktop first; works on tablet and phone (table becomes cards under 768 px; drawers become full-screen sheets).
- **Keyboard**: `/` search, `j`/`k` move, `a` accept, `r` reject, `o` open, `?` shortcuts list.

## 3. Overview (U2)

```
┌ Overview ──────────────────────────────────────── Updated 12 min ago [Refresh now] ┐
│ [ New this week 14 ] [ Genuine 6 ] [ Tenders closing ≤14 days 3 ] [ In pipeline 5 ] │
│ Leads by market  ▇▇▇▇ India 9 · ▇▇ Saudi 4 · ▇ UAE 2 …                            │
│ Leads by category ▇▇▇▇ Pipeline 8 · ▇▇ Piping 5 · ▇ Valves 2 …                     │
│ Latest leads (5)                                           [See all leads →]       │
│ Saved searches: Line pipe · IN SA AE · every 6 h · last run 10:02 · 3 new          │
└────────────────────────────────────────────────────────────────────────────────────┘
```
Charts are simple CSS bars (no chart library). Clicking a bar opens Leads with that filter.

## 4. Leads (U3)

**Top row:** class tabs as a segmented control with counts: Genuine · Needs research · Watching · Rejected · All.

**Filter bar** (always visible, one line, wraps on small screens):

| Filter | Values | Notes |
|---|---|---|
| Search | free text | company, project, product |
| Category | discipline: Pipeline, Piping, Static equipment, Valves, … | **options come from the leads in the database, with counts** |
| Market | country | from data, with counts |
| Type | Bid · Supply / subcontract | |
| Stage | Tender open · Awarded · Engineering · Procurement · Construction … | from data |
| Status | Open (default) · New · Accepted · Contacted · RFQ · Quoted · Won · Lost · All | |
| Added | Any time · Last 24 h · Last 7 days · Last 30 days | "latest" filter |
| More ▾ | Confidence (High/Medium/Low), minimum score, product, source (Live / Sample) | popover |

Active filters show as chips with ✕ and *Clear all*. **Sort:** Latest (default), Highest score, Closing soon.

**Views:** Table (default) and Cards (toggle remembered per browser).
- Table columns: Score · Confidence · Company → Project · Country · Category · Type · Stage · Closing / Added · Status · actions (Accept, Reject, Open).
- Clicking a row opens a **quick-preview drawer**: reasons with ⓘ proof, key facts, Accept / Reject / Open full page.

**Pagination** (server-side): page size 10 / 25 (default) / 50, "Showing 1–25 of 132", Previous / page numbers / Next. Changing a filter returns to page 1. Page and filters live in the URL.

**CSV export** exports the current filtered set (all pages).

## 5. Pipeline board (U4)

Columns = lead statuses: New · Accepted · Contacted · RFQ · Quoted · Won · Lost (Rejected is not shown; it lives in the Rejected tab). Cards show score, company → project, country, next step. Move a card by drag and drop, or with its status menu (keyboard and touch). Every move writes an activity. Same filter bar (search, market, category, type) at the top.

## 6. Lead page (U5)

- **Header** (sticky): company · project, score / 100, confidence, type · product, "Sample data" badge when relevant.
- **Left (main)**: in-page nav tabs *Why · Project · Supply chain · People · Buyer history · Score · Compliance · Activity* (scroll to section); sections as today, restyled.
- **Right rail**: Status (select), Next step, Owner, Contacts (with contact-rule chip per country), Compliance summary (met / missing / unknown counts), **Draft email** button (disabled with the reason when consent is needed).
- The ⓘ proof side panel and the rejected banner stay.

## 7. Saved searches and auto-refresh (U6)

- *Find* gets **Save this search** (name, refresh every 6 h / 12 h / 24 h / manual). Saved searches are listed on Find and Overview with last run, new leads and *Run now*, *Pause*, *Delete*.
- A small scheduler starts with the server (Next.js `instrumentation.ts`, Node runtime only): every 5 minutes it runs any saved search whose refresh time has passed. **One run at a time** (a queue); manual *Search now* goes through the same queue.
- Repeat runs are cheap: already-read articles are skipped (URL and content hash), so AI is used only for new items and stays inside the free budget. When the daily AI budget is used up, runs continue collecting and show "AI reading paused until 00:00 UTC".
- The data only refreshes while the app is running (locally now; on a server later it refreshes around the clock).
- New table `saved_searches` (id, name, query, markets, lead_kinds, refresh_hours, active, last_run_at, last_run_id, created_at) in a new migration. On a restart, runs stuck in `running` are marked `failed` ("interrupted").

## 8. Guided tour (U7)

- Library: **driver.js** (MIT, small, no dependencies), pinned. A small controller makes it work **across pages**: the current step is kept in `localStorage`, steps are attached to elements marked `data-tour="…"`, and the controller navigates between pages and resumes.
- Starts automatically on the first login in a browser; *Help → Take the tour* restarts it; *Skip* and *Esc* end it; progress shows "Step 4 of 12".
- Steps:
  1. Welcome: what the tool does, in one sentence.
  2. Overview: KPIs and "Updated x min ago".
  3. Find: type what you offer.
  4. Markets and lead type.
  5. *Search now*: live sources and the progress line.
  6. Save this search: auto-refresh.
  7. Leads: what Genuine / Needs research / Watching / Rejected mean.
  8. Filters, *Latest* sort and pages.
  9. Quick preview, then open a lead.
  10. Why this lead and ⓘ proof (the exact quote and link).
  11. Score breakdown, confidence, compliance and contact rules.
  12. Draft email; then the Pipeline board: move leads to a deal.
- If there are no leads yet, the Leads steps offer *Load sample leads* instead of pointing at empty space.

## 9. Done means (all must pass before the single commit)

1. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass. New tests cover: filter and paging query building (including counts per category), URL filter state, scheduler queue (one run at a time, due-time logic, stuck-run recovery), tour step registry, board status moves writing activities.
2. End-to-end script against `pnpm start`: log in → Overview → Find (sample run for determinism, plus one live run) → save a search → Leads with each filter, sort and page 2 (page size 10) → drawer → lead page → proof panel → draft email → Pipeline move → tour completes all 12 steps with **no browser console errors**.
3. Screenshots at 1440 px and 390 px of every screen, looked at; no overflow, no blank states.
4. Independent reviewer passes: no regression of the showcase acceptance (12 §6), all routes still need login, no secrets, plain vocabulary (09 §2).
5. Then **one commit**: `feat(mvp): CRM UI – overview, filters, pagination, pipeline board, auto-refresh, guided tour`.

## 10. Order of work

1. Wait for the live-source tuning (in progress) to finish and commit after its own checks pass.
2. Builder implements U1–U8 (no commits).
3. Independent verifier runs §9 and reviews; the builder fixes; repeat until §9 passes.
4. Single commit; screenshots to the client-facing owner for review.

## 11. Buyer types, supplier leads and contacts (after the first client review)

- **Buyer type** on every lead: *EPC contractor*, *Subcontractor*, *Supplier* or *Owner*. It shows as a badge on cards, table rows, the preview drawer and the lead header. It's also a **Buyer type** filter with counts, and a CSV column. Rules are in 07 §1.
- **Supplier leads.** The client can sell to suppliers that won orders, so they are leads too, with a first reason saying what they won, from whom and when.
- **Owner orders without an EPC** are *Watching* leads with the task "Identify the EPC contractor".
- **Proof panel.** The ⓘ panel shows the full sentence from the source with the quoted words highlighted.
- **People and contacts.**
  - People named in the sources, with their title, company and buying role.
  - Below them, a **Find contacts** card per company on the lead (buyer, owner, EPC, subcontractors, suppliers), showing its roles, website if known, and the email rule for its country. Each card has four web searches that open in a new tab: procurement manager, purchasing contact, LinkedIn people, contact page. The app never scrapes LinkedIn or search engines, and every contact must be verified before use.
- **Clean names and places.** Orders without a project name in the text are named "<Buyer> <product> order (<Mon YYYY>)", and a location never repeats the country.
