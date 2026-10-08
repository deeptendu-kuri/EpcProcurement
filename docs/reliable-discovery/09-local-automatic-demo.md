# Local automatic demo — 7 October 2026

This is the current local workflow guide. It supersedes document 08's normal per-lead manual start instructions. No cloud deployment, database reset or real-buyer delivery is included. Changes remain on `feature/guided-prospect-workflow`.

## What is integrated

- A supported searched material keeps its exact wording through discovery, CRM, the detailed company workspace and new emails. Catalogue families still drive application matching; potential use never means confirmed demand or a grade/quantity commitment.
- Preview searches investigate two distinct consuming activities before project queries, without increasing the preview's three-request ceiling. Country ordering remains fair; a selected country is not location evidence.
- New settled searches automatically enroll original-source-backed companies for independent buyer-fit qualification, including partial research. Active/cancelled searches, samples, rejected companies and missing own-search evidence cannot enroll. Research remains partial; it is not relabelled complete to send a demo.
- The automatic AI qualification accepts separately corroborated company-owned identity and services pages. Both original documents must be in the same search, the known company domain must match, literal source quotes must survive, and other companies' work must not be borrowed. Reference score never bypasses evidence or blocks a supported company by itself.
- Malformed optional operating-location claims are discarded, not converted into evidence and not allowed to erase a grounded company. The extraction prompt explicitly requests country/quote objects. Outreach receives an explicit list of material-consuming evidence IDs so it can distinguish identity/location from product-work quotes.
- One qualifying prospect per new search starts an approved-inbox conversation automatically. No routine Confirm fit, Start workflow or Send action is required. Historical searches and paused conversations do not replay. The legacy explicit saved-prospect override remains collapsed under Advanced.
- The seller introduces procurement support for the searched product. Groq qualifies fit and interprets actual plain-text replies; the initial message is a grounded seller template. It does not self-train or invent seller credentials, awards, stock, quotations or supply commitments.
- Real replies are received through the tokenized Resend receiving address. Sender authentication, conversation binding, deduplication and deterministic stop rules precede AI. Replies cancel queued chasing, factual summaries are saved to the same CRM, and uncertain decisions remain visible rather than silently sending.
- Meeting agreements accept numbered/ordinal offered slots, ISO or named calendar dates, today/tomorrow, unambiguous weekday/time and explicit IANA timezones/UTC. Relative dates anchor to the received message, not a later retry. Ambiguous AM/PM, weekday/date mismatch, next-week ambiguity, multiple options, invalid dates and DST ambiguity produce clarification. These are bounded common-English rules, not a claim of arbitrary natural-language scheduling.
- Calendar is checked again before booking. Expired or occupied times automatically offer replacements. No free slots produces a scheduling response instead of a fictitious meeting. A deterministic event ID prevents duplicate event creation. Actual Meet-link polling stops after ten checks rather than running forever.
- The same detailed workspace preserves original sources, contacts, subcontractors/supply chain, activity and email/meeting progress. One-time account setup is in Settings → Email & Calendar setup. Conversation polling refreshes CRM context; untouched summary fields display new server summaries without discarding unsaved edits.

## Local startup and safety limits

App: <http://localhost:3007>. Local demo password: `showcase-demo` unless overridden in ignored environment configuration.

```powershell
node scripts/build-local-proof.mjs --discovery
node scripts/start-local-funnel.mjs --demo
```

`--demo` starts the bounded research build and a 15-second email worker using the existing isolated PGlite directory. It clears inherited cloud database/runtime settings, preserves saved data and does not itself enable automation.

For an explicitly approved unattended local startup, use `node scripts/start-local-funnel.mjs --demo --activate`. The activation works only for the local approved-inbox demo with no cloud database; it does not resume old paused conversations. The Settings pause control remains available. Do not use `--activate` when you intend an email-off inspection.

Delivery and invitations remain frozen to `hritikdebnath00@gmail.com`. Unknown real buyer details stay blank. This Gmail is transport for the demonstration, never evidence of a buyer contact. Verified CRM still requires separate reviewed buyer fit/current role/provider-validated contact; the demo cannot manufacture those conditions.

Limits: one prospect conversation per search, ten outgoing first-attempt messages per day across demo paths, at most two unanswered follow-ups three days apart during working hours. Rejection/opt-out stops chasing; meeting booking stops prospecting. Post-booking rescheduling/cancellation requires sales handoff in this MVP. An already accepted or in-flight external operation cannot be recalled by pausing.

