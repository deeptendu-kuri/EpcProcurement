# Hybrid implementation: evidence limits and approved deviations

Doc 16 remains the implementation authority. These notes document fixture reality, not a relaxation of its evidence guardrails or benchmark gate.

## WP3: DEWA saved article

The exact saved original in `eval/B-cables-new.json` reports 21 contracts and an aggregate AED 3 billion. Its main article does **not** name the winning contractors. The companies in “Related Articles”, “MOST READ” and “Latest Posts” belong to other stories. They cannot be attributed to these awards.

The user explicitly approved replacing the impossible ≥15 DEWA-awardee assertion with evidence-faithful tests: no invented awardees, no related-story leakage, and an explicit missing-details warning. The benchmark must still report the DEWA group as missed unless live lawful sources actually name at least five of its awardees. The aggregate value must not be assigned to invented individual contracts.

## WP3: the saved Top 25 fixture

`eval/A-linepipe-new.json` contains two different lists. The initial partial inventory inspected Spherical Insights’ **global** Top 25 pipeline construction/fabrication companies. Its original 25 names are retained for offline extraction regression testing. That publisher is on doc 16’s runtime junk-domain blocklist: the engine must not fetch or admit that page in live research.

The full inventory also contains the actual RevenueBase **India** Top 25 directory at `https://revenuebase.ai/companies/pipeline-construction-contractors/india`. The required ≥15-candidate assertion uses this exact saved original. Extracted display names contain avatar initials attached to names (for example doubled initial letters); the test preserves those source labels as identity hints instead of claiming verified legal identities. Official website corroboration remains required. Its refresh date is not an award date, and its claimed contact totals are not validated contacts in our app. A separate saved GET Global Group contractor article tests allowed roundup routing.

## Local checks so far

- WP1: typecheck, lint, 856 passing tests (2 skipped), production build passed. Commit `2327dc4`.
- WP2: typecheck, lint, 874 passing tests (2 skipped), production build passed. Commit `d6a17bb`.
- WP3 final check: typecheck, lint, 884 passing tests (2 skipped), production build passed. Ten new fan-out regressions, including the actual India directory; provider calls mocked. The package commit was amended only after all four checks passed again.
- No live searches have been run for these packages. No cloud migrations, push or deployment.
