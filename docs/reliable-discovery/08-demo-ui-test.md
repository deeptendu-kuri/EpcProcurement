# Integrated local demo: research → conversation → meeting

Superseded for the normal demo journey on 7 October: use [09 Current automatic local demo](09-local-automatic-demo.md). The reviewed saved-prospect controls below remain an advanced historical override, not the required path for a fresh search.

## Scope and starting state

This increment integrates one explicitly reviewed, real saved prospect with the existing demo email worker. A paused search remains paused; starting its selected company's demonstration does not invent completion, personal contact validation, an award or a purchase requirement.

All demo emails and meeting invitations are restricted to `hritikdebnath00@gmail.com`. Published company contacts remain their real source values. The seller is Hritik Debnath offering procurement support for the exact searched product; no seller company, certification, stock or pricing claim is invented. The initial introduction uses a grounded seller template; Groq interprets conversational replies. This is not a self-training agent.

Launch the rebuilt production app using `node scripts/start-local-funnel.mjs --demo`. It uses `.next-discovery`, the existing isolated local PGlite data directory and the bounded discovery budgets. It clears cloud database settings and enables the worker, not the app-level funnel switch. Existing conversations remain paused. No cloud migration or deployment is included.

App: `http://localhost:3007`. Saved test company: `http://localhost:3007/opportunities/0a880ba4-9011-4060-b8ec-a78bf513ae61?tab=conversation` (Sama Al Shahba, power and control cables, search `bdaae4a4-2998-4732-9a7f-e3cd315f36e2`). The company performs electrical installation and wiring according to its original website; a current purchase and named employee email are not established.

## User test steps

1. Open the company workspace. Review Overview, the searched product, original sources and available company contacts. Email & meetings can also be opened directly using the link above.
2. In Demo automation setup click **Connect Google Calendar**, choose the approved Gmail and grant consent. It returns to the same lead conversation. The exact Google OAuth authorized redirect URI must be `http://localhost:3007/api/mvp/automation/calendar/callback`; the Google Calendar API and this test user's consent access must be enabled in the Google project. Client credentials alone do not grant access. If consent fails, the UI reports failure; check those Google settings and retry.
3. Click **Enable demo funnel**. It is disabled when required configuration or the background worker is missing. This permits future automatic processing, but does not replay historical completed searches. It does not resume old paused conversations.
4. If the selected company's product fit is pending, click **Confirm potential buyer fit**, after reading its evidence. This is a fit review, not email validation. Then click **Start this prospect’s demo workflow**. It queues one conversation to the approved inbox. A running/cancelled/sample/unreviewed/source-less prospect, opt-out, prior outreach or per-search cap blocks a new start. Double clicks reuse the same conversation and do not send another introduction.
5. Allow approximately one worker interval (60 seconds), plus provider latency. UI status refreshes every 10 seconds. Provider accepted means accepted by Resend, not proof of inbox delivery. Inspect Gmail and the persisted outgoing message.
6. Reply in Gmail, for example: “We need 100 metres of power cable. What specifications should we share?” The agent should respond as a seller, acknowledge supplied details, ask for missing requirements and save the factual conversation summary in the same CRM. It must not greet Hritik as an identified buyer or claim a price or stock commitment.
7. Reply: “Can we arrange a meeting and share the link?” With Calendar consent, the agent checks real availability and emails up to three working-hour slots. Without consent, it waits visibly and resumes that request after connection without repeatedly asking AI.
8. Reply to the slots email: **Please book slot 2** (or 1/3). Exact selection of an offered slot is parsed deterministically without another AI classification. The worker rechecks availability, creates a deterministic Calendar event, obtains an actual Google Meet URL, then queues its confirmation email. It never fabricates a link. An expired/occupied slot or provider failure needs review rather than a false success.
9. Check Gmail, Google Calendar, the meeting link, conversation summary and five-stage progress. A booked event and acceptance of its confirmation email are distinct. Repeated worker ticks must not duplicate invitations or emails.

To test fresh research instead, enable first and submit a bounded product search. Genuinely completed new searches use the existing automatic enrollment and evidence-backed qualification path, capped at one prospect demo per search. If research pauses, use the explicit reviewed saved-company action; do not relabel it finished. Discovery may return fewer companies than requested. This integration does not prove 50–100-company yield, active procurement, named-contact coverage or arbitrary-material/country reliability.

## Controls, budgets and limitations

- Pause/resume/stop and reviewed retries are available in each conversation. Opening any page only reads status; it never initiates an email. A paused conversation also requires global enablement to proceed.
- Current demo: one prospect per search, ten outgoing first-attempt messages/day across demo delivery paths, at most two no-response follow-ups three days apart during working hours. Replies cancel queued chasing. Opt-out suppresses the test inbox; do not use unsubscribe for a casual demo reset.
- There is no repeated mail “until a meeting regardless of intent.” Rejections, uncertain AI decisions, contact revocation, missing inbox health and provider uncertainty stop or request review. Previously accepted messages cannot be recalled.
- Starting the selected prospect uses no new search, contact-verification or qualification-AI credits. Genuine reply interpretation uses Groq; sending/receiving and Calendar use the configured live providers after user enablement. Free quotas are finite; provider failures appear in the UI.
- No recipient guessing/fallback to an actual buyer. No new Hunter subscription is required for this approved-inbox demonstration. Emailable validates known addresses; it is not a contact finder.
- Vercel unattended processing remains guarded. Public signed callbacks, durable dispatch, PostgreSQL migration/recovery and cloud OAuth consent still require separate live proof.

## Implementation and proof

`POST /api/mvp/automation/conversation/[id]` accepts only `start_demo` and the configured approved recipient. It checks reviewed real-source evidence, a settled/partial search, suppression, prior contact attempts, mode/worker enablement and per-search limits. Enrollment shares a transaction lock with automatic starts. A fresh enablement timestamp prevents historical searches from unexpectedly sending after a pause. Existing thread delivery rechecks approval and recipient policy.

The company page supports `?tab=conversation`, and Calendar consent returns only to an allowlisted local workspace or Outreach. The same setup component is used on both screens. The optional standalone inbox test is tucked away as a diagnostic, not represented as a researched buyer.

Provider-HTTP-mocked integration covers reviewed partial research → actual adapters → seller introduction → authenticated reply → AI response → waiting for consent → available slots → explicit selection → Calendar event → Meet confirmation → persisted CRM summary, without contact-enrichment calls or fake buyer emails. Local production browser proof covers five desktop/mobile screenshots without any email, research or Calendar writes. Run `node scripts/prove-integrated-demo.mjs`; private artifacts are ignored under `tmp/integrated-demo-proof`. A loopback HTML/PNG-only report can be served with `node scripts/serve-live-acceptance.mjs --integrated` at `http://localhost:4177`.

Automated mocked proof is not a live Google meeting proof. The user's consent, Gmail replies, real Calendar event and inbox delivery remain the final acceptance steps.

Final local verification on 6 October: regression suite passed 795 tests with two optional captured-source replays skipped. Subsequent final workspace/navigation checks passed 20 focused tests across four files; these overlap the suite and are not added to its total. Scoped ESLint and the final production build/TypeScript check passed. After restarting that final build, the five-screen browser proof passed with no page errors, no mutation requests, no changed discovery counters, no new conversations and no provider requests. The app was left running on port 3007 with its worker available and app-level automation disabled; the Google account was still unconnected. Changes remain local on `feature/guided-prospect-workflow`; no push or cloud change was made.
