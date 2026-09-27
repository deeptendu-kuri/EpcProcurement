# 07 · Signals, scoring and research

Owner of: how facts become signals, how signals become leads, the exact gates, criteria, sub-criteria, confidence formula, classes, research triggers, relationship-graph rules and explanations. All numbers here are the defaults in `scoring_config` version 1. They're data and can be tuned (§10).

## 1. Two kinds of lead

| Kind | The client wants to… | Buyer is… | Typical triggering signals |
|---|---|---|---|
| **Bid** | Win the contract or prequalify | The owner or tendering authority (or a main EPC tendering a large package) | `prequalification_opened`, `tender_released`, `tender_closing_soon`, `vendor_registration_opened`, `capex_plan`, `feed_awarded` |
| **Supply / subcontract** | Supply a package, materials or services to whoever is executing | The company that owns the package, usually the main EPC or a subcontractor | `contract_awarded`, `subcontract_awarded`, `supply_order_announced`, `approved_vendor_listed`, `hiring_project_roles`, `import_shipment` |

A **candidate lead** is the combination *(kind, buyer company, project, package)*, plus the client products that match that package's requirements.

## 2. Signals

**Signal types** (enum in 04): capex_plan, project_announced, feed_awarded, permit_approved, prequalification_opened, tender_released, tender_closing_soon, bid_results_published, contract_awarded, subcontract_awarded, supply_order_announced, vendor_registration_opened, approved_vendor_listed, hiring_project_roles, import_shipment, engagement.

**How a signal is built:** after `resolve`, each new or changed fact produces a signal when it matches a rule:

| Fact pattern | Signal |
|---|---|
| New tender with an open closing date | `tender_released` |
| Tender with 5–21 days to closing | `tender_closing_soon` |
| A `project_parties` row with role `main_epc` or `consortium_member` and an award date | `contract_awarded` |
| A `project_parties` row with role `subcontractor` | `subcontract_awarded` |
| A `relationships` row of type `supplied_by` with a date | `supply_order_announced` |
| A project stage event reaching `feed` | `feed_awarded` |
| A job post for a procurement, package or project role naming a project | `hiring_project_roles` |
| An approved-vendor or approved-makes list in a tender | `approved_vendor_listed` |

**Fingerprint:** one real-world event = one signal.

```
fingerprint = sha1(type | buyer_company_id | project_id | package_id | coalesce(tender_ref, '') | yyyy-mm of signal_date)
```

A second source reporting the same event adds its evidence to the existing signal, which raises corroboration (§5). It never creates a second signal.

## 3. Hard gates

A candidate must pass all 8 gates. A failed gate means class `rejected`, with the gate and reason stored.

| Gate | Passes when | Data used |
|---|---|---|
| **G1 Real company** | The buyer's `match_certainty` is 0.85 or more (§4), and its registry status isn't struck off | Registry, LEI, domain |
| **G2 In scope** | At least one package discipline is in `client_profile.disciplines` or `adjacent_disciplines`, **or** at least one requirement matches a `client_products` row | Packages, requirements |
| **G3 In market** | Project country, or buyer country for supply leads, is in `client_profile.markets` | Projects, companies |
| **G4 Live** | Project status is not cancelled or completed; stage is not operations; for bid leads the closing date is 3 or more days away (or unknown with a signal under 60 days old); for supply leads the award is under 18 months old | Stage events, tenders, parties |
| **G5 Corroborated** | The triggering signal has at least 1 Tier A evidence item, **or** 2 evidence items from independent publishers | Evidence tier, publisher_key |
| **G6 Verified facts** | Every fact used by gates G1–G5 has `quote_verified = true` and `agreement ∈ {both, rule}` | Evidence |
| **G7 Not sanctioned** | No `sanctions_matches` for the buyer (or its parent) with status `to_review` or `confirmed` | Sanctions |
| **G8 Not excluded** | The buyer isn't in `client_profile.excluded_company_ids`. Existing customers are routed to their account owner instead | Client profile |

## 4. Company-match certainty (feeds G1 and confidence)

| Match basis | Certainty |
|---|---|
| Registry ID or LEI match | 1.00 |
| Same web domain as a known company | 0.95 |
| Exact normalised name + same country | 0.90 |
| Fuzzy name (token-set ratio of 92 or more) + same country + embedding similarity of 0.9 or more | 0.85 |
| Fuzzy name only | 0.60 → goes to the human review queue |

## 5. Confidence (trust in the facts, separate from priority)

For each evidence item *j* supporting the lead's key facts (buyer, role, project, package, stage, date):

```
c_j = tier_weight × verification × freshness × agreement_weight
  tier_weight:      A = 0.85, B = 0.70, C = 0.50
  verification:     quote_verified = 1.0, otherwise 0.3
  freshness:        ≤ 90 days = 1.0, ≤ 365 days = 0.8, older = 0.5
  agreement_weight: both or rule = 1.0, single = 0.75

independent = keep the best c_j per publisher_key       # one publisher = one vote
combined    = 1 − Π (1 − c_j) over independent evidence
confidence  = combined × buyer.match_certainty
band        = high if ≥ 0.80, medium if ≥ 0.50, else low
```

