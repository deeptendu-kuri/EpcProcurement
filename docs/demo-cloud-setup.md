# Free cloud demo setup

## What changed

- Clicking a found contact, or **Demo email** for a missing contact at an identified company, opens an editable template automatically.
- Sub-buyer contact actions use the selected company's buyer record. A derived supply-chain company is saved through the existing buyer flow when necessary.
- Missing emails display `demo-contact@example.com`, explicitly labelled as a dummy address. Fake people are not added to the scraped contact database.
- With `DEMO_EMAIL_ENABLED=1`, all delivery goes only to `DEMO_RECIPIENT_EMAIL`. The browser cannot choose a recipient, CC or BCC.
- **Demo email sent** means Resend accepted the message and returned a provider ID, not that inbox receipt has been confirmed. Failed or uncertain attempts offer a same-draft retry with duplicate protection.
- Existing discovery, scoring, buyer classifications, tender/owner leads and supply-chain candidate logic are unchanged. Possible companies are still prospects, not verified purchasing customers.

## Accounts and information needed

1. **GitHub:** the private repository containing this app, connected to Render. No GitHub token needs to be shared in chat.
2. **Render:** a Free Node Web Service, not a Static Site. No paid disk, worker or custom domain is needed.
3. **Neon:** a new Free PostgreSQL demo database. Copy its connection string including `sslmode=require`. A fresh dedicated database avoids mixing this app with another schema.
4. **Resend:** a Free account and API key. For the no-domain-purchase setup, create the account using the same inbox that should receive every demo message. The default `onboarding@resend.dev` sender is restricted to the account's own email address; sending elsewhere requires a verified domain.
5. **Groq:** reuse the existing key if available. Immediate previews use a deterministic template; **Write again** can use the configured AI and falls back to a template on provider failure. Live discovery still depends on the existing sources, extraction configuration and quotas.
6. **Demo login:** choose the password clients will use. Keep the signing secret private and separate from the password.

The shipped seller profile, catalogue and strengths are examples. For a branded demo, provide the actual seller name and products/services you can supply; we can update `src/mvp/config/client-profile.json`, `catalogue.json` and `strengths.json` without redesigning discovery. Until then, retain their example labels and do not present fictional certifications or capabilities as your own. Settings currently displays this configuration read-only.

Enter secrets directly in `.env.local` locally and Render's Environment settings remotely. Never commit them, put them in `NEXT_PUBLIC_*`, or paste them into screenshots. If credentials have been posted publicly, rotate them.

## Approved email automation (guided-workflow branch)

Product-scoped leads now use **Contact → review template → Approve & automate demo email → Outreach**. Approval saves a persistent database job; it does not display a sent confirmation. Only Resend acceptance can mark the email sent. The Outreach page shows queued, sending, paused, cancelled, accepted or needs-review states, with provider ID and any delivery error. The lead's conversation and activity retain the history.

Automation is locked in both application code and the database to `deeptendukuri@gmail.com`. No browser recipient, CC/BCC or follow-up schedule is accepted. Buyer fit must be approved before queuing and is checked again before sending. This test mode does not validate a dummy contact or move it into Verified CRM.

The queue freezes approved text, deduplicates company/product/contact across searches, claims jobs atomically, and reuses the draft's provider idempotency key for bounded retries. A job outside the 23-hour retry window needs manual review. Unattempted jobs can be paused/resumed/cancelled; an uncertain delivery cannot be cancelled to release duplicate protection. No historical drafts are automatically approved or sent.

- Set `MVP_OUTREACH_WORKER=on` for the Node background worker. Default is off. It checks for one due job every 15 seconds while the server is awake, independently of the browser.
- For an external scheduler, set server-only `OUTREACH_WORKER_SECRET` to 32+ random characters and invoke **POST `/api/mvp/outreach/worker`** with `Authorization: Bearer <secret>`. No query-string token, browser session or unauthenticated GET can invoke it. Each invocation processes at most one job. An external scheduler is not provisioned by this change.
- Free-host sleep still delays delivery; durable storage is not an always-on worker. Use Neon/PostgreSQL in the cloud, never ephemeral PGlite. Verify the worker configuration after deployment.
- Automatic follow-ups, inbound reply interpretation and calendar booking remain disabled/unconnected. Connect reply detection and stop-on-reply/opt-out handling before enabling follow-ups. This is one approved initial email per campaign, not a self-learning sales agent.

