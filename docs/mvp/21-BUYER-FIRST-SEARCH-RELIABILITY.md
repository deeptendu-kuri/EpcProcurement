# Buyer-first search reliability — 11 October 2026

## Decision and scope

The buyer company is the discovery result. A named employee, phone or validated
email is an independent enrichment result, not an admission requirement.
Missing contacts remain blank. No invented people, email patterns or company names.

This change extends the existing hybrid sourcing, durable jobs and email funnel.
It does not replace them, add a model/provider, raise limits, migrate a database,
contact actual companies or scrape LinkedIn/search-result HTML.

## Why the paused demonstration failed

The stainless-pipe IN/CA/AE run was user-paused with saved work and no email thread.
Manual eligibility required a completed run and only recognised done/partial
research, although its message mentioned paused research. A real paused session
keeps its parent run running. The navigation button merely opened a tab; the
actual queue action was hidden under Advanced.

Automatic top-three enrollment deliberately waits until the search finishes.
That policy stays unchanged. Manual selection now accepts a paused/running pair
after buyer-fit review and original evidence checks, with the existing suppression,
worker, daily budget and duplicate protections. It does not resume/finish research.

## Pipeline changes

| Stage | Decision |
|---|---|
| Paid query planning | Work-based trigger, company and contractor-list requests share an initial priority tier, so news cannot consume the entire Quick allowance first. Generic work terms such as plant are replaced with the actual use phrase. |
| Before fetch | Existing junk rules remain; daily-price feeds and site-policy pages are excluded. |
| Before article AI | Reject unrelated finance/labour stories, historical articles beyond the current-work window, and pages without relevant consuming work/business signals. Keep stored originals for audit. |
| Model input | Use a literal excerpt beginning at a substantial business paragraph, past short navigation lines. It is never a generated summary or search snippet. |
| Need check | Check the item's use and the company's own role first. Rejected work receives no further project/comparison extraction. Quotes must match the stored page, not merely a fuzzy model paraphrase. |
| Save buyer | Accepted, source-backed work is saved immediately, before the search drains. No contacts required. Company investigations and lists take priority over ordinary articles. |
| Seller exclusion | Manufacturing the searched material is not buying it. A fabricator that uses/buys it as input or installs it can still qualify. |
| AI cost control | Skip optional comparison while Cloudflare's account circuit is open; honour Retry-After or daily reset. Buyer research does not request the paid P3 people pass. Ratings cannot bypass the shared run budget. |
| Demo fit | Discovery and outreach recheck the same accepted, literal, company-attributed work proof. Applications are inferred potential demand, never a confirmed order or exact grade. A different material in the company's own package is not silently substituted. |
| Paused UI | Visible Start demo email action; explicit distinction between saving fit review, opening the workflow and queueing an email. Show missing setup/worker readiness. |

## Evidence and limits

Named work in a relevant application can establish a potential buyer even without
a currently published RFQ. It cannot establish the exact ASTM grade, specification,
quantity, purchasing window or email address. Those remain unconfirmed unless
separately evidenced. A dated contract helps prioritise; a contract win is not
mandatory for a company with documented consuming capabilities.

Budget reservations remain conservative after uncertain provider acceptance. The
first failed call is not refunded speculatively. The circuit is process-local;
it prevents subsequent calls while this server stays up, not across a restart.
Existing provider caps, thread caps and approved-inbox restrictions are unchanged.

## Verification

Offline public-page fixtures are preserved in
src/mvp/research/fixtures/buyer-first-pages.json, copied from the stored October 11
search, not fetched again:

- Worley's Canadian Heartland EPC announcement: retain as potential stainless
  process-piping work, explicitly not confirmed ASTM A312 TP316L demand.
- BUTTING's quoted manufacture-of-pipes statement: not consuming-work proof.
- The 2008 Canadian refinery story: no current-work AI analysis.
- The Visakhapatnam contract-workers strike: no procurement AI analysis.
- The UAE desalination EPC article: retained source context, not an invented pipe order.

Tests cover immediate saving during active research with zero people/contact
records, lane coverage under a three-country Quick allowance, shared work proof
for demo qualification, paused manual enrollment, idempotency, optional-provider
circuits, missing-worker UI and the existing full regression suite.

Live lead counts, token savings, search duration and actual inbox delivery are NOT
established by these offline fixtures. A new bounded live rehearsal after deployment
is needed before making a production-quality or volume claim. Do not resume the
old expensive run automatically.

Local verification on 11 October 2026: typecheck and lint passed; the full regression suite
passed with 1,570 tests and 9 skipped (158 test files); the normal Next.js 16.3.3
production build passed. Providers and delivery were mocked in the new tests;
no live search, real email, cloud migration or deployment was performed.

## Deployment handoff

Local branch: fix/buyer-first-search, based on deployed main d239ebf.
No migration, new API key, recipient parameter or env-limit change required.
Run typecheck, lint, the full tests with two workers and the production build.
Push/deploy only after approval; retain the old deploy for rollback.

Rehearsal: one Quick search, automation enabled, no auto-pause. Verify genuine
buying work and literal citations, missing contacts still visible, and at most
three demo introductions only to the configured approved inbox after completion.
Separately pause a run and manually queue one reviewed saved buyer; verify that
research remains paused and no duplicate introduction occurs.
