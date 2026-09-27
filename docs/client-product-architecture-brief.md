# Industrial Buyer Intelligence: Product, Data Flow, And Roadmap Brief

## 1. Executive Summary

Industrial Buyer Intelligence is being built as a B2B sales-intelligence platform for discovering industrial buyers, tracking source-backed buying signals, finding decision-maker targets, managing lead workflow, preparing campaign lists, and exporting verified outreach-ready data.

The current build already establishes the core product workflow:

- search public project and procurement signals;
- extract company, project, requirement, and source evidence;
- save discovered candidates;
- convert candidates into CRM-style lead records;
- queue decision-maker research;
- track email verification state;
- organize accounts and contacts into lead lists;
- export list and CRM data;
- keep provider names and infrastructure details out of the client-facing interface.

The client’s target architecture is similar to a 6sense / ZoomInfo-style account-intelligence platform. To reach that level, the current product foundation will connect additional data layers for visitor identification, intent topics, enrichment, contact discovery, verification, technographics, events, hiring signals, first-party tracking, warehouse analytics, and AI reasoning.

## 2. What Is Already Built

### 2.0 Project UI Screenshot Walkthrough

The Word version of this brief includes real product screenshots for the main workflows. Each screenshot is placed near the function it explains so the client can connect the written architecture to the actual interface.

Included screenshots:

- SuperSearch command center: shows search, filters, live discovery, saved searches, and result controls.
- Leads CRM workspace: shows lead records, decision-maker targets, source-backed projects, email states, and actions.
- Lead Lists workspace: shows campaign list organization, selected list context, table layout, and export preparation.
- Dashboard overview: shows executive summary metrics, recent signals, market coverage, and next actions.
- CRM action area: shows stage, decision-maker search, verification, and source actions.

### 2.1 SuperSearch

SuperSearch is the main discovery workspace. It lets the user search by company, project, tender, product requirement, region, or keyword.

Current capabilities:

- search public web sources for industrial buyer signals;
- process multiple URLs per discovery run;
- show which URLs were checked, skipped, failed, or saved;
- reject weak or irrelevant pages;
- prioritize company announcements, tender/procurement pages, government sources, EPC news, and source-backed project pages;
- show structured candidates with company, project, location, signal type, requirements, confidence, and source URL;
- save promising candidates for later CRM conversion.

Screenshot slot:

| Screenshot | What To Capture | Purpose |
| --- | --- | --- |
| SuperSearch command bar | Top search bar, filters button, live search button, saved search strip | Shows the primary search workflow |
| Live discovery run | Running state or completed run with checked/skipped/saved counts | Shows source processing transparency |
| New candidates | Candidate cards with company/project/source evidence | Shows public discovery extraction output |

### 2.2 Advanced Filters

The app supports filters for narrowing buyer discovery and CRM-ready records.

Current filters include:

- location / region;
- project keywords;
- industry;
- employee range;
- email status;
- stage;
- confidence;
- source-backed requirement text;
- one lead per company;
- skip already-owned contacts;
- verified email only.

This follows the same product logic used by enterprise prospecting platforms: users keep the main search simple, then open filters when they need more precision.

### 2.3 Saved Searches

Saved searches allow repeated discovery workflows such as:

- GCC EPC Buyers;
- Saudi Water Tenders;
- Canada LNG Procurement;
- priority pipeline buyers;
- water infrastructure tenders.

Current capabilities:

- save current query, filters, regions, and keywords;
- apply saved searches later;
- export saved search definitions;
- keep the saved search library compact so the primary workspace stays focused.

### 2.4 Live Discovery Source Processing

This is the part that extracts real data from public sources.

Current live discovery flow:

1. User enters query and filters.
2. The search layer builds focused search queries.
3. The search provider returns public web results.
4. The source-quality layer scores each page.
5. Weak pages are skipped with a reason.
6. Strong pages are fetched and processed.
7. The extraction layer identifies companies, projects, buyer signals, product requirements, and source evidence.
8. The scoring layer assigns confidence.
9. The UI shows new candidates and source status.
10. The user can save candidates or convert them into CRM leads.

