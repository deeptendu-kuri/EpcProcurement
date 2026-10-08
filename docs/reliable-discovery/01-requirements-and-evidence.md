# Requirements and evidence criteria

This document defines which companies belong in the seller's search results. The central rule is to preserve grounded opportunities without inventing missing fields. It separates a potential customer from a confirmed purchasing requirement and a verified contact.

Status: accepted direction for the next discovery revision on 5 October 2026; implementation is pending as recorded in documents02 and06. Activity windows and review rules require benchmark calibration, not claims of current implementation.

## Required and optional information

A displayed potential customer needs an attributable company identity, an original-source link and a defensible relationship between its work and the searched material. If those are missing, it is a research seed, not an eligible prospect. All other fields can be unknown.

| Field | Minimum treatment |
| --- | --- |
| Company name | Required, supported by a source; never generated to meet a count |
| Material searched | Required immutable search interpretation |
| Buying rationale | Required, citing relevant consuming activity and labeling inference |
| Official domain | Nullable until established; a guessed domain is never contacted or trusted |
| Country | Nullable; keep headquarters, operating country and project country distinct |
| Project name and status | Nullable; no requirement to manufacture a project for a company opportunity |
| Activity event and date | Nullable; an undated services page proves capability, not recent activity |
| Person name and role | Nullable; a company inbox does not establish a person |
| Email and phone | Nullable; retain source, published status and verification status independently |
| Demand, quantity and specification | Nullable; an award or capability does not establish an RFQ |
| Summary | Nullable until a conversation exists; do not insert an imagined interaction |

Store missing values as null rather than strings such as `unknown`, `N/A` or a dummy address. In tables, render a blank or dash with an accessible explanation. Show useful source and identity information even when the remaining fields are empty.

## Prospect eligibility

Evaluate these questions independently:

1. Is this an identifiable real business according to the available source? Official company identity is evidence, not independent registry certification.
2. Does the company execute work that uses, installs, fabricates from or procures this material?
3. Does the evidence identify the searched product explicitly, or support a defensible application with uncertainty labeled?
4. Is its location compatible with the selected market, or still unresolved?
5. What evidence establishes activity, and when did the activity occur?

The target roles include EPC contractors, relevant subcontractors, installers, fabricators and system integrators. A manufacturer can qualify when it consumes the searched input to make a different product. A company supplying installation services can be a buyer of materials. Do not blacklist every page containing `supplier`, `supply` or `manufacturer`.

Continue excluding project-owner-only leads, open bids, supplier-only sellers of the searched product and unrelated competitors from the main buyer workflow. Their websites or directories can still be source locations for identifying executing contractors. Preserve an exclusion reason in research audit data.

A distributor/reseller may appear separately as a potential channel customer if original evidence establishes the relevant stocking/resale activity for the searched material. Label buying interest as inferred and procurement responsibility as unconfirmed; do not mix it into direct material-consuming buyers or confirmed demand. Merely listing a product for sale is insufficient to establish a purchasing requirement. This policy extension is not implemented in the current role validator yet.

## Product fit classifications

| Classification | Evidence | User label |
| --- | --- | --- |
| Explicit material application | Company documents installation, fabrication or procurement involving that material | Material match |
| Supported potential application | Attributable work plausibly uses it, but exact material or purchasing responsibility is unconfirmed | Potential application |
| Unresolved | Generic contractor description without a sufficiently specific material connection | Research needed |
| Incompatible | Wrong material, unrelated activity, seller-only relationship or conflicting evidence | Excluded with reason |

Examples: a gas-pipeline EPC contractor is a potential line-pipe customer; this does not prove grade or diameter. A generic pipeline contractor is not automatically a stainless or HDPE customer. A structure fabricator can consume raw steel even though it sells finished structures. Copper cable and optical fiber must not be treated as interchangeable because both contain the word cable.

Match evidence at the company and relevant work-section level. An unrelated material in a navigation menu must not disqualify the whole company; another company's activity elsewhere on a page must not qualify it.

## Current activity classifications

Proposed default freshness window: 180 days, configurable by material and market. The window is an operational prioritization choice, not evidence that procurement remains open.

- **Recent activity:** attributable dated award, mobilization, project execution update or material-related expansion inside the window. Identify the event date separately from article publication.
- **Ongoing work:** an attributable execution status with a dated update or supported schedule spanning the current date. Estimated completion must be labeled.
- **Capability only:** relevant services documented, but no dated current work found.
- **Historic or completed:** known completion or an old event without a current continuation.
- **Unknown:** no supported status. Conflicting or stale evidence creates a review flag.

Fetching a page today, finding a copyright year, or reading a list titled current does not automatically establish fresh activity. An expired approved-contractor listing proves historical registration, not current approval or a live project. A labor-only installation contract or owner free-issued material may weaken the purchasing relationship even if material fit is explicit; record that constraint rather than pretending demand.

Default to active-first groups: recent or supported ongoing work first, followed by a clearly labeled capability-only group. Rank by priority inside each group. Display their counts separately and offer an activity filter; do not mix undated capabilities into an unqualified active-buyers count. Unknown geography belongs in a location-review section and must not inflate the selected-country count.

## Evidence attribution and provenance

Use original permitted company pages and credible award/execution announcements as primary evidence. Authorized directories can identify candidates and business contacts. Search snippets are discovery hints, not final proof. Social links are useful navigation; they are not permission to bypass platform access controls.

Every claim stores document ID, original URL, captured hash, quote or table-cell span, source class, collection timestamp, source publication date when supported, activity date when supported, extraction version and verification result. Distinguish literal extraction from inferred buying rationale.

Allow company identity and capabilities to be established across verified pages for the same entity. Use documented aliases and legal-suffix normalization; never merge subsidiaries or similarly named companies merely because they share a domain. A parent-group website needs section-level entity attribution.

Optional field validation fails locally: discard an unsupported project, date or person while retaining a supported company/product relationship. Preserve supported contrary facts, including completed/cancelled work and labor-only/free-issued material constraints; blanking an extraction must not erase inconvenient evidence. Required identity/product failures prevent eligibility. Store unsupported candidates for bounded follow-up research without presenting them as buyers.

## Source access rules

Public availability is not universal permission for bulk reuse. Respect robots, site terms, licenses and confidentiality markings; do not bypass logins, CAPTCHA or technical blocks. [LinkedIn explicitly prohibits unauthorized scraping software](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software?intendedLocale=en&lang=en-us). Use authorized provider integrations or manually accessible profile links instead.

Read directories as structured records with licensing review, not arbitrary text fragments. Preserve the association between a company, its named representative and its number; a footer address or a neighboring row must not become that person's detail.

## Non negotiable assertions

- No count padding, fabricated projects, guessed personal addresses or invented job titles.
- Score does not determine whether a grounded company exists in discovery results.
- Missing contact details do not remove a grounded company.
- No dated activity means no claim of currently buying or recently active.
- A real business, relevant activity and reachable inbox are necessary distinctions, not synonyms.
- The approved demo recipient is never written into a buyer's real contact fields.
