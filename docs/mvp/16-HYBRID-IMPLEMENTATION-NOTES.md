# Hybrid implementation: evidence limits and approved deviations

Doc 16 remains the implementation authority. These notes document fixture reality, not a relaxation of its evidence guardrails or benchmark gate.

## WP3: DEWA saved article

The exact saved original in `eval/B-cables-new.json` reports 21 contracts and an aggregate AED 3 billion. Its main article does **not** name the winning contractors. The companies in “Related Articles”, “MOST READ” and “Latest Posts” belong to other stories. They cannot be attributed to these awards.

The user explicitly approved replacing the impossible ≥15 DEWA-awardee assertion with evidence-faithful tests: no invented awardees, no related-story leakage, and an explicit missing-details warning. The benchmark must still report the DEWA group as missed unless live lawful sources actually name at least five of its awardees. The aggregate value must not be assigned to invented individual contracts.

## WP3: the saved Top 25 fixture

`eval/A-linepipe-new.json` contains two different lists. The initial partial inventory inspected Spherical Insights’ **global** Top 25 pipeline construction/fabrication companies. Its original 25 names are retained for offline extraction regression testing. That publisher is on doc 16’s runtime junk-domain blocklist: the engine must not fetch or admit that page in live research.

The full inventory also contains the actual RevenueBase **India** Top 25 directory at `https://revenuebase.ai/companies/pipeline-construction-contractors/india`. The required ≥15-candidate assertion uses this exact saved original. Extracted display names contain avatar initials attached to names (for example doubled initial letters); the test preserves those source labels as identity hints instead of claiming verified legal identities. Official website corroboration remains required. Its refresh date is not an award date, and its claimed contact totals are not validated contacts in our app. A separate saved GET Global Group contractor article tests allowed roundup routing.

## Local checks so far

WP7 introduces a shared 560px evidence drawer and session-protected evidence APIs. Source cards group original-text-rechecked quotes inside full sentences. All four tables, SuperSearch and workspace source buttons use the same drawer; j/k/Esc and shareable `open` state are supported. Company-only evidence does not invent a product opportunity or named contact. Activity labels distinguish user notes and approved-inbox demo state, without exposing arbitrary recipients. Legacy evidence panels remain available to unrelated pages.

WP6 replaces duplicate CRM cards/tables with one search-scoped four-tab table read model. Company names, triggers, optional fields and named people are rechecked against original stored text. Unproved/manual/provider-only contacts remain editable in the existing workspace, but are not represented as quote-proven people in these tables. Email/phone values are withheld server-side unless checks are fresh and provider-backed; role confirmation alone is insufficient. Existing lists, contact editing and approved-inbox demo routes are reused, without new recipient parameters. Tables preserve missing contacts and blank optional fields. Subcontract rows require stored chain links with quotes naming both parties; unproved legacy AVK/Jindal rows are not manufactured.

WP5 persists verified triggers and operating countries, resolves name variants before opportunity insertion, and records roundup provenance. Replayed KPIL extraction is idempotent; same company/value (±15%)/dated reports (≤30 days) union their evidence. A `+` in the actual ₹4,000+ crore headline no longer makes the rules parser lose the crore multiplier. USD equivalents use the existing approximate fixed conversion rates, not live FX. The saved West-team TED notice proves an award and value, but only has a **publication** date: its award date stays unknown. Confirmed subcontract edges require a quote naming both companies. The legacy run-C AVK/Jindal derived rows have no award proofs and must not be upgraded to confirmed links merely to satisfy an acceptance example.

WP4 regressions preserve 20 original A/B pages (19 company/investigation pages plus the rejected World Nuclear Association page), not 20 distinct positive companies. Service, contact and archive pages are tested in corroborated same-company bundles: a contact page alone does not prove material-consuming work. Headquarters are never replaced with work geography, branch offices are not headquarters, and copyright/fetch dates are not award dates. The Jan De Nul Belgian-HQ scenario is explicitly labelled Example; the real Abu Dhabi work quote is unchanged.

- WP1: typecheck, lint, 856 passing tests (2 skipped), production build passed. Commit `2327dc4`.
- WP2: typecheck, lint, 874 passing tests (2 skipped), production build passed. Commit `d6a17bb`.
- WP3 final check: typecheck, lint, 884 passing tests (2 skipped), production build passed. Ten new fan-out regressions, including the actual India directory; provider calls mocked. The package commit was amended only after all four checks passed again.
- WP4: typecheck, lint, 916 passing tests (2 skipped), production build passed. Thirty-two new regressions cover original A/B pages, company hygiene, headquarters versus work geography and sourced activity labels. Two heavy offline integration tests now have explicit 30-second limits after a measured five-second timeout; no assertions were removed.
- WP5: typecheck, lint, 929 passing tests (2 skipped), production build passed. Thirteen trigger/deduplication regressions include saved run-C originals, publication-versus-award dates, original-text rechecking and evidence-required subcontract links. The migration runner's expected local migration count is now 23.
- WP6: typecheck, lint, 949 passing tests (2 skipped), production build passed. Twenty additional table/API/UI regressions cover search scoping, honest role slots, original-text rechecking, fresh provider validation, ended roles, actual contact-role filters, paging/sorting and CSV injection protection.
- WP7: typecheck, lint, 966 passing tests (2 skipped), production build passed. Seventeen additional source/API/drawer regressions cover real saved Tekzone text, original mutation, samples/snippets, company-only evidence, strict route inputs, all four table entry points, keyboard navigation and safe source links.
- No live searches have been run for these packages. No cloud migrations, push or deployment.