Legitimacy guardrails:

- only source-backed public evidence is shown;
- no fake contact emails are generated;
- unknown email remains unknown;
- private individual search activity is not claimed;
- exact private search keywords are not displayed unless a future approved data source explicitly provides a permitted equivalent;
- every discovered company/project should connect back to source evidence.

### 2.5 Saved Candidates

Saved candidates are company/project opportunities discovered from public sources.

Current candidate fields:

- company name;
- country / region;
- project name;
- signal type;
- product requirement summary;
- confidence;
- source URL;
- discovery date;
- stage.

User actions:

- save candidate;
- update stage;
- export saved candidates;
- convert candidate into CRM lead.

### 2.6 Candidate To CRM Lead Conversion

Saved candidates can become CRM-style company/project leads.

Current CRM lead fields:

- company / project;
- CRM stage;
- decision-maker enrichment state;
- target roles;
- email verification state;
- requirement summary;
- source evidence;
- confidence.

This is the bridge between raw discovery and sales workflow.

### 2.7 Leads CRM

Leads CRM manages discovered leads, role targets, enrichment status, and verification status.

Current capabilities:

- view converted company/project leads;
- filter by country, stage, signal, requirement, score, and email state;
- track decision-maker search state;
- queue verification actions;
- show discovered/known decision-maker targets;
- export selected rows;
- keep unverified email state visible instead of inventing contact data.

Screenshot slot:

| Screenshot | What To Capture | Purpose |
| --- | --- | --- |
| Leads CRM table | CRM rows with stage, email status, LinkedIn/profile state, source project | Shows lead-management workflow |
| Selected lead detail | Right-side detail or detail page with evidence | Shows source-backed review before export |

### 2.8 Decision-Maker Enrichment Workflow

The decision-maker workflow is designed to identify relevant people inside target accounts.

Current target roles:

- Procurement Head;
- Project Director;
- Supply Chain Manager;
- Engineering Manager;
- CEO / CXO;
- project owner / package owner;
- contracting/procurement decision maker.

Current state:

- role targeting UI is built;
- enrichment state is tracked;
- discovered or known contacts can be attached to companies;
- future provider results can flow into the same structure.

### 2.9 Email Verification Pipeline

The app models the verification lifecycle without showing unsupported email claims.

Current email states:

- Email Not Found;
- Search Queued;
- Verification Pending;
- Verified;
- Risky.

Rules:

- only verified emails should be shown as verified;
- unknown emails stay unknown;
- risky emails are separated from verified emails;
- export logic can restrict email output to verified addresses.

### 2.10 Lead Lists

Lead Lists turn accounts and contacts into focused campaign/export segments.

Current capabilities:

- create list;
- switch list;
- add companies/projects;
- add decision-maker contacts;
- show member counts;
- show company count;
- show verified email count;
- show review-needed count;
- export list as CSV;
- maintain source evidence and email state.

Screenshot slot:

| Screenshot | What To Capture | Purpose |
| --- | --- | --- |
| Lead Lists library | Campaign list cards and selected list workspace | Shows segment management |
| List detail | Companies, contacts, verified email count, export button | Shows export preparation workflow |

### 2.11 Dashboard

The dashboard is the command center for high-level review.

Current dashboard areas:

- verified account count;
- average score;
- role target count;
- contacts needing verification;
- latest source-backed signals;
- market coverage;
- priority next actions.

The dashboard is designed to help a user decide where to focus next.

### 2.12 Run Health And Client-Safe Status

Run Health explains operational state without exposing internal provider names.

Current capabilities:

- show whether discovery is connected;
- show whether persistence is connected;
- show last run status;
- show checked, skipped, failed, and saved counts;
- hide internal vendor details from client-facing UI.

## 3. What Is Actual Data Today Vs Planned Integration Data

