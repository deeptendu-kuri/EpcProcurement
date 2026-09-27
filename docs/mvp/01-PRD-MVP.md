# 01 · Product requirements: Lead Intelligence MVP

Owner of: who the product is for, what it must do, what it won't do, and how success is measured. The lead algorithm itself is specified in [07](07-SIGNALS-SCORING-RESEARCH.md); screens in [09](09-UI-UX-SPEC.md).

## 1. Problem

The client is an engineering and procurement (EPC) company. It wins work in two ways: by **bidding** for projects that owners tender, and by **supplying or subcontracting** packages to contractors who have already won projects. Today its sales team finds these opportunities by hand, late, and without a consistent way to judge which ones are real.

The information exists publicly, but it's scattered across tender portals, stock-exchange filings, company news and trade press, in several languages. Nobody links it up into "this contractor just won this project, needs this package, and this person decides".

## 2. Goal

Give the sales team a short, trustworthy list of **genuine leads** every week. For each lead:
- **who buys:** the company and the person;
- **what they need:** the package, materials and quantities;
- **why now:** the signal and the project stage;
- **why we believe it:** sources, with exact quotes;
- **what the client must do to be eligible:** compliance;
- **what to do next.**

It must run on free services and be simple enough to understand in one demo.

## 3. Users

| Persona | Needs | Uses |
|---|---|---|
| **Sales / business-development manager** (primary) | A ranked list of real opportunities with enough context to call or email today | Leads inbox, lead page, email drafts |
| **Bid / proposal manager** | Early warning of tenders and prequalifications, and the documents and compliance needed | Bid leads, compliance checklist |
| **Management** | Confidence that effort goes to real, winnable work | Leads inbox (read-only), summary counts |
| **Admin** (BoroTech or client IT) | Set up products, markets and users; keep the system healthy | Settings, health page |

## 4. Scope

### In scope (MVP)

| # | Capability |
|---|---|
| S1 | Login and roles |
| S2 | Client profile: disciplines, products (with customs codes and specs), markets, certifications, registrations, local-content status, exclusions |
| S3 | Watchlists (scheduled searches) and "Search now", with live progress |
| S4 | Collection from free sources in 4 market groups: India; Arab countries; Norway (A1); Malaysia (A2) |
| S5 | Extraction of projects, stages, packages by department, requirements (spec, quantity, delivery), parties (owner, EPC, subcontractors, suppliers, logistics) and people, every fact with a verified quote |
| S6 | Company matching across sources and languages, with registry and LEI checks where free |
| S7 | Relationship graph: contractor history, regular suppliers and partners, subcontracting patterns |
| S8 | Signals, gates, scoring with sub-criteria, confidence, and classification into Genuine, Research, Watch or Rejected |
| S9 | A research agent that fills missing sub-criteria and writes a cited research report |
| S10 | Contacts: official public contacts, worked-out emails with an MX check, buying-role mapping; origin and verification labels |
| S11 | Compliance: bid-eligibility checklist per lead, outreach rules per contact, sanctions screening, opt-out register |
| S12 | Leads inbox and lead page; status workflow; notes; AI email draft (copied and sent by a person) |
| S13 | CSV export of leads and contacts |
| S14 | Test set and accuracy report |

### Out of scope (MVP)

- Sending email from the platform (drafts only).
- Paid data providers: contact databases, Volza API, project databases, intent data. The provider interfaces exist, but no connectors are built.
- Visitor identification, ad audiences, mobile app.
- Bidding or document submission to tender portals.
- Multi-client (multi-tenant) operation.
- Scraping behind logins the client hasn't provided, and LinkedIn scraping.

## 5. User stories and acceptance criteria

### Epic A: Set up

**A1.** As an admin, I can enter the client's disciplines, products, markets, certifications, registrations and exclusions, so that leads fit what the client can actually deliver.
- *Accepted when:* after products are saved, the next run matches requirements to them; excluded companies never appear as leads.

**A2.** As an admin, I can invite users and give each one a role (Admin, Analyst, Sales, Viewer).
- *Accepted when:* a Viewer can't change lead status; nobody can reach any page or API without logging in.

### Epic B: Find

