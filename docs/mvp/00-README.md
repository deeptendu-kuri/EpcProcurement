# Lead Intelligence MVP: documentation set

Status: **draft for review** · Written 27 Sep 2026 · Owner: BoroTech delivery team

This folder is the single source of truth for building the MVP. Read it top to bottom once. After that, use it as a reference while building. Each document has one job. Where two documents touch the same topic, one of them owns it and the other links to it.

## What the MVP is

A lead-generation platform for an **engineering and procurement (EPC) company**. It watches public procurement signals in **India, the Arab countries, one European country and one Asian country**. From those signals it finds projects, contractors, subcontractors, packages and decision makers. It checks every fact against its source, scores each opportunity with transparent rules, and gives the sales team a short list of **genuine leads**, each with the reasons behind it, a research report and compliance guidance.

The MVP must run on **free services only**. Rules and code do most of the work. AI reads and writes text, and code checks everything AI produces.

## Documents

| # | Document | What it answers |
|---|---|---|
| 00 | README (this file) | What we're building, decisions, assumptions, glossary |
| 01 | [PRD: MVP](01-PRD-MVP.md) | Who it's for, what it must do, and how we know it works |
| 02 | [Architecture](02-ARCHITECTURE.md) | How the system is put together and how data flows |
| 03 | [Tech stack](03-TECH-STACK.md) | Every tool, why it was chosen, free-tier limits, configuration |
| 04 | [Data model](04-DATA-MODEL.md) | Every table, field, relationship and provenance rule |
| 05 | [Sources and collection](05-SOURCES-AND-COLLECTION.md) | Which sites and feeds we read in each market, and how |
| 06 | [AI layer](06-AI-LAYER.md) | Models, prompts, schemas, quote checks, quotas, evaluation |
| 07 | [Signals, scoring and research](07-SIGNALS-SCORING-RESEARCH.md) | The exact lead algorithm: gates, criteria, sub-criteria, confidence, research reports |
| 08 | [Contacts and compliance](08-CONTACTS-AND-COMPLIANCE.md) | How contacts are found and labelled; bid and outreach compliance per country |
| 09 | [UI/UX specification](09-UI-UX-SPEC.md) | The four screens, wireframes, wording, what's removed |
| 10 | [Build plan](10-BUILD-PLAN.md) | Phases, tasks, deliverables, acceptance tests, dependencies |
| 11 | [Quality and evaluation](11-QUALITY-AND-EVALS.md) | Test set, labelling guide, metrics, release gates |

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Cost | Free services only for the MVP | Client requirement |
| Client type | EPC and procurement company | Leads are both **bid leads** (owner tenders) and **supply / subcontract leads** (packages under awarded contracts) |
| Markets | India; Arab countries; one European; one Asian | Client requirement, for diversity |
| AI role | Reads and writes only; never decides a gate or a score | Accuracy and trust |
| AI models | Qwen3.8-27B (Groq free) as the main model; gpt-oss-20b (Cloudflare Workers AI free) as the second model for cross-checks | Both Apache 2.0, both free, two independent providers |
| App | Keep the existing Next.js + Supabase codebase; replace the UI with four simple screens | Reuse what works; remove what confuses |
| Pipeline | New Python worker service | Crawling, PDF, language and matching libraries are strongest in Python |
| Timeline | Not fixed in these documents | To be agreed with the client |

## Assumptions to confirm

These are working defaults. Each one is easy to change later.

| # | Assumption | Default | Where it matters |
|---|---|---|---|
| A1 | European market | **Norway** (alternative: Germany) | 05, 08 |
| A2 | Asian market | **Malaysia** (alternative: Singapore) | 05, 08 |
| A3 | Arab countries | Saudi Arabia, UAE, Qatar, Oman, Kuwait, Bahrain. Readers are built for Saudi Arabia and the UAE first | 05, 10 |
| A4 | Client's disciplines and products | To be supplied. Examples in these documents use pipeline, piping, static equipment, line pipe, plates and valves | 04, 07 |
| A5 | Client has Volza | Unknown. The design works without it | 05, 07 |
| A6 | Client supplier registrations | Unknown. Without them we read public tender lists only | 05, 08 |
| A7 | Hosting | A free Oracle Cloud VM, or a local machine for demos | 02, 03 |

## Glossary

| Term | Meaning |
|---|---|
| **Bid lead** | An owner or main contractor is tendering or prequalifying work the client can bid for |
| **Supply / subcontract lead** | A company that has won work now needs a package, material or service the client can deliver |
| **Package** | A slice of a project's scope, usually by department: civil, piping, electrical, instrumentation and so on |
| **Signal** | A dated, typed event about a company, project or package, with evidence. For example: tender released, contract awarded |
| **Evidence** | A source URL plus the exact quote that supports a fact |
| **Gate** | A pass/fail check a lead must pass before it is scored |
| **Score** | Priority from 0 to 100, calculated by rules |
| **Confidence** | How much we trust the facts behind the lead: High, Medium or Low. Separate from the score |
| **Genuine lead** | Passes all gates, scores 70 or more, and has High confidence |
| **Research report** | An automatically written, fully cited background report on a lead |
| **Relationship graph** | Who has worked with whom: owners, contractors, subcontractors, suppliers |
| **Watchlist** | A saved search that runs on a schedule |
| **Run** | One execution of a search or watchlist, with live progress |
| **Tier A / B / C source** | A: official or first-hand. B: reputable secondary. C: everything else |
| **Quote check** | Code confirms the quote exists on the source page and contains the extracted value |

## How to review these documents

1. Read 01 (PRD) and 09 (UI) to check the product is right.
2. Read 07 to check the lead algorithm matches how the client decides.
3. Read 10 to check the order of work.
4. Engineers read 02, 03, 04, 05, 06 and 11 before starting.

Put comments or changes directly in the files, or list them in a review note. Nothing is built until the assumptions above are confirmed.