| Area | Current State | Data Source Behavior | Future Integration Target |
| --- | --- | --- | --- |
| Public discovery | Built | Extracts from public search results and crawled source pages | Expand source coverage and ranking |
| Source-quality filtering | Built | Scores page quality and rejects weak sources | Add stronger source categories and confidence rules |
| Company/project extraction | Built | Extracts from public evidence pages | Add external company enrichment |
| Product requirement extraction | Built | Pulls requirement clues from project/tender/source text | Add structured requirement taxonomy |
| Candidate saving | Built | User saves source-backed candidates | Add automated review queue |
| CRM conversion | Built | Candidate becomes CRM lead | Add automatic enrichment triggers |
| Decision-maker roles | Built as workflow | Tracks target roles and contacts | Connect contact databases |
| Email verification states | Built as workflow | Tracks verification lifecycle | Connect verification network |
| Lead lists | Built | Groups companies and contacts | Add campaign sync and scoring |
| Visitor identification | Planned | Not inferred from public search alone | Connect visitor identification network |
| Intent data | Planned | Public topic signals only today | Connect account-level intent topics |
| Technographics | Planned | Not deeply enriched today | Connect technology-detection network |
| Company events | Planned | Public source signals today | Connect company-event source |
| Hiring signals | Planned | Public/source-backed signals possible | Connect job/hiring data feed |
| First-party tracking | Planned | Product-ready concept | Add tracking script and event ingestion |
| AI scoring explanations | Partially built | Uses source evidence and structured fields | Add full account scoring model |

## 4. Client-Requested Enterprise Stack Mapping

The client described a 12-layer B2B intelligence stack. Below is how this project maps to that architecture.

### 4.1 Website Visitor Identification

Target purpose:

- identify the company behind anonymous website traffic;
- detect repeat visits;
- identify pricing-page and high-intent page visits;
- connect visitor activity to account records.

Planned product behavior:

- account timeline shows website sessions;
- account score increases when important pages are visited;
- visitor company appears as an account signal;
- exact individuals are not claimed unless a permitted source identifies them.

Current status:

- UI and architecture can support this layer;
- first-party tracking and visitor matching are planned.

### 4.2 Intent Data

Target purpose:

- detect companies researching relevant industrial topics;
- show topic interest, surge behavior, and account-level intent.

Planned product behavior:

- display topics such as pipeline EPC, LNG procurement, water transmission tender, gas turbine subcontracting;
- show topic score, trend, and last-seen date;
- attach intent topics to account scoring.

Important client-safe clarification:

- account-level intent normally means topics/categories/signals;
- it should not be presented as the exact private words typed by a specific person unless a permitted source explicitly provides that level of data.

### 4.3 Company Enrichment

Target purpose:

- enrich accounts with industry, employee count, revenue band, domain, location, corporate hierarchy, and firmographic details.

Planned product behavior:

- company profile becomes richer;
- filters become stronger;
- scoring can include company size, sector, geography, and account fit.

### 4.4 Contact Database

Target purpose:

- find relevant decision-makers inside target accounts.

Planned product behavior:

- company record shows procurement, project, supply chain, engineering, and executive contacts;
- contacts include title, department, seniority, region, source, and verification state;
- role targets can be added to lead lists.

### 4.5 Email Verification

Target purpose:

- verify discovered emails before export or outreach.

Planned product behavior:

- email state changes from unknown/search pending to verified/risky/not found;
- verified emails can be included in export;
- unknown and risky emails remain separated.

### 4.6 Technographics

Target purpose:

- identify what technologies a company uses.

Planned product behavior:

- company profile includes detected technologies;
- search filters can target companies using specific tools or platforms;
- scoring can consider technology fit.

### 4.7 Company Events

Target purpose:

- detect funding, acquisitions, leadership changes, growth signals, and expansion activity.

Planned product behavior:

- account timeline shows relevant company events;
- recent events can increase lead priority;
- event source remains visible.