The legacy company view retains its existing manual single-inbox Send action; an approved campaign draft cannot bypass the queue through that action or be edited/marked sent manually.

## Live contact enrichment (guided-workflow branch)

Live discovery no longer substitutes fixtures when sources are empty or fail. An answered search can return zero real prospects; if every source fails, the run fails visibly. Explicit offline/sample mode remains available for tests. Progress and recent searches distinguish raw lead records from the product-scoped buyer prospects actually saved to CRM.

Open a product-scoped prospect and use **Find & validate company contacts**:

1. Enter and confirm the buying company's actual website domain. Do not use the project owner's site or guess from a company name.
2. **Find contacts with Hunter** requests at most five personal addresses. Only named contacts with a relevant buying-team title are saved, as unverified candidates. Generic mailboxes, unrelated departments and mismatched domains are excluded. A lookup may return none.
3. Review the person's current employment/role separately; the confirmation button records your manual review, not a provider guarantee of employment.
4. **Check email with Hunter** stores the exact provider outcome. Only a complete valid result with positive SMTP/MX checks, no catch-all, no disposable/webmail flags and no blocking is marked deliverability-validated. Finding an address or a high confidence score is not validation. Phone validation is not included.

Set server-only `HUNTER_API_KEY` in the ignored environment file and restart the app. Hunter's `test-api-key` returns dummy responses and is rejected. Requests have a 20-second timeout, no automatic provider retry, a persistent audit and one-day cache. Cached checks keep their original validation timestamp. `HUNTER_DAILY_REQUEST_LIMIT=5` caps actual requests across the app's database per UTC day (configurable 1–25); this is not the provider's credit allowance. Provider quota/auth failures appear in the contact panel. Sample leads cannot use live enrichment.

Verified CRM requires approved product fit, a recent user-reviewed company/role, an active matching buying role and recent provider email validation (90-day expiry), and excludes samples. A domain change clears earlier Hunter validation. These checks do not prove that the company has committed to purchasing.

Contact enrichment by itself does not start outreach. The opt-in **Local research-to-meeting demo** described below adds search-completion outreach and inbound reply processing; it is separate from the earlier approved single-inbox queue. Live Hunter results need proof with a real configured key and actual source-backed buyer; mocked tests are not live-provider proof.

For the no-purchased-domain reply demo, Resend provides a public account-specific `<id>.resend.app` receiving domain under **Emails → Receiving → ⋯ → Receiving address**. The local funnel below implements unique Reply-To addresses and receiving API polling; actual receiving still needs account configuration and live proof. Existing sent messages without that Reply-To will not automatically reach the app when replied to. A custom verified sending domain is a separate requirement for production delivery beyond Resend's account-email test restriction. See [Resend receiving](https://resend.com/docs/dashboard/receiving/introduction).

## Email environment variables

Add the following to `.env.local` without replacing existing source/AI settings:

```dotenv
DATABASE_URL="<Neon PostgreSQL connection string with SSL>"
DEMO_EMAIL_ENABLED=1
DEMO_RECIPIENT_EMAIL="<your Resend account inbox>"
RESEND_API_KEY="<Resend API key>"
DEMO_EMAIL_FROM="Demo <onboarding@resend.dev>"
```

