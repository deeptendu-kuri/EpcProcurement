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

This contact feature does not automatically start search-completion outreach or process inbound replies. The existing approved single-inbox queue is unchanged. Live Hunter results need proof with a real configured key and actual source-backed buyer; mocked tests are not live-provider proof.

For the no-purchased-domain reply demo, Resend provides a public account-specific `<id>.resend.app` receiving domain under **Emails → Receiving → ⋯ → Receiving address**. Once configured, the app can use a Reply-To address there and poll the receiving API locally. This receiving connection is not implemented yet. Existing sent messages without that Reply-To will not automatically reach the app when replied to. A custom verified sending domain is a separate requirement for production delivery beyond Resend's account-email test restriction. See [Resend receiving](https://resend.com/docs/dashboard/receiving/introduction).

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

This command connects to PostgreSQL and applies `src/mvp/db/migrations/001_*.sql` through `012_contact_enrichment.sql` in order. Migration 010 preserves product/search provenance; migration 011 adds the initially empty approved-email queue; migration 012 adds contact-check metadata and an initially empty provider audit/cache. The migration registry skips already-applied files. Each file runs inside a transaction; a failed file is rolled back. Do **not** run `supabase/migrations` for the active MVP.

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

## References

- [Render Free limitations](https://render.com/docs/free)
- [Deploy Next.js on Render](https://render.com/docs/deploy-nextjs-app)
- [Neon Free plan](https://neon.com/blog/how-to-make-the-most-of-neons-free-plan)
- [Resend test-domain recipient restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
