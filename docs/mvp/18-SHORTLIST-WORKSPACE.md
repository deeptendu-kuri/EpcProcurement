# 18 · Shortlist rating, search workspace and a calmer UI

Client feedback after doc 17:

- The dashboard does not look professional.
- The search a buyer came from is missing from the table.
- Keep the "SuperSearch" name, and every filter must work.
- A search should feel like a workspace (progress, minutes, tokens, the companies shortlisted).
- A steel pipe search should say plainly who will buy steel pipe, and what else we can sell them.
- Show all good companies by rating.

## 1. What the data showed (9 Oct "Steel plates" search, 5 countries)

| | |
|---|---|
| Company names collected | 125 |
| Pages read | 89 of 160 |
| AI tokens (reserved / actually used) | 237,775 / 109,393 |
| Website lookups allowed | 24 |
| Names never checked ("website not found yet") | 72 |
| **Buyers saved** | **2** |

Reading the 125 names by hand:

- **Real plate buyers (about 25):** pressure-vessel, tank and heat-exchanger fabricators, and heavy engineering firms.
- **Junk (about 30):** fuel and lubricant traders from a tank fabricator's customer list.
- **Furniture (about 25):** certifiers, social networks and web agencies.

Three causes:

1. **Nothing rated the names.** The 24 lookups were spent in the order names were found, not on likely buyers.
2. **Junk sat beside real buyers,** unranked, so the user could not see the good ones.
3. **The AI budget counted worst-case estimates, not real use.** Searches stopped at about half their allowance.

## 2. What changed

| Area | Change |
|---|---|
| Shortlist rating (`research/shortlist.ts`, migration 024) | Every named company gets a 0–100 rating for **buying the searched material**, a plain role ("Pressure vessel fabricator"), a "will buy" reason and other catalogue products it would buy. Rules handle furniture, places and sellers; one AI call rates up to 20 names, and names an answer skips are asked again. Guards keep the number consistent with the words. Queued website lookups and reads are re-prioritised by rating: 700 + rating, or the back of the queue below 25. |
| Budget (`research/store.ts`) | `aiTokensUsed` counts provider-reported tokens (`llm_usage`) for finished calls and the estimate only for calls in flight. |
| Search workspace (`/find?run=…`) | Live: time, AI tokens of the search's limit, pages read, companies found, likely buyers, verified buyers. Shortlist with Likely buyers, All found and Not buyers tabs; each row says "Will buy steel plates: …" and "Also buys: …", with Check now and Check top 5. Verified buyers show their email status. The activity log is in plain words, with repeats merged. A new search opens its workspace. |
| Leads (`/crm`) | Columns: Company (role, country, tier), **Search** (second), **Will buy**, **Also can sell**, **Rating**, Email, Contacts. One rating per company per search: the higher of the shortlist rating and the saved-lead score. |
| SuperSearch filters | Name restored. Location falls back from HQ to where the company works. The product a search found a company for is always filterable. Options no company in scope has are hidden. The selected search no longer counts as a filter or gets cleared by "Clear all". |
| Dashboard | Today (only what needs the user, one click each), Pipeline strip, Your searches (status, buyers, companies, minutes, AI tokens, Open and Leads), Meetings. |
| Design foundation (`globals.css`, shell) | Apple Human Interface Guidelines: `#f5f5f7` background, white cards with 16 px radius, near-black text with two lighter levels, hairline separators, one blue accent (`#0071e3`), soft status tints, system font, a 28 px title scale and an 8-point grid. |

## 3. Rating quality (same 125 names, three prompt rounds)

| Round | Likely buyers (≥45) | Clear mistakes among them |
|---|---|---|
| 1 · 40 per batch, page title used freely | 56 | Fuel traders rated 90; plate makers rated 90; a failed batch took its role from the page title |
| 2 · 20 per batch, retry, per-company judgment | 51 | Customer-list fuel traders still 60; composite cylinder makers 60 |
| 3 · consistency guards (seller or not-a-buyer ≤ 5, fuel traders ≤ 10, composite ≤ 30, software/licensor ≤ 20, bare name ≤ 50, place and project names 0), stored raw and applied on read | 37 → about 34 | Roughly 3 doubtful (e.g. a cutting-machine page, a process licensor) |

None of the oil traders, certifiers, platforms or place names counts as a likely buyer any more. A rating is the starting order for verification; a buyer becomes "verified" only when its own website shows matching work.

## 4. Live test: "steel pipe" (line pipe), IN · SA · AE · NO · MY, preview mode (9 Oct, 18:33 UTC)

| | |
|---|---|
| Time | 12 min |
| AI tokens (provider-reported) | 53,345 of 60,000 · 20 calls |
| Pages read / web searches | 26 of 40 / 4 of 4 |
| Names found / rated | 51 / 51 |
| Likely buyers (after guards) | about 25 |
| Verified buyers | 2 (Bravida Norge, West-team, both Norwegian building-services installers; email automation **held both for review**) |

- **Top of the shortlist (rated 85–95):** Shell, Petronas, TechnipFMC, McDermott, Subsea 7, QatarEnergy, PTTEP, TotalEnergies, Dialog Resources, PetroVietnam, ADNOC, ExxonMobil, Chiyoda. These are real line pipe buyers: offshore and gas operators, and EPCI pipe-lay contractors.
- **Set aside by rules or guards:** Welspun and East Pipes (pipe makers, i.e. competitors); wind-farm companies (the AI said "not a line pipe buyer" yet rated them 70, now capped at 5); project names such as Ichthys LNG and North Field Expansion (rated 0: the owner or contractor is the buyer).

**Reading:** rating now puts the right companies at the top. In preview mode (4 web searches), verification still reaches only a few companies, and not the best ones. "Check top 5" in the workspace verifies the top-rated companies on request.

**AI allowance:** the live run plus three re-rating passes used the day's Groq allowance. Ratings made while the allowance is used up are plain-rule guesses, marked as such. "Rate N with AI" (and the end-of-search pass) re-rates them once the allowance resets at 00:00 UTC.

## 5. Open items

- **Cloud deploy:** migration 024 must be applied (`pnpm db:migrate`) before deploying. Not done; needs approval.
- **Website lookups (24 per search):** still the hard limit on how many companies get verified. With rating, they now go to the best names first. Raising the limit costs search credits.
- **Ratings are suggestions:** they come from one sentence and a page title, and are never shown as proof.