Keep the computer awake and this Node process running. A crash leaves durable state; an outstanding worker lease can delay recovery until expiry. Never clear a live lease or create a new email to bypass uncertain provider acceptance.

## One-time Google consent

1. In Google Cloud, enable Calendar API. Add `hritikdebnath00@gmail.com` as a permitted test user if the OAuth app is in testing.
2. Set the exact authorized redirect URI: `http://localhost:3007/api/mvp/automation/calendar/callback`.
3. Open <http://localhost:3007/settings?tab=automation>, click Connect Google Calendar and grant consent using that Gmail.

Client credentials do not grant access by themselves. The application checks that this account owns the primary Calendar and encrypts its offline refresh token. Connection returns to Settings. Meeting requests wait visibly for missing consent and resume automatically after connection.

Meetings use Asia/Kolkata, 30 minutes, weekdays 10:00–18:00. Buyer agreement is required, not salesperson intervention. Do not book a time merely because someone asked for a link without specifying or agreeing to a time.

## Verification and live proof

7 October: final production build/TypeScript and scoped ESLint passed. The post-live-fix full suite passed **826 tests**, with two optional captured-source replay tests skipped, using two workers and a 30-second per-test ceiling (94 passing files; 280.51 seconds). The initial suite passed 823 tests before three regression tests were added. The first heavily parallel run had timeout/PDF resource failures; the focused rerun passed 28 affected tests and both complete bounded-concurrency reruns passed. The migration test now accounts for migration 022, which only adds a bounded meeting-check counter.

Mocked-provider integration proves fresh partial research → automatic fit approval → introduction → authenticated reply → seller response → waiting for consent → available times → natural ordinal agreement → Calendar/Meet confirmation → CRM summary. This is not live inbox or Google event proof.

The actual final production browser capture passed five desktop/mobile screens with zero browser errors or mutation/provider requests. It verifies the exact searched product, collapsed historical override, preserved detailed workspace and account setup in Settings. Read-only report: <http://localhost:4177>.

Live provider permission checks returned HTTP 200 for Groq models, Resend receiving and Emailable account; 250 Emailable verification credits remained. These checks did not send, verify addresses or create events. Tavily/Groq consumption belongs to the separately bounded live search.

One new UI search was submitted for Power and control cables, UAE: `50f5bd4b-e684-426c-ab5e-6f92ab37cf85`. Its private state and screenshot artifacts are under `tmp/local-demo-proof-20261007`.

Actual live outcome after fixes:

- Three search requests, 23 read attempts, 20 saved original pages, six investigated identities, **one saved source-backed company: Sama Al Shahba**. Coverage remains partial: three unreadable pages and 28 deferred URLs. Publisher/association seeds are not displayed as buyers. No current purchase or named personal contact is established.
- Two accepted AI responses initially failed the optional operating-country schema. A cached-only repair replayed exactly those two original responses with no new searches, reads, discovery AI calls or increased limits. Both now have explicit evidence-review outcomes rather than parser failures. Neither established an additional buyer: one lacked acceptable selected-market attribution, the other a supported work citation. Their real documents remain retained, not represented as qualified contacts.
- Automatic enrollment selected Sama without a per-lead manual start. The first qualification picked the identity quote instead of the valid work quote. The corrected prompt supplies material-work evidence IDs; one supervised qualification retry was made before any delivery attempt. No delivery was retried or duplicated.
- At `2026-10-07T11:54:00Z`, the sole initial message reached **Resend accepted** state, addressed only to `hritikdebnath00@gmail.com`. Subject: `[Demo] Procurement support for Power and control cables`. Greeting: `Hi Sama Al Shahba procurement team,`. The seller identifies as Hritik and offers procurement support without invented awards, stock or certifications. Provider acceptance is not proof of inbox delivery.
- Updated actual browser captures have zero page errors and show discovery progress, selected search, saved company, original evidence, public company contacts, supply-chain section and the accepted email in the same workspace. No synthetic inbound reply or Google event was inserted. Three older conversations remain paused.
- At `2026-10-07T12:53:12Z`, the actual Gmail reply `Yes can you schedule a meet` was authenticated and saved. The worker automatically sent a date/time clarification, accepted by Resend. No manual Send/Run worker was used. This proves live receiving and automatic response delivery, **not successful AI meeting-intent handling**: a wrapped Gmail attribution header leaked its historical sent time into the deterministic scheduling parser, taking the clarification path before AI.
- The Gmail quote-cleaning defect was corrected to recognize bounded multiline attribution headers and CRLF line endings. Regression tests cover the actual observed format, exclusion of old timestamps/quoted opt-outs/slot choices, and retention of genuinely supplied dates and opt-outs. All **83 automation tests** passed with providers mocked, including real-adapter orchestration of that exact reply shape into `awaiting_calendar` and then scheduling after consent. The previous 826-test full run predates this additional four-test regression change. No already processed reply was reset or replayed and no duplicate live response was sent to prove the fix.
- Google Calendar is now connected to `hritikdebnath00@gmail.com`. The genuine reply `For Tommorow at 11 am and I am in india` took the AI meeting-request path and triggered real Calendar availability checks. The worker offered 8, 9 and 12 October at 10:00 Asia/Kolkata. It did not preserve the misspelled free-text 11 AM request, so this observation proves automatic slot offering, not arbitrary natural-language date understanding.
- A second scheduling defect rejected both `Slot 1` and the exact copied offer `Slot 1: Thursday, 8 October 2026 at 10:00`. The old parser required an additional consent verb and treated its own morning 24-hour label as ambiguous. The fix accepts an unambiguous bare selection or an exact canonical offered row. Conflicting dates/times, negation and alternatives still require clarification; arbitrary `Friday at 10:00` still does not guess AM/PM. Offers and copied-row recognition share the same date formatter.
- **110 focused automation and API tests passed** after this fix, including latest-real-reply recovery, normal-worker booking once, ambiguity, stale message IDs, pending/uncertain delivery, opt-out, pause, active leases and already-booked guards. Production build/TypeScript and scoped ESLint passed. The prior 826-test full run predates these regression additions; this is not a new full-suite claim.
- The latest actual reply (`e4dcdb33-d559-4e3e-8143-28eca7fb0fc9`) was recovered once through the authenticated operator action `recover_meeting_selection`, naming both thread and message UUIDs. It only resets that real reply after the latest accepted scheduling clarification; the normal worker still checks consent and live Calendar availability. No invented inbound message, repeated introduction, new search or AI call was used for this recovery. The three older conversations stayed paused.
- A server restart had left an abandoned worker lease. Both known local servers were stopped and an offline inspection verified the sole unpaused thread was `awaiting_time`, with no pending outgoing messages or existing event. Only that abandoned local lease was released. `scripts/release-stopped-local-funnel-lease.mjs` is a narrowly guarded operator repair for this captured demo, read-only unless `--execute`; never run it against a listening app or clear a live lease. This is not a normal user step.
- **Live meeting proof:** the normal worker created Google event `epc0d154d39ab2dbf99090817456d782522641d9f8f` for **8 October 2026, 10:00–10:30 Asia/Kolkata** and obtained <https://meet.google.com/cpb-kcya-yjr>. At `2026-10-07T15:29:17Z`, the confirmation `[Demo] Meeting confirmed: Power and control cables` was recorded as Resend **accepted** for the approved Gmail only. Inbox delivery of this final confirmation has not independently been confirmed by the user. The thread is `meeting_booked`; the real link and booking appear in its conversation and CRM summary, and prospecting follow-ups stop. The read-only desktop/mobile capture passed with zero browser errors. No real buyer was emailed or invited.

Cached-only recovery is `POST /api/mvp/runs/:id` with `{action:"replay_cached"}`. It accepts only settled partial searches with a current content-hash/version cache that passes the current schema. Failed uncached analyses stay failed; no quota expansion or network fallback is permitted. This is an operator repair tool, not an obligatory demo step. The bounded one-time script used for this run is `scripts/repair-local-demo-research.mjs`.

```powershell
# Start ONCE; rejects a repeat submission recorded in its state file.
node scripts/local-demo-walkthrough.mjs start
# Refresh current screens/messages without submitting searches or sending from the browser.
node scripts/local-demo-walkthrough.mjs capture
node scripts/serve-live-acceptance.mjs --automatic
```

The live screenshot report is <http://localhost:4178>. It serves only HTML/PNG files over loopback, not private state JSON, API keys or directory listings. Genuine user Gmail replies and Google consent remain required to prove the externally visible conversation and meeting. Free quotas and web-source availability limit coverage; neither a three-company historical pilot nor this workflow promises 50–100 companies or verified personal emails.