**Example:** one Tier A exchange filing (0.85) plus one Tier B news report (0.70), both fresh and agreed, gives `1 − 0.15 × 0.30 = 0.955`. With a registry-matched buyer, confidence is 0.955 → **High**.

## 6. Relationship graph rules (contractor history)

- **Edges** come from P1 parties, P2 package owners, structured award data (TED, MyProcurement, Bahrain results, GeBIZ if used), supplier order announcements (the supplier's filing reveals the buyer → supplier edge), and approved-vendor lists in tenders.
- **A regular supplier** of company X for discipline D: at least **2 independent evidence items** (different publishers) of `supplied_by` or `approved_vendor_of` edges between X and the supplier in discipline D, within **36 months**.
- **Typical subcontracted package** for contractor X: a discipline D where 2 or more of X's projects in the last 5 years have a `subcontracted_to` edge in D.
- **Typical self-performed package:** a discipline D where X appears as the package owner and executor with no subcontract edge, on 2 or more projects.
- **Track record:** count of X's awards in the last 5 years overall, and within the lead's discipline or sector.
- **Predictive leads:** on a new `contract_awarded` for contractor X, a supply / subcontract lead is created for each discipline in `typical_packages_subcontracted(X) ∩ client disciplines`. The package is created with `status='planned'`, and its evidence is the award plus the history edges.

All of these are computed by `graph/insights.py` into `company_insights` after every run.

## 7. The score: 5 criteria, 17 sub-criteria, 100 points

Each sub-criterion returns points **or `unknown`**. Unknown scores 0 and is listed in `score_breakdown.unknown`, where it drives research (§8).

### C1 · Scope fit (25)

| Sub | Points | Rule |
|---|---|---|
| 1.1 Discipline match | 10 / 6 / 0 | Package discipline in client disciplines = 10; in adjacent disciplines = 6; else 0 |
| 1.2 Product / spec match | 6 / 3 / 0 / unknown | Requirement matches a client product **and** its key spec is within `spec_ranges` (grade, standard, size) = 6; product family only = 3; conflicting spec = 0; no requirement data = unknown |
| 1.3 Project type match | 5 / 3 / 0 | Project type in the client's past sectors (from client profile) = 5; related sector = 3; else 0 |
| 1.4 Size | 4 / 2 / 0 / unknown | Package or project value ≥ `min_project_value_usd` and within the sweet spot = 4; above the sweet spot = 2; below the minimum = 0 (also triggers class `watch`); unknown value = unknown |

### C2 · Timing (20)

| Sub | Points | Rule |
|---|---|---|
| 2.1 Stage window | 8 / 5 / 2 / 0 | **Bid:** prequalification or tender open = 8; FEED or budgeted = 5; concept or announced = 2. **Supply:** awarded ≤ 9 months ago, or detailed engineering / procurement stage = 8; award 9–18 months ago = 5; construction = 2; commissioning = 0 |
| 2.2 Deadline ahead | 5 / 3 / 0 / unknown | Closing or needed-by date 14–90 days away = 5; 3–13 or 91–180 days = 3; otherwise 0; no date = unknown |
| 2.3 Recency | 0–4 | `4 × 0.5^(days since latest signal / 60)`, rounded |
| 2.4 Momentum | 3 / 1 / 0 | 2 or more distinct signal types on this project or package within 90 days = 3; exactly 1 = 1 |

### C3 · Buyer strength (20)

| Sub | Points | Rule |
|---|---|---|
| 3.1 Right buyer | 6 / 3 / unknown | Buyer is the `package_owner_company_id`, or the tendering authority = 6; buyer's role typically buys this discipline (from graph insights) = 3; unknown package owner = unknown |
| 3.2 Funded / confirmed | 6 / 4 / 1 | Award confirmed or funding status FID = 6; a government tender with a published budget = 4; announcement only = 1 |
| 3.3 Track record | 5 / 3 / 1 / unknown | 3 or more awards in the last 5 years in this discipline or sector = 5; 1–2 = 3; awards only in other sectors = 1; no history found = unknown |
| 3.4 Financial health | 3 / 2 / 1 | Registry active **and** a recent filing or listing = 3; registry active = 2; unknown = 1 |

### C4 · Access and eligibility (20)

| Sub | Points | Rule |
|---|---|---|
| 4.1 Client eligible | 8 / 4 / 0 | From the compliance checklist (08): all hard requirements met = 8; some unknown = 4; any hard requirement missing = 0, plus a red warning |
| 4.2 Decision maker found | 6 / 3 / 1 / unknown | A person mapped to this package or project in a buying role (decision_maker, procurement_lead, package_manager, tender_contact) with an email that is verified or MX-OK = 6; person identified, contact unverified = 3; company channel only = 1; nobody found = unknown |
| 4.3 Route open | 4 / 2 / 1 / unknown | Open tender, prequalification or vendor registration currently open = 4; supply lead with a recent award (buyer is actively procuring) = 2; closed approved vendor list = 1 |
| 4.4 Relationship | 2 / 0 | An existing client relationship or prior contact recorded = 2 |

### C5 · Commercial value (15)

| Sub | Points | Rule |
|---|---|---|
| 5.1 Value | 6 / 4 / 2 / unknown | Package value within the sweet spot = 6; above = 4; project value only, and it's within range = 2; unknown = unknown |
| 5.2 Competition | 4 / 2 / 1 / unknown | Known bidders or approved vendors ≤ 3 = 4; 4–6 = 2; more than 6 = 1; unknown = unknown |
| 5.3 Logistics fit | 5 / 3 / 1 / unknown | Delivery site or port in `served_ports` or `served_regions` = 5; same country as a served region = 3; elsewhere = 1; unknown = unknown |

**Total = C1 + C2 + C3 + C4 + C5**, from 0 to 100.

## 8. Classification and research triggers

| Class | Rule |
|---|---|
| **Genuine** | All gates passed **and** score ≥ 70 **and** confidence band high **and** 4.1 is not 0 |
| **Research** | All gates passed and (55 ≤ score < 70, **or** score ≥ 70 but confidence medium) |
| **Watch** | All gates passed, but the stage is concept or feasibility, or 1.4 = 0, or the score is below 55 |
| **Rejected** | Any gate failed. The reason is shown in a "Rejected" tab for audit |

**Research tasks** are created for every lead in class **Research or Genuine**: one task per sub-criterion with a maximum of 4 points or more that is either `unknown` or scored below half its maximum. For Research leads they can lift the class. For Genuine leads they fill in the picture before outreach.

| Unknown sub-criterion | What the research agent tries |
|---|---|
| 1.2 Product / spec | Tender documents or BOQ, project spec pages, contractor news on the package |
| 1.4 / 5.1 Value | Award announcement value, exchange filing, budget documents |
| 2.2 Deadline | Tender page and corrigenda |
| 3.1 Right buyer | "[project] [discipline] subcontract / package award"; the contractor's filings |
| 3.3 Track record | The contractor's references page, exchange filings from the last 5 years, TED / MyProcurement awards |
| 4.2 Decision maker | Tender contact officer; company news naming a project director or procurement head; company website team page |
| 5.2 Competition | Bid-opening results (e.g. Bahrain), prequalified bidder lists, news |
| 5.3 Logistics | Project site location, nearest port named in documents |

After research, the lead is **re-scored**. It can move up to Genuine only through the same rules; research never overrides a gate.

## 9. Reasons and explanation

- **Top 3 reasons** are generated from rules, not AI: take the three highest-scoring sub-criteria and fill a sentence template with the facts behind them. For example: "EPC contract awarded 12 Aug 2026 (2 sources)", "Needs 24-inch X65 line pipe, 120 km (tender BOQ)", "Procurement manager identified".
- The lead page shows every criterion and sub-criterion, with its points, a ✓ / ✗ / "unknown" marker, and the evidence behind it.
- The **research report** (06 §6.2) adds background, history and a suggested approach.

## 10. Worked example

A contractor (buyer, registry-matched) is announced on the stock exchange as winning a gas pipeline EPC contract (Tier A). A trade-press article two days later (Tier B) confirms it and says the line pipe is 24-inch X65, 120 km. The client sells API 5L line pipe up to 48 inches, grades X52–X70, and serves the relevant port.

| Criterion | Points | Notes |
|---|---|---|
| C1 Scope fit | 10 + 6 + 5 + 2 = **23** | Pipeline discipline, spec in range, oil and gas sector, value above the sweet spot (1.4 = 2) |
| C2 Timing | 8 + unknown + 4 + 3 = **15** | Awarded 20 days ago; no needed-by date; fresh; award + hiring signals |
| C3 Buyer strength | 3 + 6 + 5 + 3 = **17** | Package owner not yet confirmed (typical buyer = 3); award confirmed; 4 similar awards; listed and active |
| C4 Access | 4 + 1 + 2 + 0 = **7** | Local-content status unknown; company channel only; recent award |
| C5 Commercial | 4 + unknown + 5 = **9** | Value above the sweet spot; competition unknown; port matches |
| **Total** | **71** | Confidence: 1 − (0.15 × 0.30) = 0.955 → **High** |

All gates pass, the score is 71, confidence is High, and 4.1 is 4 (not 0), so the class is **Genuine**. Research tasks are still created for the sub-criteria that are unknown or below half their maximum:
- **2.2 deadline** (unknown)
- **5.2 competition** (unknown)
- **4.2 decision maker** (1 of 6)
- **3.1 right buyer** (3 of 6 is exactly half, so no task)

If research finds the procurement manager with a verified email, 4.2 rises to 6 and the score to 76.

## 11. Tuning and versioning

- Every lead stores `scoring_version`. Changing weights creates a new `scoring_config` version and re-scores open leads, keeping history in `lead_score_history`.
- **Weekly tuning report:** accepted and rejected leads by class, rejection reasons, and which sub-criteria were most often wrong or unknown.
- **Tuning is manual and reviewed.** The system suggests weight changes, and a person approves them.
- **Guardrail:** Genuine-lead precision on the test set must not fall after any change (11).
