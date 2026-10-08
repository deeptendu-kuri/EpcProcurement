# Cloud deployment and provider budgets

The local persistent-process architecture must not be deployed to Vercel unchanged. Choose a supervised free demonstration or a client-grade durable cloud deployment explicitly. Free quotas are useful experimental budgets, not guarantees of continuous service or commercial-hosting eligibility.

Provider facts were checked against official sources on 5 October 2026. Confirm the actual account dashboard and terms again before purchasing or releasing. No new accounts, paid plans or deployment are created by this document.

## Hosting choices

| Choice | Practical use | Required limitation or change |
| --- | --- | --- |
| Local Node and PGlite | Development and controlled live inbox demo | Requires the local process and network; no public reliability claim |
| Render Free and Neon | Supervised cloud demo using much of the existing Node runtime | Idle spin-down and restart interruptions; add durable research persistence |
| Vercel and Neon with signed durable delivery | Client-facing short APIs and resumable jobs | Implement job transport and webhooks; use a hosting plan permitted for commercial use |

[Vercel Hobby fair-use rules](https://vercel.com/docs/limits/fair-use-guidelines) restrict it to non-commercial personal use. A business/client demo should not assume eligibility. [Hobby cron](https://vercel.com/docs/cron-jobs/usage-and-pricing) runs at most daily with limited timing precision; it is not the current minute worker. Function time limits do not create durable background execution.

[Render Free](https://render.com/docs/free) can spin down after 15 idle minutes and has an ephemeral filesystem. Do not store its database or job state in local PGlite. Warmup supports a supervised demonstration, not uninterrupted follow-up guarantees.

## Proposed Vercel execution

### Accepted crawler hosting boundary

The accepted discovery-first design tests an optional local Crawl4AI reader, not an immediate cloud container deployment. The [self-hosting guide](https://docs.crawl4ai.com/core/self-hosting/) recommends at least 4 GB RAM for its Docker container. [Render Free compute](https://render.com/docs/compute-plans) provides 512 MB and its idle service sleeps; do not present that pairing as a tested or reliable browser-worker host. SDK resource use must be measured separately from the Docker recommendation.

Keep heavy browser/PDF work outside a normal Next.js request handler. For a later cloud release, choose a separately authenticated worker with suitable measured resources or a hosted extraction provider within its actual account allowance. Vercel can host UI and short bounded orchestration APIs, but its [function size, memory and duration limits](https://vercel.com/docs/functions/limitations) still apply. Free library licensing is not a hosting entitlement. Hobby non-commercial restrictions still require a client-use hosting decision.

A local worker can support supervised tests only while its machine/process/network is available. A cloud UI that depends on that worker is not a self-contained or always-on deployment. Keep crawler and research job state in durable storage; container caches and local files cannot be the only recovery mechanism. Browser access, redirects and subresources require public-network egress controls, not merely validation of the first URL.

No new provider key is needed for the initial local parser/reader work. A self-hosted worker needs private service authentication, not a paid crawler subscription. Serper is optional for measured search-coverage gaps; hosted extraction keys are optional for measured rendering gaps. Recheck current quotas, storage/reuse rights and budget controls before any integration. Preserve existing Tavily/Groq/Resend/Calendar adapters rather than purchasing replacement services without evidence.

Initial local pilot ceilings: six basic search-provider requests, sixty total page/document read attempts, twelve AI requests and 30,000 estimated aggregate AI input/output tokens, lowered by actual quota and daily allowance. Repairs, fallbacks and resumed batches share these ceilings. Structured parsing does not use an AI call by default; it still consumes bounded I/O/CPU. Browser asset requests need separate bounded accounting/resource controls. The current local three-query environment clamp must be adjusted deliberately in the implementation preflight, not silently ignored by the UI.

Use Next.js on Vercel for the UI and bounded authenticated handlers, Neon PostgreSQL for durable state, and a signed delivery service such as QStash for executing due stage IDs. Implement and test [QStash request verification](https://upstash.com/docs/qstash/howto/signature) and [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), including raw-body handling, signature time validity and replay protection. Use Node runtime where the present pg, crypto, DNS and HTML parsing code requires it. Audit bundling and resource usage rather than assuming Edge compatibility.

1. An authenticated search request validates intent, saves a run/jobs/outbox transactionally and returns a run ID.
2. A dispatcher publishes job IDs. Transport delivery is at least once; DB leases and unique effect keys provide duplicate protection.
3. A signed handler performs a small bounded task, saves output/checkpoint and schedules successors through the outbox.
4. Rate limiting yields delayed jobs. Resume uses saved pages and cursors, not a new identical search.
5. An authenticated recovery sweeper repairs unpublished outbox rows and expired jobs, not every running job globally.
6. Resend webhooks persist receipts quickly; AI replies and Calendar calls are asynchronous jobs.

Proposed handler budget is approximately 45 to 60 seconds, adjusted by actual performance and host limits. Split slow pages or provider calls rather than rely on a single multi-minute search function. The current 20-minute global funnel lease and startup interruption logic must be adapted to per-job ownership and multi-instance operation.

Keep `runtime.ts` fail-closed guard until these paths pass cloud recovery tests. Deleting the guard or adding `maxDuration` is not a fix. The current queue and timers remain appropriate only for a persistent process until replaced.

## Free service budgets and paid upgrades

| Service | Current role and free constraint | What paying can improve |
| --- | --- | --- |
| Tavily | Web discovery; 1,000 monthly free credits, basic search one credit/request | More breadth and rechecks, not automatic product-fit correctness |
| Groq | Structured extraction and reply reasoning; model/org-specific rate and token limits | Throughput/headroom; evaluate quality rather than assume payment fixes prompts |
| Emailable | Verify a known email; remaining introductory/account credits must be checked | More verifications, not discovering a person or address |
| Resend | Demo delivery and receiving; free transactional allowance 100/day and 3,000/month counts sending and receiving | More conversation capacity; domain verification is a separate setup requirement, also available on Free |
| Neon | Shared PostgreSQL; current free-plan announcement specifies 1 GB/project and 100 CU-hours/project/month | Compute, storage and recovery retention for more customers |
| QStash | Proposed durable HTTP job transport; free 1,000 delivery attempts/day including retries | More tasks and operational headroom |
| Apollo or FullEnrich | Optional future contact discovery/enrichment adapters | Named professional coverage; no guarantee of actual material demand |

Sources: [Tavily credits](https://docs.tavily.com/documentation/api-credits), [Groq rate limits](https://console.groq.com/docs/rate-limits), [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Neon free-plan announcement](https://neon.com/blog/neon-free-plan-1-gb-per-project), [QStash pricing](https://upstash.com/pricing/qstash), [Apollo API credits](https://docs.apollo.io/docs/api-pricing), [FullEnrich introduction](https://help.fullenrich.com/en/articles/10791972-introducing-fullenrich).

Do not budget a one-minute QStash heartbeat: 1,440 deliveries/day exceeds the quoted free allowance before research. A proposed 15-minute recovery sweep is 96/day; event-driven continuations and incoming webhooks handle prompt work. Account for retry attempts, not only successful tasks. Delayed follow-ups must respect the plan's scheduling limits.

## Experiment cost model

Reserve credits and token estimates atomically before each provider call, including concurrency across app instances. Record attempted, successful, unknown-outcome and reconciled usage. Account dashboards remain authoritative where APIs do not report exact cost.

Example, not a yield forecast: 24 basic searches reserve 24 Tavily credits and could return up to 480 URL slots with the 6 October twenty-result request setting. Deduplication, access failures and relevance reduce this; the actual six-query pilot produced only twenty URL slots, all from one query. The app's reading caps apply separately, so twenty results per request does not authorize reading every returned URL. One hundred candidate companies needing an average three reads implies roughly 300 reads, not 100; bundles and AI tokens add a separate cost. Contact lookups and verification are additional budgets.

For a demo, one introduction, one received reply and one outgoing reply use three transactional quota units under the cited Resend rule. Follow-ups, further replies and receipt traffic add usage. Current application caps are much lower than provider limits and should remain low during evaluation.

Measure cost per unique eligible company, recently active company, company with a published contact, named validated contact and completed conversation. Upgrade the limiting stage after these metrics are observed. Do not buy all providers upfront or assume a 20 to 30 percent personal-email yield.

After funding, evaluate licensed project intelligence separately from contact enrichment. [MEED Projects](https://www.meedprojects.com/) describes a premium regional project-tracking service; [Industrial Info Resources](https://www.industrialinfo.com/platform-and-solutions/pecweb/project-database/) describes tracking across planning, engineering, procurement and construction. These may improve activity/contractor coverage. Their API/export availability, reuse rights, market coverage and price require vendor confirmation; a subscription does not automatically permit scraping or prove material demand. Add such sources through the same claim/provenance contract, not a separate trusted-without-checks pipeline.

## Migration and environment plan

- Keep local PGlite, cloud staging and production distinct. No automatic copying, clearing or import of old data.
- Add migrations at the next unused sequence; never edit applied historical SQL. Test transactional migration and rollback compatibility.
- Use `scripts/db-migrate.mjs` with `MIGRATION_DATABASE_URL` or its supported direct-Neon conversion for the advisory lock. Normal app traffic may use the pooler.
- Run one controlled pre-release migration. Replace lazy production cold-start DDL with expected-schema readiness checks before multi-instance deployment.
- Keep secrets server-only and ignored locally; rotate historically exposed test keys before a public release. Never put them in `NEXT_PUBLIC_*`, documents, source fixtures or transport payloads.
- Disable email and schedules on preview deployments. Use isolated staging data and approved inbox only.
- Preserve Calendar token encryption compatibility. It currently derives from `SESSION_SECRET`; rotating that secret can invalidate saved encrypted tokens. Plan a versioned dedicated encryption key before broader release.

## OAuth and receiving configuration

The stable HTTPS origin is `APP_URL`; Google redirect URI is exactly `${APP_URL}/api/mvp/automation/calendar/callback`. Register the new origin/callback in Google, then complete consent from the cloud app with the approved account. [Google's OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) explains the server flow. External Testing status generally gives Calendar-scope refresh tokens a seven-day lifetime; plan reconnects or approved production publishing. [Token expiration guidance](https://developers.google.com/identity/protocols/oauth2#expiration).

Configure a Resend receiving domain and signed webhook endpoint, plus the receiving/sending key permissions. Test sending identity constraints before enabling cloud mail. For real buyer delivery, separately establish a verified sender domain and permitted recipient policy; the test sender is not a general Gmail impersonation mechanism.

## Cloud proof and rollback

Prove database persistence, close-browser continuation, process termination/recovery, duplicate delivery, invalid webhook rejection, quota pause/resume, inbox stop behavior and Calendar booking using the approved inbox. Health views distinguish DB/schema, job transport, worker freshness, inbound reconciliation and actual Calendar consent. Free-provider outages or unavailable capacity can delay work despite durable state; expose the delay and bounded retry/dead-letter status rather than promise a response-time SLA.

Rollback begins by pausing enrollment and transport. Roll back application code while retaining expand-only schema. Preserve suppression data, accepted-message records and provider/calendar IDs. Host rollback cannot unsend email, undo invitations or erase scheduled job deliveries. Use a documented checkpoint and reconciliation report before resuming.
