# 08 · Contacts and compliance

Owner of: how contacts are found, labelled and checked; the bid-eligibility checklist; outreach rules per country; sanctions screening; opt-outs and retention. Rules were checked on 26 Sep 2026 and are stored as data in `compliance_rules` (04 §10), so updates don't need code changes.

> This document supports good practice. It is not legal advice. The client should confirm outreach practices with local counsel in each market before sending at volume.

## 1. Contacts

### 1.1 Where contacts come from, in order of preference

| Origin (`contact_points.origin`) | Examples | Cost |
|---|---|---|
| **official_public** | Tender contact officer (CPPP authority, TED eForms contact point, portal notices); people named in stock-exchange filings, annual reports and press releases; company main phone and email on its website | Free |
| **derived** | Work email built from the company's email format (e.g. `first.last@company.com`) learned from public addresses on the same domain | Free |
| **client_supplied** | Contacts the client already has | Free |
| **licensed** (later) | Direct dials and mobiles from providers (Cognism for Europe/Middle East/Africa, EasyLeadz for India director mobiles, Apollo, Lusha, ZoomInfo) | Paid; not in the MVP |

Personal mobile numbers realistically come only from licensed providers. No provider has proven strong Gulf mobile coverage, so plan for manual research there.

### 1.2 Finding people for a package

1. From evidence already collected: P3 extraction pulls people, titles and contact details printed in tender notices, filings and news (06 §3).
2. Tender contact officer: taken from the tender record when shown.
3. Company website: the team, leadership and contact pages of the buyer, crawled weekly for companies with open leads.
4. Research agent: when sub-criterion 4.2 is unknown or weak (07 §8), targeted searches such as "[company] procurement manager [project]".
5. Title → buying role: a small AI step maps the title to `buying_role`, e.g. "Head of Contracts & Procurement" → `procurement_lead`, "Piping Package Manager" → `package_manager`. Rules handle common titles first.
6. Team map: `person_roles` links the person to the project and package, plus a `works_with_person_id` link when a source names both together (e.g. "Project Director X and Procurement Manager Y signed…").

### 1.3 Working out emails (derived)

1. Collect public addresses on the company domain from its website and documents.
2. Learn the pattern. Supported patterns: `first.last`, `firstlast`, `f.last`, `flast`, `first`, `first_last`, `last.first`. The pattern must be seen at least twice.
3. Build the candidate address for the person.
4. Run an **MX check**: the domain accepts mail → status `mx_ok`. A full mailbox (SMTP) check isn't done in the MVP, because free hosts usually block port 25 and catch-all domains give false results.
5. Label it clearly in the UI: "Derived · domain accepts mail · not verified".

### 1.4 Contact labels shown to users

| Status | Shown as |
|---|---|
| `unverified` | Grey: "Not verified" |
| `mx_ok` | Amber: "Domain accepts mail" |
| `verified` | Green: "Verified" (client-confirmed or replied) |
| `bounced` | Red: "Bounced", hidden from drafts |
| `opted_out` | Red: "Opted out", no drafts allowed |

## 2. Bid and supply compliance (per lead)

The checklist is built from `compliance_rules` where `kind='bid'`, matching the lead's market, buyer and route, and compared with `client_profile` (certifications, registrations, local content).

- Each item is **met**, **missing**, **unknown** or **not applicable**.
- Hard items that are missing set sub-criterion 4.1 to 0 (07 §7).

### 2.1 Seed rules