### 4.8 Job And Hiring Signals

Target purpose:

- use hiring activity as a buying signal.

Planned product behavior:

- hiring for project, procurement, engineering, maintenance, or operations roles can increase account priority;
- job-posting source appears in account evidence;
- filters can target companies hiring in specific functions.

### 4.9 Web Crawling And Search

Target purpose:

- discover companies, public pages, tenders, projects, and source-backed signals.

Current product behavior:

- this layer is already active;
- the app searches public sources, checks URLs, filters weak pages, extracts structured data, and shows the result with source evidence.

### 4.10 First-Party Tracking

Target purpose:

- track page views, sessions, repeat visits, form activity, and high-intent page engagement.

Planned product behavior:

- a tracking script records first-party product-site activity;
- the account timeline shows engagement;
- scoring uses repeat visits and high-intent pages.

### 4.11 Data Warehouse

Target purpose:

- store accounts, contacts, events, intent signals, scoring history, and run history.

Planned product behavior:

- operational records are stored in a relational store;
- high-volume event and activity data can flow to an analytical warehouse;
- reporting can show trends over time.

### 4.12 AI Layer

Target purpose:

- summarize accounts;
- reason about lead priority;
- explain scoring;
- generate personalized outreach context;
- extract structured facts from evidence.

Current and planned behavior:

- source evidence is structured into candidate and lead records;
- future AI scoring explains why an account is a good fit;
- future outreach drafts can reference verified project/source context;
- the AI layer should use OpenAI API for reasoning, summarization, extraction, and personalization.

## 5. End-To-End Data Flow

### 5.1 Public Discovery Flow

1. User searches for a project, buyer type, material, or region.
2. Search queries are generated from the entered text and filters.
3. Public source URLs are collected.
4. Each URL is checked for relevance and source quality.
5. Bad pages are skipped with reasons.
6. Good pages are processed.
7. Structured fields are extracted:
   - company;
   - project;
   - region;
   - buyer signal;
   - product requirement;
   - source evidence;
   - confidence.
8. Candidates appear in SuperSearch.
9. User saves candidates.
10. User converts candidates into CRM leads.
11. CRM leads can be enriched, verified, listed, and exported.

### 5.2 Lead Management Flow

1. Saved candidate becomes a CRM lead.
2. CRM lead gets a stage.
3. Target roles are assigned.
4. Decision-maker search is requested.
5. Contacts are attached when available.
6. Email status is tracked.
7. Lead can be added to a list.
8. List can be exported.

### 5.3 Future Enterprise Intelligence Flow

1. First-party website activity identifies account engagement.
2. Intent topics add external research signals.
3. Company enrichment completes firmographic details.
4. Contact enrichment identifies decision-makers.
5. Email verification validates contactability.
6. Technographics and company events add fit and timing signals.
7. Hiring signals add growth/buying indicators.
8. AI scoring explains why the account matters.
9. Sales users work the account through CRM, lists, and export workflows.

## 6. Function Map: What Each Screen Does