Keep `APP_URL` empty for local development. Render needs these variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL SSL connection string |
| `DEMO_PASSWORD` | Client demo login password |
| `SESSION_SECRET` | Random secret of at least 32 characters; the Blueprint generates one |
| `APP_URL` | Actual Render HTTPS origin, e.g. `https://your-service.onrender.com`, without a page path |
| `DEMO_EMAIL_ENABLED` | `1` |
| `DEMO_RECIPIENT_EMAIL` | Exactly one authorized test inbox |
| `RESEND_API_KEY` | Resend API key |
| `DEMO_EMAIL_FROM` | `Demo <onboarding@resend.dev>` |
| `GROQ_API_KEY` | Existing free-tier key |
| `MVP_OFFLINE` | `0` for live discovery |
| `NODE_VERSION` | `22` |

Copy any existing custom `RSS_FEEDS`, model overrides, Cloudflare configuration or daily token budgets if you want identical source/AI behavior on the cloud. Do not copy the unrelated legacy Supabase variables for this MVP.

For a manually configured service, generate `SESSION_SECRET` locally with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Migrations

Run from the app directory, after configuring the new cloud `DATABASE_URL`:

```powershell
pnpm.cmd db:migrate
```

This command connects to PostgreSQL and applies `src/mvp/db/migrations/001_*.sql` through `013_local_sales_funnel.sql` in order. Migration 010 preserves product/search provenance; migration 011 adds the initially empty approved-email queue; migration 012 adds contact-check metadata and an initially empty provider audit/cache; migration 013 adds opt-in conversations, frozen outbound messages, inbox deduplication, opt-out suppression and encrypted Calendar credentials. Automation starts disabled. The migration registry skips already-applied files. Each file runs inside a transaction; a failed file is rolled back. Do **not** run `supabase/migrations` for the active MVP.

For a Neon `-pooler` hostname, the migration command automatically uses the matching direct endpoint because its session advisory lock is incompatible with transaction pooling. App traffic continues to use the original pooled `DATABASE_URL`. Other providers can use an optional `MIGRATION_DATABASE_URL` pointing to their direct endpoint.

A fresh database receives the full schema. An existing compatible MVP database receives only pending migrations, including the new email delivery fields. Repeat runs print **Database is up to date**. Existing cloud rows are not reset.

This is a **schema migration, not a local-data transfer**. It does not import `.data/pglite`, historical leads, contacts or articles. For the fastest demo, scrape into the fresh cloud database; the existing sample-data action is available as an explicitly labelled fallback. Local database recovery/import is a separate task; do not delete the original local database to make a fresh demo work.

Render Free does not provide a pre-deploy command. `start:cloud` therefore runs the same migrations before launching Next.js. A database or migration error stops startup instead of serving against ephemeral local storage.

## Render deployment

The repository includes `render.yaml` for a Blueprint. Use it if this app is the repository root. If the repository wraps the app in another directory, set the Web Service **Root Directory** to the actual app folder and configure the settings manually; do not assume the local folder name is the GitHub root.

- Runtime: Node
- Plan: Free
- Region: Ohio, matching the current demo database's US East (Ohio) region
- Build command: `corepack pnpm install --frozen-lockfile && corepack pnpm build`
- Start command: `corepack pnpm start:cloud`
- Health check: `/api/mvp/health`
- Environment: values listed above

Once Render gives you the service URL, set `APP_URL` to that exact HTTPS origin and redeploy if necessary. This keeps login redirects and secure cookies on the public URL rather than the host's internal address.

No deployment, repository push, real PostgreSQL migration or external email delivery should be claimed verified until performed with the actual accounts and settings.

## Demo acceptance checklist

1. Check cloud logs: build succeeded, migrations completed, server listening, readiness endpoint returns `200 {"ok":true}`.
2. Open a private browser window on the public URL, log in and run the existing live discovery flow. Keep the results page open until it completes.
3. Open a lead, click a named contact or **Demo email**, confirm the selected company, displayed contact address and prefilled editable template.
4. Repeat for a sub-buyer and for a contact clicked from SuperSearch.
5. Send one message. Confirm the UI shows **Demo email sent**, a provider ID and a history entry; confirm actual receipt in the authorized inbox and check the Resend dashboard if needed.
6. Refresh and verify the saved lead/draft/history persisted in Neon. Check mobile layout and a signed-out API request.
7. Have a few prepared relevant buyer examples saved before the meeting, clearly distinguishing real source evidence from sample data and possible candidates.