| Market | Rule key | Requirement | Hard | Source |
|---|---|---|---|---|
| SA | `SA_ETIMAD_REG` | Registered on Etimad to take part in government tenders | Yes (government) | portal.etimad.sa |
| SA | `SA_IKTVA` | Aramco suppliers are scored on IKTVA (localised spend, Saudi salaries and training, supplier development, R&D) | Yes (Aramco buyer) | iktva.sa |
| SA | `SA_LCGPA_MANDATORY` | Local-content authority (LCGPA): 10% price preference for national products; mandatory list; minimum local content for 233 products from 1 Aug 2026 | Depends on product | lcgpa.gov.sa |
| SA | `SA_NITAQAT` | Nitaqat: Red-band firms are barred from tenders | Yes (if operating in KSA) | hrsd.gov.sa |
| SA | `SA_ARAMCO_ARIBA` | Aramco supplier registration via SAP Ariba | Yes (Aramco buyer) | aramco.com |
| AE | `AE_ICV` | National ICV certificate (MoIAT), valid 14 months; weighted about 10–50% in evaluation | Usually | moiat.gov.ae/en/programs/icv |
| AE | `AE_ADNOC_HUB` | ADNOC Supplier Hub registration and prequalification | Yes (ADNOC buyer) | supplierhub.adnoc.ae |
| AE | `AE_PORTAL_REG` | ADGPG / Dubai eSupply supplier registration | Yes (government) | supplier.adgpg.gov.ae, esupply.dubai.gov.ae |
| QA | `QA_TAWTEEN_ICV` | TAWTEEN in-country value certification (QatarEnergy) | Usually | icv.tawteen.com.qa |
| OM | `OM_ICV` | ICV embedded in Tender Board tenders; required by PDO and OQ | Usually | tenderboard.gov.om |
| OM | `OM_ESNAD_REG` | Registration on Esnad | Yes (government) | etendering.tenderboard.gov.om |
| KW / BH | `KW_CAPT_REG`, `BH_TB_REG` | Tender board registration | Yes (government) | capt.gov.kw, tenderboard.gov.bh |
| IN | `IN_PPP_MII` | Make in India order: Class-I local supplier ≥ 50% local content, Class-II > 20%; 20% purchase-preference margin; global tender enquiries restricted below ₹200 crore | Depends on tender | dpiit.gov.in |
| IN | `IN_GEM_CPPP_REG` | GeM seller / CPPP bidder registration | Yes (government) | gem.gov.in, eprocure.gov.in |
| NO / EU | `EU_ESPD` | ESPD self-declaration (Directive 2014/24 Art. 59); thresholds from 1 Jan 2026: works €5.538m, utilities supplies/services €432k | Yes (above threshold) | ec.europa.eu |
| NO | `NO_MAGNET_JQS` | Upstream oil and gas suppliers prequalified through Magnet JQS | Usually (operators) | magnetjqs.com |
| MY | `MY_EPEROLEHAN` | MOF registration / ePerolehan for government tenders | Yes (government) | eperolehan.gov.my |
| ALL | `ALL_CERTS` | Certifications named in the tender or typical for the package (ISO 9001, API Q1, API 5L monogram, etc.) | If named | Tender documents |
| ALL | `ALL_SANCTIONS` | Buyer and parent not sanctioned (§4) | Yes | OFAC, UN, EU, UK, UAE |

### 2.2 How it shows on the lead page

```
Compliance to bid / supply                         4.1 eligibility: 4 / 8
 ✓ Etimad registration                  met
 ? IKTVA score                          unknown   → add your IKTVA score in Settings
 ✗ Aramco supplier registration (Ariba) missing   → register before prequalification closes
 ✓ ISO 9001, API 5L                     met
```

## 3. Outreach rules (per contact)

These are built from `compliance_rules` where `kind='outreach'`, using the **contact's country**, not the project's. For each contact and channel, the result is one of:

- **allowed** (with steps)
- **opt_out_only** (allowed, with a working opt-out)
- **consent_needed** (don't contact until consent exists)
- **blocked**

| Country | Email | Phone / SMS | Steps shown to the user | Source |
|---|---|---|---|---|
| **India** | allowed with opt-out, business context only. DPDP Act core duties apply from **13–14 May 2027**; data a person made public themselves is exempt | **Restricted:** promotional calls and SMS must come from a registered **140-series** number, never a 10-digit number; the recipient must be checked against the DND register (NCPR); fines ₹2 lakh → ₹5 lakh → ₹10 lakh per breach | Include opt-out; log the source of the address; phone only through a registered telemarketer setup | pib.gov.in (DPDP Rules 2025); trai.gov.in (TCCCPR 2nd amendment, 12 Feb 2025) |
| **Saudi Arabia** | **consent_needed** for direct marketing where there's been no prior interaction (PDPL Implementing Regulations; SDAIA enforces) | consent_needed | Get consent first (e.g. reply to a tender enquiry or a published procurement contact channel), or use the official procurement channel | ksapdpl.com / SDAIA |
| **UAE** | opt_out_only: the PDPL gives a right to object to direct marketing; the Executive Regulations are contested or unissued | opt_out_only | Include opt-out; stop on objection | u.ae; Chambers 2026 |
| **Qatar, Oman, Kuwait, Bahrain** | opt_out_only (conservative default until confirmed by counsel) | opt_out_only | Include opt-out | To be confirmed |
| **Norway** | **consent_needed** for electronic marketing to individuals (Marketing Act §15); generic company addresses allowed with opt-out | Businesses: allowed with care; individuals: reservation register | Prefer company addresses; consent for named individuals | lovdata.no |
| **Malaysia** | consent_needed, plus a direct-marketing opt-out (PDPA s.43; 2024 amendments in force since 1 Jun 2025) | consent_needed | Collect consent; honour opt-out | pdp.gov.my |
| **Germany** (if chosen instead of Norway) | **consent_needed**, including B2B (UWG §7) | Only with presumed consent (concrete signs of interest) | Avoid cold email | — |
| **Singapore** (if chosen instead of Malaysia) | allowed with opt-out; PDPA applies | Pure B2B marketing is excluded from the DNC rules | Include opt-out | pdpc.gov.sg |

**Engine rules:**
- Opt-outs (`opt_outs`) override everything.
- A `consent_needed` channel disables the "Draft email" button and shows the next step.
- Every draft includes an opt-out line when the country rule requires it.

## 4. Sanctions screening

| List | Access | Refresh |
|---|---|---|
| OFAC SDN + Consolidated | Free XML/CSV (sanctionslist.ofac.treas.gov) | Daily |
| UN Security Council Consolidated | Free XML | Daily |
| EU Financial Sanctions Files | Free with an EU Login account | Daily |
| UK Sanctions List (FCDO) | Free (the OFSI list closed 28 Jan 2026) | Daily |
| UAE Local Terrorist List | Free PDF/Excel (uaeiec.gov.ae) | Weekly |

OpenSanctions is **not** used, because commercial use needs a paid licence.

**Matching:**
1. Normalise names, including transliterated variants.
2. Candidates are RapidFuzz token-set ratio ≥ 90, **and** (country match **or** alias match).
3. Screen every company and person in the lead's buyer, parent and key people.
4. **Any candidate match blocks the lead (gate G7) until an admin marks it `cleared` or `confirmed`.** Decisions are logged.

## 5. Opt-outs, retention and data rights

- **Opt-out register:** email, phone or whole domain; checked before any draft, export or display of a contact as contactable.
- **Retention:** contacts unused (not on an open lead, no activity) for 24 months are deleted automatically. Evidence quotes that name them are kept only if they support a company or project fact.
- **Access and deletion requests:** an admin can find a person by name or email and export or delete their data. Deletion also adds the address to the opt-out register.
- **Minimisation:** only business contact data; no personal social profiles beyond a profile link; no photos.

## 6. Ownership

- **BoroTech:** maintains the rule tables and reviews sources quarterly.
- **Client:** confirms outreach practice with its counsel, and keeps its certifications, registrations and local-content status up to date in Settings (each item has an expiry date that triggers a reminder).