| Screen / Function | What User Sees | What It Does Behind The Scenes | Current / Planned |
| --- | --- | --- | --- |
| SuperSearch command bar | Search input, filters, live search | Builds discovery queries and starts source processing | Current |
| Filters drawer | Region, title, keyword, email, employee, list filters | Narrows discovery/results scope | Current |
| Saved Search Library | Saved/reusable searches | Stores reusable search conditions | Current |
| Live Discovery Run | Checked/skipped/failed/saved counts | Shows source-processing result | Current |
| Candidate cards | Company/project/source candidates | Displays extracted public evidence | Current |
| Search results table | Role targets and verified account rows | Lets users select, export, or list contacts | Current |
| Saved candidates | Candidate list | Stores reviewed discovery opportunities | Current |
| Converted CRM leads | Company/project lead rows | Turns candidate into CRM workflow record | Current |
| Lead detail | Company, evidence, roles, verification | Reviews one lead in detail | Current |
| Leads CRM | CRM table with filters/actions | Manages stages, enrichment, verification, export | Current |
| Lead Lists | List library and selected campaign list | Prepares segmented exports | Current |
| Run Health | Operational status and run counts | Shows client-safe connectivity/run state | Current |
| Exports | Export workflow | Produces CSV outputs | Current |
| Settings | Client-safe configuration | Shows policies without internal provider details | Current |
| Visitor Identification | Account traffic intelligence | Matches anonymous visits to accounts | Planned |
| Intent Topics | Account-level research signals | Adds topic/surge signals to scoring | Planned |
| Company Enrichment | Full company profile | Adds firmographic enrichment | Planned |
| Contact Enrichment | Decision-maker contacts | Adds people and role data | Planned |
| Technographics | Technology profile | Adds detected company technologies | Planned |
| Company Events | Funding/growth/acquisition events | Adds timing signals | Planned |
| Hiring Signals | Open roles and team growth | Adds buying/growth indicators | Planned |
| AI Scoring | Explainable lead priority | Summarizes and scores account fit | Planned |

## 7. What The Product Should Not Claim

To keep the platform credible and client-safe:

- do not claim exact private search keywords unless a permitted data source explicitly provides that level of signal;
- do not invent emails;
- do not mark unknown contacts as verified;
- do not show internal provider names in the frontend;
- do not expose infrastructure details in the frontend;
- do not imply every future data layer is already connected;
- do not export risky/unknown emails as verified.

## 8. Recommended Next Build Order

### Phase 1: Finish Current Product Surface

1. Finish final UI polish for SuperSearch, Leads CRM, Lead Lists, Dashboard, and detail pages.
2. Add better empty states and loading states.
3. Add account timeline layout.
4. Add clearer evidence drawer/detail panel.
5. Finalize export review screen.

### Phase 2: Add Provider Integration Layer

1. Create a provider abstraction for company enrichment, contact enrichment, verification, technographics, events, and intent.
2. Normalize provider responses into internal account/contact/event models.
3. Add provider health checks to Run Health without exposing provider names.

### Phase 3: Add Enterprise Intelligence

1. First-party tracking script.
2. Visitor-company matching.
3. Account-level intent topics.
4. Company enrichment.
5. Contact enrichment.
6. Email verification waterfall.
7. Technographics.
8. Company events.
9. Hiring signals.
10. AI lead scoring and explanation.

### Phase 4: Client-Ready Operating Workflow

1. Account timeline.
2. Lead scoring explanation.
3. List builder improvements.
4. Export approval flow.
5. Outreach-personalization assistant.
6. Role-based access and audit log.
7. Reporting dashboard.

## 9. Suggested Screenshot Checklist

Use these screenshots in the final client-facing deck or handoff document.

| Screenshot Number | Page / Area | What To Show | Caption |
| --- | --- | --- | --- |
| 1 | Dashboard | Buyer pipeline overview and priority next actions | Executive command center |
| 2 | SuperSearch | Search bar, filters, live search | Source-backed discovery |
| 3 | Live Discovery Run | Checked/skipped/failed/saved source status | Transparent source processing |
| 4 | Candidate Cards | New discovered accounts/projects | Extracted buyer opportunities |
| 5 | Search Results | Role targets and export controls | Source-backed contact review |
| 6 | Saved Candidates | Saved discovery opportunities | Reviewed buyer candidates |
| 7 | Converted CRM Leads | CRM stage, target roles, verification | Discovery-to-CRM workflow |
| 8 | Lead Detail | Source evidence and decision-maker area | Evidence-backed account review |
| 9 | Leads CRM | Full CRM lead table | Operational lead management |
| 10 | Lead Lists | Campaign list workspace | Export-ready segment preparation |
| 11 | Run Health | Connected/run-state metrics | Client-safe operational status |
| 12 | Exports | CSV export workflow | Data handoff and CRM import |