**B1.** As a sales manager, I can type what we sell and where (for example "line pipe, India and UAE"), press **Search now**, and watch progress in plain words.
- *Accepted when:*
  - the progress line updates at least every 10 seconds during a run;
  - the run finishes with counts (sources, pages read, relevant, new leads);
  - no run blocks the screen.

**B2.** As a sales manager, I can save that search as a **watchlist** that runs daily or weekly.
- *Accepted when:* the watchlist runs on its schedule without anyone logged in, and new Genuine leads are flagged "New" in the inbox.

### Epic C: Review leads

**C1.** As a sales manager, I see leads sorted by score, each card showing buyer, project, package or material, "why now", confidence and class.
- *Accepted when:*
  - Genuine leads appear first;
  - each card shows at most 3 reasons in plain language;
  - filters are limited to market, product, class, lead kind and status.

**C2.** As a sales manager, I open a lead and see, top to bottom:
- the project (owner, location, stage timeline, value);
- the supply chain (owner → EPC → subcontractors → packages → requirements, including quantities and delivery);
- the team map (people by buying role, with contact origin and verification);
- proof (every fact with source and quote);
- the score (criteria, sub-criteria, what's unknown);
- the research report;
- compliance;
- next step.

  *Accepted when:* every factual sentence on the page links to at least one evidence item, and unknown values say "Not found" rather than being hidden.

**C3.** As a sales manager, I can **Accept**, **Reject** (with a reason), assign an owner, and move the status through contacted → RFQ → quoted → won or lost.
- *Accepted when:* every change is logged in `activities`, and rejections with reasons feed the weekly tuning report.

### Epic D: Understand the buyer

**D1.** As a sales manager, I see the contractor's history on the lead page:
- projects in the last 5 years, sectors and countries;
- regular suppliers and partners;
- which packages they usually subcontract.

  *Accepted when:* each history item links to evidence, and "regular supplier" appears only with 2 or more independent pieces of evidence within 36 months.

**D2.** As a sales manager, I read a research report that explains background, history, the project, the people, the buying process, risks and "why now", with a suggested approach.
- *Accepted when:*
  - every sentence carries a citation and passed the fact check;
  - anything unverified reads "unknown";
  - the report regenerates when new evidence changes the lead.

### Epic E: Act safely

**E1.** As a bid manager, I see what the client must have to bid or supply on this lead (registrations, local-content certificates, certifications), each marked met, missing or unknown.
- *Accepted when:* hard requirements that are missing lower the eligibility sub-score and show a warning.

**E2.** As a sales manager, before contacting someone, I see whether email or phone is allowed for that person's country, and what I must do first (for example "include opt-out", "consent needed", "call only from a registered 140-series number in India").
- *Accepted when:* opted-out contacts can't get a draft, and sanctioned companies never appear as leads.

**E3.** As a sales manager, I can generate an email draft for a contact, edit it, copy it and mark it sent.
- *Accepted when:* the draft only uses facts from the lead, and no email is ever sent automatically.

### Epic F: Trust the system

**F1.** As management, I can see an accuracy report: how many Genuine leads the team accepted, and test-set precision per market.
- *Accepted when:* the report updates weekly and matches the targets in §7.

## 6. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | All pages and APIs require login; roles enforced by row-level security |
| FR-2 | Client profile and products editable by Admin; changes apply to the next scoring run |
| FR-3 | Watchlists with markets, disciplines, products, keywords, lead kinds and schedule |
| FR-4 | Search now creates a run with live progress; runs can be cancelled |
| FR-5 | Collection from every enabled source on its schedule; robots.txt and terms respected; per-domain rate limits |
| FR-6 | Documents de-duplicated by canonical URL and content hash; changed pages re-processed |
| FR-7 | Rules filter before any AI call; the filtered-out reason is stored |
| FR-8 | AI extraction in separate passes; every extracted fact must have a quote that code verifies on the page |
| FR-9 | Two-model agreement required for facts used in gates |
| FR-10 | Company matching using registry ID, LEI, domain, fuzzy name and embeddings; uncertain matches are flagged |
| FR-11 | Relationship graph and company insights recomputed after each run |
| FR-12 | Signals typed, dated and fingerprinted; the same event from several sources counts once |
| FR-13 | Gates, 5 criteria with sub-criteria, confidence and class exactly as in 07 |
| FR-14 | Research tasks are created for Research and Genuine leads, only for sub-criteria with a maximum of 4 points or more that are unknown or scored below half their maximum; each finding needs a quote |
| FR-15 | Research report generated from verified facts; every sentence fact-checked |
| FR-16 | Contacts carry an origin (official public, derived, licensed, client supplied) and a status (unverified, MX OK, verified, bounced, opted out) |
| FR-17 | Bid compliance checklist per lead from rules per market; outreach rules per contact per country |
| FR-18 | Sanctions screening of every company and person against the OFAC, UN, EU, UK and UAE lists; matches block the lead until reviewed |
| FR-19 | Lead status workflow and activity log |
| FR-20 | Email drafts only; never sent automatically; opt-out enforced |
| FR-21 | CSV export of leads and contacts, with evidence links |
| FR-22 | Health page: queues, source freshness, AI quota used, errors |
| FR-23 | Accuracy report from the test set and from user accept/reject decisions |

## 7. Success metrics (MVP acceptance)

| Metric | Target |
|---|---|
| Precision of **Genuine** leads (share the client's sales lead confirms as real and relevant) | 90% or more |
| Gate decisions correct on the test set | 95% or more |
| Extracted facts with a verified quote | 100% of facts shown in the UI |
| Company-matching errors on the test set | 3% or fewer |
| Genuine leads per week across the 4 markets (client's disciplines) | 15 or more |
| Research reports: sentences that pass the fact check | 98% or more; the rest are removed, never shown |
| Time for a user to understand a lead (usability test) | Under 2 minutes, with no training |
| Running cost | $0 in services (development tools excluded) |

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Cost:** free tiers only; AI usage stays under the daily budgets with 10% headroom |
| NFR-2 | **Accuracy over volume:** when unsure, classify as Research or Watch, never Genuine |
| NFR-3 | **Explainability:** every score shows its sub-criteria and every fact its evidence |
| NFR-4 | **Performance:** inbox loads in under 2 seconds with 5,000 leads; lead page in under 2 seconds |
| NFR-5 | **Resilience:** a failing source or AI provider never stops other sources; jobs retry, then go to a dead-letter queue |
| NFR-6 | **Security:** secrets server-side only; RLS on every table; the prototype key rotated |
| NFR-7 | **Compliance:** robots.txt and terms respected; business contacts only; opt-outs honoured; data-protection rules per country (08) |
| NFR-8 | **Languages:** English, Arabic and Malay sources read; UI in English |
| NFR-9 | **Maintainability:** weights, thresholds, sources and compliance rules are data, not code |
| NFR-10 | **Portability:** switching any provider needs only configuration |

## 9. Dependencies

- Client inputs: disciplines, products with specs and customs codes, certifications, registrations, local-content status, excluded companies, a sales lead for about 2 hours a week of labelling and review.
- Accounts: Supabase, Groq, Cloudflare, Oracle Cloud (or a local host), GitHub, Sentry; Etimad developer portal.
- Decisions A1–A7 in [00](00-README.md).

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Free AI quotas are too small or change | Slower processing | Rules filtering first; two providers; paid switch by configuration |
| Portals block automated reading | Missing tenders | Low request rates; official APIs where they exist; the client's own logins; tender aggregators later |
| Few verified personal contacts | Weaker "reachability" | Official tender contacts and company channels first; clearly labelled; premium providers later |
| Company matching errors | Wrong history or duplicate leads | Registry and LEI IDs first; human review of uncertain matches; matching test set |
| AI extraction errors | Wrong facts | Quote checks, two-model agreement, fact check, test set, fallback to a paid model if targets are missed |
| Legal limits on outreach | Fines, reputation | Compliance rules per contact; drafts only; opt-out register |

## 11. Open questions

1. Which European and Asian markets (A1, A2)?
2. Which disciplines and products first?
3. Does the client have Volza and portal registrations it can share?
4. Who on the client side labels leads for the test set?
