# Free cloud demo deployment

The demonstration uses the existing Render **Free Node Web Service** and existing Neon database. No paid service, disk, worker, custom domain or Vercel plan is required. The deployment branch is `deploy/free-cloud-demo-2026-10-08`; `main` remains unchanged.

## Runtime boundary

- Render runs `corepack pnpm install --frozen-lockfile && corepack pnpm build:cloud`, then `corepack pnpm start:cloud` on Node 24.
- The cloud build clears provider/database credentials in its child process and disables all workers. Only runtime startup performs controlled database migrations, under a session advisory lock, before starting HTTP.
- PostgreSQL stores research jobs, results and email conversation state. Never copy local PGlite files to Render's ephemeral filesystem.
- Research and email funnel workers run in the persistent Node process while the service is awake. Legacy outreach and saved-search schedulers stay off.
- Demo outreach is restricted server-side to the approved Hritik Gmail, one prospect per new search, with the existing shared limit of ten delivery attempts per day. No actual buyer delivery is enabled.
- Keep all credentials in ignored local files and Render's environment settings. Previously exposed provider keys should be rotated. Do not put secrets in `NEXT_PUBLIC_*` variables.

## Free-host limitations

Render Free sleeps after 15 minutes without inbound traffic, and restarts can interrupt work. PostgreSQL preserves durable records but cannot run the worker while the service sleeps. Open the app before a supervised demo and inspect progress; this is not an always-on follow-up service. External provider free quotas also remain in force.

## Account consent

In the existing Google OAuth Web client, add:

- JavaScript origin: `https://epcprocurement-demo.onrender.com`
- Redirect URI: `https://epcprocurement-demo.onrender.com/api/mvp/automation/calendar/callback`
- Test user: the approved Hritik Gmail.

Log into the cloud app, open **Email automation**, click **Connect Google Calendar**, and grant consent with the approved account. Local Calendar authorization is not copied to the cloud database. An OAuth client secret alone is not Calendar consent.

Resend uses the configured managed receiving domain and the server-side receiving API poller. A webhook is not required for this persistent-process demo. Replies are processed only while the Render service is awake. Keep the Resend test sender and its single-account-recipient restriction.

## Release and proof

1. Preserve existing cloud data, suppressions and the cloud session secret; back up existing environment configuration privately.
2. Run the production build, unit/integration tests and tracked-source credential scan.
3. Push only the deployment branch, configure only the verified existing Free service, and run additive pending migrations.
4. Deploy the branch and verify the deployment commit, readiness endpoint, login, main pages, server errors and configuration.
5. Enable the approved-inbox funnel through the authenticated app after verifying its configuration. Enrollment starts with new searches, not historical searches.
6. Run at most one supervised real search; verify the recorded research progress and source-backed companies without fabricating results or spending verification credits unnecessarily.
7. Reconnect Calendar, receive and reply to a new demo conversation, select an offered slot, and verify the real event/Meet link. Do not report cloud reply/booking proof before the external account steps have completed.

The operator helper `scripts/deploy-render-demo.mjs` scopes mutations to the existing service ID, repository, workspace and Free plan. It supports `audit`, `prepare`, `migrate`, `deploy`, `status` and `logs`. Saved environment backups are under ignored `tmp/free-cloud-deploy/`; they contain secrets and must never be committed or shared.

## Rollback

Disable funnel enrollment before rollback. Repoint the Render service to a known-good compatible commit and redeploy; retain expand-only migrations and historical delivery/calendar IDs. Rolling back code does not unsend mail or cancel meetings. Do not clear the database or recipient suppressions.

## Observed deployment proof — 8 October 2026

- Render deployed application commit `86b14b1` successfully on the verified Free service. `main` was not changed.
- The existing database advanced from nine to 22 migrations. Its six pre-existing searches, 34 lead records and 54 companies were preserved.
- The isolated production build passed. The existing full suite passed 850 tests with two skipped; the added cloud-build isolation test passed separately.
- Public health returned 200, unauthenticated protected requests returned 401, and cloud password login succeeded. Browser checks passed Overview, New search, My leads, Email automation and Settings without JavaScript errors.
- One real Saudi ductile-iron-pipe research run completed independently of the browser: three search calls, 20 read attempts, 17 stored documents and three AI analysis calls. It saved **zero qualified prospects** and reported partial coverage. This proves cloud execution, not adequate buyer-discovery quality; no prospect email was sent for that search.
- A separately labelled inbox-only diagnostic introduction was automatically processed by the cloud worker. Resend reported **delivered**, to the single approved Gmail, with the correct managed-domain Reply-To. No actual buyer was contacted or fabricated.
- Funnel enrollment is enabled, with one prospect per new search and the existing delivery caps. At this checkpoint Google OAuth URLs were registered by the operator, but cloud Calendar consent had not completed. Cloud AI replies and Calendar/Meet booking are not yet proven by this deployment check.
- Raw browser captures and private operator evidence are in ignored `tmp/free-cloud-deploy/`. Do not share its environment backup.

References: [Render Free limitations](https://render.com/docs/free), [Next.js on Render](https://render.com/docs/deploy-nextjs-app), [Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Resend receiving](https://resend.com/docs/dashboard/receiving/introduction).