## 10. Client Explanation Script

The current product is the operating foundation for an industrial buyer-intelligence platform. It already supports source-backed public discovery, CRM-style lead management, decision-maker workflow, verification states, lead lists, exports, and client-safe operational status.

The client’s target architecture adds deeper enterprise data layers: visitor identification, intent topics, company enrichment, contact discovery, email verification, technographics, company events, hiring signals, first-party tracking, warehouse analytics, and AI reasoning.

The architecture is designed so each of those layers can plug into the same account, contact, event, scoring, list, and export workflow. Current public discovery creates the first source-backed account records. Future data integrations enrich those records with stronger account intelligence, verified contacts, buying signals, and scoring explanations.

The product should be described as an evidence-first system: it separates known facts, pending enrichment, unverified contacts, and verified outreach data. This keeps the platform credible while still showing a clear path toward a full 6sense / ZoomInfo-style intelligence workflow.

## 11. What Comes Next And Final Product Position

### 11.1 Immediate Next Build Priorities

The next build phase should focus on making the existing workflow feel complete before adding more data sources.

Recommended next steps:

1. Finish the account timeline view so each company has a chronological record of discovery signals, source pages, contact research, verification status, and list/export activity.
2. Add an evidence drawer so users can inspect source proof without leaving the current table or workspace.
3. Add export review so users can see exactly which companies, contacts, email states, source links, and notes will be included before downloading.
4. Add clearer enrichment states for accounts and contacts so users immediately understand what is known, what is pending, and what is ready for outreach.
5. Improve dashboard metrics so the command center reflects real discovered leads, saved candidates, list membership, verification readiness, and recent discovery activity.

### 11.2 Integration Build Priorities After APIs Are Provided

Once the required APIs are provided, the next engineering work is to connect each data layer through a clean provider interface. The frontend should not need to know which provider produced the data. It should only receive normalized account, contact, event, signal, verification, and scoring records.

Recommended integration order:

1. Company enrichment, because this strengthens account profiles, filters, and scoring.
2. Contact database enrichment, because it turns account-level leads into actionable role targets.
3. Email verification, because outreach-ready export depends on verified contactability.
4. Intent topics, because account-level research signals improve timing and prioritization.
5. Technographics, company events, and hiring signals, because these add fit and timing context.
6. First-party tracking and visitor identification, because these make the product closer to a complete account-intelligence system.
7. AI scoring explanations and outreach context, because the AI layer becomes more valuable after the account and contact data are richer.

### 11.3 Final Product Compared With The Client POV

If all requested APIs are provided and connected correctly, the end product can match the client’s 6sense / ZoomInfo-style POV in architecture and workflow.

It will match the client POV in these areas:

- account discovery;
- company enrichment;
- contact discovery;
- email verification;
- account-level intent topics;
- visitor identification;
- technographics;
- company events;
- hiring signals;
- source-backed evidence;
- lead scoring;
- CRM-style workflow;
- list building;
- export preparation;
- AI-based summaries and scoring explanations.

It can become better than the client POV in one important way: it is specialized for industrial procurement. General B2B intelligence platforms are broad. This product can be narrower and more useful for industrial buyers because it can focus on project evidence, tender activity, EPC awards, material requirements, pipeline/LNG/water/power infrastructure signals, procurement roles, and export-ready industrial lead lists.

It would be lesser than the client POV only if one or more data layers are not connected. For example, without visitor identification, it cannot identify anonymous website traffic. Without intent-topic data, it can only show public/source-backed buying signals. Without contact and verification data, it cannot reliably provide verified outreach contacts at scale.

The final position should therefore be explained clearly:

The current product is the operating system for industrial buyer intelligence. With the full API stack connected, it becomes a complete account-intelligence platform. It can match the client’s requested architecture and may become stronger for industrial procurement use cases because the workflow is purpose-built around projects, tenders, requirements, evidence, decision-maker roles, verification, lists, and exports.
