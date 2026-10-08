# Scoring and CRM experience

Scoring should help the seller decide whom to approach first. It must not hide a real potential customer because project value, a phone or an email is missing. The proposed ranking replaces model confidence as the live product opportunity's displayed fit score.

## Four independent decisions

| Decision | Question | Effect |
| --- | --- | --- |
| Discovery eligibility | Is there grounded company and material-consuming evidence? | Include, retain for research, or exclude |
| Priority | Which eligible company has the strongest fit and activity? | Sort, never manufacture eligibility |
| Contact readiness | What published people, phones and emails are available? | Show coverage and optional enrichment |
| Outreach permission | Does this delivery mode and recipient pass policy? | Permit or block the action independently |

Pre-change baseline: live `fit_score` was derived from extractor confidence in `discovery/index.ts`, bypassing the legacy rubric in `scoring/`. The current local reliability branch stores deterministic activity/material priority metadata; see document07 for what was tested. The detailed rubric below remains a starting point, not a calibrated purchase probability. Maintain a shared evidence-based eligibility contract for discovery, CRM and automation; changing a legacy score does not repair source-coverage losses.

## Proposed priority rubric

These weights are engineering starting points, not calibrated probabilities:

| Dimension | Maximum | Illustrative evidence |
| --- | --- | --- |
| Product application | 40 | Explicit searched-material use outranks a supported but unconfirmed application |
| Buying-compatible work | 20 | Procurement/fabrication/installation responsibility; labor-only work needs caution |
| Recent or ongoing activity | 25 | Attributable dated work, with completion and recency checked |
| Evidence strength | 15 | Clear original identity and claim relationships; corroboration where available |

Store points plus a nullable observation state and evidence references for each dimension. Unknown activity has no established activity points but remains explicitly unknown, not proof of inactivity. Show the total as **priority points**, not purchase likelihood or AI accuracy. Keep product-fit classification and activity badge beside it so a capability-only company cannot look like a confirmed current buyer simply by accumulating other points.

Use active-first groups as defined in the evidence criteria, then priority ordering within each group with deterministic ties. Never normalize by only known dimensions to give a sparse record an inflated perfect percentage. Never reward a person/email count inside material fit. Low points do not remove an eligible company.

If a proposed automated qualification tier is added, it must require the evidence conditions, not an arbitrary score cutoff. User review can exclude a company and record a reason; it cannot invent missing evidence or email validation.

## Contact coverage

Keep separate counters for companies, named people, published company phones, published personal business phones, found emails and validated named emails. One company can have several contacts; do not count them as several buying companies.

A published general inbox can be useful to the seller, but is not a verified procurement employee. An email deliverability result does not confirm current employment or buying role. Do not infer a name from the local part of an address. Phone normalization must retain the source value and avoid guessing a country code when geography is unresolved.

## CRM semantics

Keep two views of the same opportunity dataset rather than physically moving and duplicating records:

- **Discovered:** source-backed potential customers, including incomplete contact records.
- **Verified contacts:** accepted fit plus supported current employment/role and recent provider-validated named email under the policy. It is not a list of confirmed orders.

Potential channel customers are separately labeled/filtered when the approved resale-input policy is implemented. They do not silently enter direct material-consuming or confirmed-demand counts. Directory seeds and unresolved product relationships remain research records until admission evidence exists. None of these views automatically enables email; discovery evaluation keeps delivery automation off.

Verification expiration or employment changes return a record to Discovered without losing conversation history. Company and opportunity ownership, notes and outreach should stay linked, not fork into separate CRMs.

Preserve keyword, exact searched material, country distinctions, activity status/date, product rationale, contacts, latest conversation summary and next action. One company may appear in different product searches with separate reasons and campaign context. Cross-search introduction deduplication remains independent of this display association.

## User journey and screen boundaries

Retain the established app shell and rich lead workspace; avoid another wholesale UI replacement.

1. **Overview:** selected/recent searches, per-search company counts and clear next action. No mixed global lead stream as the main view.
2. **Search and leads:** one prominent material and country search; optional advanced filters; target/budget mode visible. Group companies under supported projects, with a separate company-opportunities group where no named project is established.
3. **Lead workspace:** persistent company/material context and sidebar. Keep Overview, Contacts, Subcontractors and supply chain, Email and meetings, and Activity. Every claim and published contact should be reachable here.
4. **Outreach:** conversations, mode, actual recipient, provider status, pending replies and meeting readiness. No suggestion that demo sends reached buyers.

Contacts can be tagged by role after discovery; role selection is optional, not a mandatory search restriction. Use clear actions such as View company and contacts, Research missing contacts and View conversation. Preserve navigation back to the selected search and filters.

Keep advanced/legacy records accessible in a labeled secondary area while the new flow is proved. Never delete old records to make counters look cleaner; scoped archival or migration requires separate authorization.

## Progress wording

The UI should report, for example, pages read, unique relevant companies saved, companies with recent activity, companies with contact details and named validated contacts. These are labels, not fictional demo counts.

Render saved results progressively, but start demo enrollment only after the applicable research batch reaches a safe finalized state or explicitly approved partial state. Show Paused at research budget with Resume, rather than Finished with no buyers when unexamined work remains.

Review-needed candidates and excluded pages are available in an audit drawer, not mixed into the main prospect list. Unknown location is clearly separated from confirmed market matches. All-company, recent-activity and contact-availability filters must retain the selected search.

## Accessibility and truthfulness

Test desktop/mobile layouts, keyboard focus, readable action labels, sticky sidebar behavior and empty states. Do not hide contact tabs or essential details behind unlabeled icons. Prevent horizontal overflow in tables and ensure source links have descriptive names.

Distinguish email queued, accepted, delivered, bounced and reply received. Only show Meeting booked when the calendar event exists; show Meet link pending when conference generation is incomplete. Record actual timestamps and source dates, not the rendering time as a buying signal.
