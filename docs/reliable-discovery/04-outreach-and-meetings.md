# Outreach and meeting automation

This plan connects grounded discovery to a real single-inbox demo conversation while keeping buyer contacts and transport addresses separate. It does not authorize emailing real buyers or an unlimited follow-up sequence.

## Existing implementation and gaps

The code has persisted `funnel_threads` and `funnel_messages`, Groq qualification/reply analysis, Resend sending and receiving-API polling, suppression checks and Google Calendar OAuth. Initial sales outreach is a fixed template, not a self-trained model. The local worker ticks every 60 seconds while the Node process stays alive.

The configured demo observed in the last audit was enabled and restricted to `hritikdebnath00@gmail.com`, with one new introduction per search. Config allows one to five. The funnel enforces ten first-attempt messages/day, counting its replies/follow-ups and legacy draft attempts; legacy manual sending separately permits 50/day. There is not yet one globally enforced ten-message policy. Consolidate this into one atomic budget instead of using an alternate path to bypass the funnel limit. Do not raise caps just because discovery yields more prospects.

`prospect_demo` can operate without a validated real buyer email, intentionally and visibly. It must not promote the opportunity to Verified contacts. Even the current `buyer` thread mode sends to the approved demo inbox; mode names do not mean external buyer delivery is enabled.

The same brittle quote attribution exists in automatic qualification. Discovery and automation must adopt the shared evidence contract together or newly visible companies can remain blocked in outreach.

The last recorded settings had no connected Calendar account and represented Hritik Debnath as a personal demo seller with company unspecified. Keys configured is not consent granted. Historical email replies do not prove that a fresh searched prospect completed a meeting.

## Separate discovery from enrollment

Save all grounded material-fit companies within the budget, including blanks. Enrollment then checks:

1. Run/opportunity is real, not sample, rejected, cancelled or a research-only seed.
2. Company/product fit is grounded under the shared policy.
3. Demo automation is enabled and the approved recipient is frozen on the thread.
4. Company/product introduction has not already been attempted across searches or campaigns.
5. Inbox ingestion health, suppression, business hours and applicable caps allow action.

For this demo, contact absence is allowed only because delivery is deliberately substituted at transport time. The UI must say Demo conversation with Hritik, not Buyer contacted. If 100 companies are discovered, one demo introduction may be sent under the current cap and the rest remain visible; that is expected behavior, not 99 failed sends.

Real delivery is a future separately approved policy requiring provider-confirmed deliverability, supported employment/role, appropriate outreach permission, verified sending identity/domain and stop handling. Do not implement a fallback that emails any guessed address when enrichment fails.

## Seller behavior

Represent only the configured salesperson, company and approved material capabilities. Until confirmed, no invented certifications, stock, exact price, fastest delivery, lowest cost or guaranteed best quality. User intent to source broadly is not permission to claim every brand or qualification.

If there is a supported recent award, congratulate the recipient on that specific work. If there is only capability evidence, refer to that work without invented congratulations. Offer procurement support for the searched material and ask whether there is a requirement. Do not reverse seller and buyer roles.

For technical interest, ask concise questions about quantity, grade, size, delivery location and required timing where relevant. Missing seller knowledge or price requests go to human review instead of an invented commercial commitment. Treat buyer email content as untrusted input, not configuration or policy instructions.

## Reply and follow up flow

```text
Eligible demo thread -> introduction accepted -> waiting
  -> positive/question -> grounded polite reply or human review
  -> meeting request -> availability slots -> explicit selection
       -> free/busy recheck -> calendar event -> real Meet link -> confirmation
  -> opt-out/rejection -> suppressed/stopped
  -> automatic reply -> stop or policy-defined pause, never a reply loop
  -> no response -> bounded due follow-up -> exhausted/stopped
```

Keep the existing maximum two follow-ups, three-day spacing and business-hour policy unless separately changed and tested. Currently the thread can remain active after the limit while no further follow-up is queued; an explicit exhausted state in the flow above is proposed so the UI is clearer. An incoming reply cancels pending no-response follow-ups; appropriate conversational replies can continue within a new bounded turn/day budget. Do not keep sending until a meeting regardless of the recipient's intent.

Strip quoted history before intent analysis. Deterministic unsubscribe/rejection checks precede AI. Handle ambiguous intent, requests for humans, complaints, delivery failure and conflicting dates conservatively. A future configurable policy may pause on out-of-office until a supported return date; that is not current behavior.

## Inbound transport and delivery evidence

Local demo can keep existing bounded receiving-API polling. Cloud adds a verified Resend webhook, persistent receipt and asynchronous processing. Verify signature/timestamp against raw bytes, deduplicate provider event IDs, fetch the body when needed, and map it to the saved unique Reply-To token/provider message relationship. A subject line alone is not sufficient thread identity.

Keep approved-sender checks for the demo. Out-of-order or duplicate events cannot cause duplicate replies. Polling reconciliation remains available for missing receipts. Preserve the current principle that unknown inbox health blocks new outbound rather than risking a follow-up after an unseen opt-out.

Provider acceptance is not inbox placement. Record accepted separately from delivered, bounced and complained; stop future sends on relevant failures. [Resend documents webhook request verification](https://resend.com/docs/webhooks/verify-webhooks-requests) and [received-message retrieval](https://resend.com/docs/api-reference/emails/retrieve-received-email). These APIs must be integrated, not merely enabled in a dashboard.

## Meeting behavior

A request for a meeting triggers availability lookup and proposed slots, not an immediate invented event at an unspecified time. Explicit selection of a supported offered slot authorizes booking. Natural-language date selection is a future parser with timezone/ambiguity tests; the present deterministic parser recognizes option or slot selections.

Recheck free/busy just before creation. Use the existing deterministic event ID to recover ambiguous success without creating duplicates. Save event ID, selected start/end, timezone, attendee and conference state. Send a link only after Google returns a valid conference URL; retry conference retrieval safely if pending. Do not infer a working Meet link from an event ID.

Google Calendar creation uses real events and conference data, as described in [Google's event creation guide](https://developers.google.com/workspace/calendar/api/guides/create-events). OAuth must be completed by the approved calendar owner. The demo invite goes only to the approved inbox. Cloud needs consent/token storage in its own database; a local connection is not implicitly copied.

## State and side effect integrity

Proposed events: `outreach.eligible`, `outreach.blocked`, `thread.enrolled`, `message.queued`, `message.accepted`, `message.delivered`, `message.bounced`, `reply.received`, `reply.classified`, `followup.cancelled`, `recipient.suppressed`, `meeting.requested`, `slots.offered`, `slot.selected`, `calendar.created`, `conference.ready`, `meeting.confirmed` and `handoff.required`.

Use stable idempotency keys, transactional outbox entries and leases. Just before sending, recheck pause, recipient, suppression and new inbound events. A provider timeout after acceptance is an uncertain outcome to reconcile, not permission to send a second message blindly. Preserve the frozen draft on retries.

Summaries derive from actual messages and decisions. Keep technical requirements, answered questions, next action and confirmed meeting details; no fabricated pipeline-stage advancement. Client views redact private bodies where unnecessary.

## Agent learning boundary

Do not introduce Darwin, Hermes or self-modifying policies for the first MVP. Use versioned prompts, reviewed corrections and regression evaluations. Learning can mean storing approved seller facts and human feedback for a reviewed prompt release. It must not mean teaching itself new claims, changing recipient permissions or expanding follow-ups automatically.