Free Render services sleep after 15 minutes without inbound traffic and have ephemeral local files. Neon holds persistent data. Existing long-running search work is not a durable job queue, and reliable always-on scheduling is outside this minimal demo upgrade. Warm up the public link before the meeting; free tiers and upstream scraping/AI services can throttle, sleep or fail. No honest setup can guarantee zero cloud failures.

## Local research-to-meeting demo (feature branch)

This workflow is separate from the earlier manual draft queue. All outgoing messages and Calendar invitations are hard-locked to `deeptendukuri@gmail.com`. The AI represents Deeptendu Kuri in a personal demo; it is not authorized to claim any company's certification, stock, price, delivery commitment or customer reference. Current seller capabilities are not established by the example catalogue.

### Exact account setup

Use the ignored `.env.funnel.local` file in the app directory for local connections. The isolated local launcher loads it before the normal production environment, so an older `.env.production.local` Resend key will not override your new funnel key. Never commit this file or share API secrets in chat.

1. Hunter: sign up at https://hunter.io, open Account → API (https://hunter.io/api-keys), create/copy a real key into `HUNTER_API_KEY`. Do not use `test-api-key`; that returns fictional responses. Discovery, finding and verification consume different credits; the free account's quota is for a small demonstration, not unlimited buyers.
2. Tavily (recommended, optional): sign up at https://app.tavily.com, create a key and set `TAVILY_API_KEY`. The adapter searches for awarded work around the searched product/countries. It requires reading original pages and verified quotes; generated answers and snippets do not become facts.
3. Resend sending/receiving: sign in to the existing account at https://resend.com. Open API Keys (https://resend.com/api-keys), create an app key with **Full access**, not Sending access, and set `RESEND_API_KEY`. Open Emails → Receiving → three dots → Receiving address. Set `RESEND_RECEIVING_DOMAIN` to the bare `<id>.resend.app` domain, without `https://` or a mailbox prefix. No bought domain or Gmail password is needed for this managed receiving setup. A sending-domain verification is still needed before later delivery to real buyers; that is not enabled here.
4. Groq: the existing `GROQ_API_KEY` is reused. No new AI account is needed. The funnel refuses mock AI for automatic qualification/replies. Rate limits and the app's daily token budget still apply.
5. Google Calendar: create/select a project at https://console.cloud.google.com. Enable **Google Calendar API** under APIs & Services → Library. Configure **Google Auth Platform** branding/audience for an External test app; add `deeptendukuri@gmail.com` as a test user. Under Clients, create an OAuth client of type **Web application**. Add `http://localhost:3007` as an authorized JavaScript origin and this exact authorized redirect URI: `http://localhost:3007/api/mvp/automation/calendar/callback`. Put the client ID/secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Open the app's Email automation page → Connect Google Calendar → sign in and consent with that Gmail. An API key alone cannot create an authenticated Calendar event. The app checks the connected primary calendar belongs to the approved Gmail account. Refresh tokens are encrypted server-side with the session secret; keep that secret stable. Google test-app authorizations may expire and require reconnecting.

The default meeting settings are 30 minutes, Asia/Kolkata, weekdays 10:00–18:00. Change `MEETING_DURATION_MINUTES`, `SALES_TIMEZONE`, `SALES_START_HOUR` and `SALES_END_HOUR` before the demo if needed; the UI displays these settings. An ambiguous request or proposed time does not authorize a booking: the app reads free/busy, offers slots and requires an explicit selection such as `Please book slot 2`. It rechecks free/busy and uses a deterministic event ID to recover interrupted inserts. It shows booked only when Google returns the event and a real Meet link; a pending conference link remains pending.

### Activation and local proof

