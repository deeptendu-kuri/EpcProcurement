# 15 · Supply-chain explorer and contacts across the chain

Owner of: the buyer-first page, the supply-chain tree (tiers), link confidence, the company directory, derived buyers, contacts across the chain, and the small fixes approved on 28 Sep 2026. **Wins over docs 07–14 where they differ.** Mockup: `docs/mvp/mockups/buyer-chain.html` and `06-buyer-page-supply-chain.png` (Read the PNG).

Customer requirement: *as many buyers from the supply chain as possible.* If company A wins work, A buys from B; B buys from C, D, E, F. Every one of them can buy from the client (a supplier of pipes and construction materials), and we need their contacts. Relationships must come from evidence or clearly labelled inference ("intelligence"), never invented.

## A. Buyer-first wording and cleanup
1. Never show "EPC", "owner", "project owner", "main contractor" as labels. A buyer is shown as **Buyer · {what they do}** in plain words, from the sub-role: Pipeline builder, Plant builder, Water/sewer contractor, Pipe maker, Valve maker, Bends/fittings maker, Fabricator, Stockist, Coating company, Drilling/crossing contractor, Civil contractor, Electrical contractor, Testing lab, Oil & gas company, Utility, Municipality (+ "· open tender" when they run a tender).
2. Remove from the buyer page: Project section (owner, stage timeline), "Project chain", owner contact cards. The deal is one context line: "won a gas pipeline contract worth INR 40B (Sep 2026)".
3. **One row and one page per buyer company.** Leads of the same company (after name merging) are grouped: the row shows the strongest deal and "+2 more deals"; the page lists all deals (title, date, value, sources).
4. Consultants and engineering firms (e.g. names or text with "consult", "rådgiv", "engineering consultants") are not buyers: when a tender is issued by a consultant for a named client, the client is the buyer; otherwise stage "Not a buyer" with reason "Consultant — specifies, does not buy".
5. Wholesalers (wholesaler, grossist, "distributor", "trading", "stockist", "rørhandel", "VVS-grossist") → Stockist (distributor), never a builder.

## B. Supply-chain tree
- Config `src/mvp/config/supply-map.json`: for each "what they do", the supplier types they buy from, with what each supplies. Minimum:
  - Pipeline builder → Pipe maker (line pipe) · Valve maker (pipeline valves) · Bends/fittings maker · Coating company (field-joint coating) · Drilling/crossing contractor · Stockist (fittings, flanges, bolting) · Civil contractor.
  - Plant builder → Pipe maker (process pipe) · Valve maker · Fabricator (spools, structures) · Stockist · Electrical contractor · Insulation/painting company.
  - Water/sewer contractor → Pipe maker (DI, HDPE, GRP) · Valve maker · Pump supplier · Stockist · Civil contractor.
  - Pipe maker → Steel plate/coil mill · Coating powder supplier · Welding consumables maker · Testing lab.
  - Valve maker → Forging/casting shop · Bolting maker · Gasket maker · Testing lab.
  - Fabricator → Pipe maker · Stockist · Welding consumables maker · Steel mill.
  - Stockist → Pipe maker · Fittings maker · Valve maker.
  - Oil & gas company / Utility / Municipality (tender) → Pipeline builder or Plant builder or Water contractor (the contractor not yet named).
- Each supplier type maps to a buyer sub-role so its "would buy from you" comes from the existing needs map (doc 14 §5) and competitor check.
- Tree: tier 1 = the buyer (won the work); tier 2 = its supplier types; tier 3 = supplier types of each tier-2 node (expand on demand). Max depth 3.
- **Link status per node:** `confirmed` (a source states the relation, e.g. "X bags order from A", supply contract, subcontract) · `likely` (worked together before in our data: ≥ 1 earlier deal or supply relation between the two) · `possible` (a company in the directory makes/stocks what is needed, same country or region) · `not_identified` (type known, company unknown). Show the reason and evidence ids.
- A node may hold one identified company plus up to 5 **candidates** (for possible / not identified), each with why ("makes line pipe in India").
- Users can **set the company** of a node manually (name → creates or links a company; link becomes `confirmed` with source "your team"), and remove a wrong one.

## C. Company directory
- Table `company_capabilities` (company_id, item/category or supplier type, country, source: `observed` | `seed` | `user`, evidence/url). Filled from: companies observed in our data with roles/products (e.g. pipe makers from supply orders), `known-companies.json`, a small **seed list** of well-known manufacturers only when you can cite the company's own website URL for what it makes (WebFetch to check; mark `seed`), and user entries. Ready for API import later.
- Used to propose `possible` candidates (same country first, then region: GCC, South Asia, SE Asia, Nordics/Europe).

## D. Derived buyers in SuperSearch
- Identified tier-2/3 companies (confirmed/likely/possible) appear as buyers in SuperSearch with **Tier** (1/2/3) and **Found via** (the tier-1 deal). Rows without a stored lead are "derived"; **Save as buyer** / Good lead / Add to list create a lead (kind supply_subcontract, class research) for them.
- New filter group **Supply chain tier** (Tier 1 won the work · Tier 2 · Tier 3) and **How we know** (confirmed/likely/possible).

## E. Contacts across the chain
- **All contacts in this supply chain** table on the buyer page: rows = every node × buying-team slot (doc 14 §8) across tiers; columns Tier · Company · Person/role · Why them · Status (Not found / Likely / Confirmed / Company first) · Action (Find · + Add / Find candidates). Filters: tier, decision makers only. Counts "N people to approach · M found".
- **+ Add contact** modal: name, title, email, phone, LinkedIn URL, notes → stored as a person + contact points (`source = manual`), status Likely; **Confirm decision maker** → Confirmed (activity logged). Table `contact_points` (person_id, kind email|phone|linkedin, value, source, verified_at).
- SuperSearch **Contacts** switch must work: lists slots and people across all visible buyers and their chains, with the same actions.
- Structure ready for providers (Apollo/Cognism fill slots; Volza adds `likely` links) — no provider code now.

## F. Fixes
- Groq: on HTTP 400 "failed to generate JSON" retry the same document once with a stricter "JSON only" instruction (and without response_format if it fails again, then parse the first JSON object); fall back to rules **for that document only**, never disable the model for the rest of the run.
- Re-apply the place-name rule to stored companies on startup (e.g. "Shankar Chowk") → mark their leads Not a buyer.
- Contacts switch bug (see E).