1. Fill the ignored connection file. Run `node scripts/check-funnel-connections.mjs --live` to perform read-only connection checks. It never sends email, books an event or connects to any database; it prints only configuration booleans and HTTP status. Receiving must return 200; HTTP 401 means the current key cannot read incoming email and needs investigation/replacement.
2. Set `MVP_FUNNEL_WORKER=on` in `.env.funnel.local`, restart the isolated local app using `node tmp/automation-local-server.cjs`, and log in at `http://localhost:3007`. Keep the server/computer running. The browser may close; the Node worker checks once per minute while awake.
3. In Email automation connect Calendar, then **Enable demo funnel** once before a new real product search. Previously completed searches and sample records are not enrolled. A zero-buyer search sends no email.
4. On an opportunity, review the official company website and current employer/role when those facts are uncertain. Hunter does not prove employment; the app never treats email deliverability as a current-role or purchase guarantee. After these checks, email discovery/verification, AI initial drafting and delivery run without a per-email Send click. The workflow may wait at Contact check needed instead of making up a domain or contact.
5. Verify actual receipt in Gmail. Reply to the new funnel message (its unique Reply-To is on your managed Resend domain); older manual demo messages are not connected to this conversation. Verify the inbound message, AI response and summary in the same lead workspace.
6. Ask for a meeting, choose one offered slot explicitly, then verify the actual Calendar event, attendee restriction, Meet link and final email. Test opt-out and a provider failure too. Do not call the live funnel verified until these real-provider steps pass.

Safety: first email plus at most two prospecting follow-ups, three days apart in business hours; any actual reply cancels chasing; rejection, opt-out and automatic replies stop the sequence. Opt-out suppresses the demo inbox across both new and legacy senders. Unsure AI decisions, HTML/attachment-only emails, revoked validation, ambiguous times and uncertain provider acceptance go to review. Messages are frozen before delivery and retries use one provider key, at most three attempts and within 23 hours. Pause cannot recall a provider request already in flight. Search provenance is retained; a company/product conversation is deduplicated across searches. Inbox polling must complete successfully before outbound processing.

Local tests mock paid/external providers and run against in-memory databases. These prove orchestration, gates, persistence and failure behavior, not genuine buyer data quality, actual Hunter validation, mail delivery or a real Google event. Those require the live acceptance steps above. No cloud data reset or production deployment is part of this local upgrade.

The approved UI has five main navigation items: Overview (choose a search), New search (product/countries), My leads (project → buying company → contacts, Potential buyers / Validated contacts views), Email automation (setup/progress/pause), Settings. Earlier advanced pages remain accessible from legacy links; their historic records are not relabelled as validated buyers. Table view remains available for keyword, exact product and CRM summary fields.

### Later client-grade upgrades

Prioritize audited official-domain/employment evidence, wider award coverage and project-site country matching, a persistent search/job runner, delivered/bounce/complaint webhooks, real sender-domain authentication, per-client seller knowledge with evidence and approval rules, secure calendar connections, tenant isolation, consent/legal review, provider-cost controls and measurable reply/meeting quality. Add CRM integrations, RFQ/specification extraction and multilingual sales only after the core funnel has live proof. Conversation context and summaries improve continuity; the model does not autonomously train or rewrite its safety rules.

### Provider references

- [Hunter API keys](https://help.hunter.io/en/articles/1970956-hunter-api)
- [Resend managed receiving domain](https://resend.com/docs/dashboard/receiving/introduction)
- [Resend key permissions](https://resend.com/docs/api-reference/api-keys/create-api-key)
- [Tavily free credits](https://docs.tavily.com/documentation/api-credits)
- [Google OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Calendar events and conferences](https://developers.google.com/workspace/calendar/api/guides/create-events)

### Hosting references

- [Render Free limitations](https://render.com/docs/free)
- [Deploy Next.js on Render](https://render.com/docs/deploy-nextjs-app)
- [Neon Free plan](https://neon.com/blog/how-to-make-the-most-of-neons-free-plan)
- [Resend test-domain recipient restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
