# 23 · Deploy handoff: universal search MVP to `main` (Render)

For Codex (or whoever deploys). Written 14 Oct 2026, after the local end-to-end test passed:
1. search;
2. true buyers;
3. demo emails;
4. reply;
5. meeting slots;
6. booked meeting.

Read docs 21 and 22 for the why; this file is only the how.

## 1. What is being deployed
Branch `feat/universal-search` = `origin/main` (`5df6b51`) + 5 commits (the 4 below plus this handoff, `3424c39`), so this is a **fast-forward**:

| Commit | What |
|---|---|
| `7a39234` | Docs 21 (sources) and 22 (implementation plan) |
| `15cd0af` | Universal search: any typed product. Open tenders first (tender18 read directly for India; tender portals per country). Tender issuers saved as direct buyers (fit 95) with due dates. Parts, service and masked tenders rejected |
| `7da4537` | "Our products" in Settings plus a Dashboard card. Tender leads emailed (`verified_tender`), naming the tender and its closing date. 15 tender languages. Claims golden set (precision 1.0). **Migration `031_company_products.sql`** |
| `a32b1c5` | One lead per company ("EIL" = "Engineers India Limited"). Plain role labels for typed products. Email queue no longer blocked by a waiting thread |

Render service: `epcprocurement-demo` (`srv-dav4k5t9fdbs73b8smp0`), https://epcprocurement-demo.onrender.com. It deploys branch `main`, free plan, and Node 24.

## 2. Rules (do not break)
- **Pushing.** Push only as `deeptendu-kuri`. Plain `git push` fails with 403 (wrong stored credential), so use:
  `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin feat/universal-search:main`
- **Approval needed.** Get the user's OK before any of these:
  - pushing to `main` (that is the deploy);
  - changing Render settings;
  - running the migration (it runs automatically on start, see §4).
- **No force-push** to `main`. To roll back, use Render's "Rollback" (§6).
- **Never commit** `.env*`, `tmp/` or `.data`.
- **Never print secret values.** `.env.production.local` holds a Render API key and a **stale** database URL and Resend key. Do not use its `DATABASE_URL` or `RESEND_API_KEY`; Render's own settings are the truth.
- **Email limits.** Demo emails go only to the approved inbox `hritikdebnath00@gmail.com`. No real buyer may be emailed without explicit user and client approval. No LinkedIn scraping.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or your own), and commit only when the checks pass.

## 3. Before deploying
1. **Ask the user** for:
   - **(a)** OK to deploy and create the new table on Neon (migration 031: `create table if not exists company_products`, seeded with the client's 7 products; additive, nothing changed or deleted);
   - **(b)** the client's **salesperson name** and **company name** for the emails.
2. **Render settings.** Make these changes in the dashboard, or with the Render API: `PUT /v1/services/{id}/env-vars/{key}`, using the API key in `.env.production.local`.
   - `SALES_PERSON_NAME`: currently "Hritik Debnath", who is also the demo customer who receives the emails. Set it to the client's salesperson.
   - `SALES_COMPANY_NAME`: missing; add it.
   - Already correct, verify only:
     - `MVP_WORK_SEARCH=on`, `TAVILY_API_KEY` (its own key);
     - `APP_URL=https://epcprocurement-demo.onrender.com`;
     - `APPROVED_DEMO_RECIPIENT_EMAIL=hritikdebnath00@gmail.com`;
     - `MVP_FUNNEL_WORKER=on`, `MVP_PROSPECT_DEMO_OUTREACH=on`, `MVP_DEMO_PROSPECTS_PER_SEARCH=3`.
   - Changing a setting may start a deploy of the *current* `main`. That is harmless, but do it before the push so the new deploy picks it up.
3. **Optional: fix the one failing test.** In `src/mvp/automation/engine.test.ts`, "limits chasing to two working-hour follow-ups…" fails on `main` too.
   - Cause: it creates the thread at the real date, then sets the fake clock back to 12 Oct. The "reply" is then dated before the thread and is correctly ignored.
   - Fix: set the fake clock before `seed()`, or use a date relative to now (next Monday 10:30 Asia/Kolkata).
   - This is a test-only change.
4. **Checks.** The laptop has little free memory, so run them in this order:
   1. `npx tsc --noEmit`
   2. `npm run lint`
   3. `npx vitest run <folder> --maxWorkers=1` per folder:
      - `src/mvp/discovery`, `src/mvp/sourcing`
      - `src/mvp/research`
      - `src/mvp/automation`, `src/mvp/evidence`, `src/mvp/opportunities`, `src/mvp/crm`, `src/mvp/pipeline`
      - `src/app`, `src/components`, `scripts`
      - the rest of `src/mvp`
   4. `npm run build`

   Expected: all pass except the follow-up test above (unless fixed). Tests that take about 6 s can time out under memory pressure; re-run them alone.

## 4. Deploy
1. Push the fast-forward (command in §2).
2. Watch the deploy in the Render dashboard, or with `GET /v1/services/srv-dav4k5t9fdbs73b8smp0/deploys?limit=1`, until it is `live`.
3. On start, `scripts/start-cloud.mjs` runs `migrateCloud()` **before** the server starts.
   - It applies `031_company_products.sql`.
   - If the migration fails, the server does not start and the log says "database migration failed". Roll back (§6) and report.

## 5. Check after deploying (on https://epcprocurement-demo.onrender.com)
1. `GET /api/mvp/health` → `{"ok":true}`. The free plan sleeps, so the first request can take about 1 minute.
2. Sign in, then check:
   - the **Dashboard** shows "Your products" (7 chips) and a "Manage" link;
   - **Settings → Our products** can add and remove products;
   - `/find?q=Pressure%20Vessels` opens with the product filled in.
3. **The user connects Google Calendar on Render.** This needs their Google login.
   - Path: Settings → Email & Calendar setup → Connect, as hritikdebnath00@gmail.com.
   - The redirect `https://epcprocurement-demo.onrender.com/api/mvp/automation/calendar/callback` is already allowed in Google Cloud.
   - If Google says `redirect_uri_mismatch`, `APP_URL` is wrong.
   - The Google OAuth app should be **In production**, otherwise the connection expires every 7 days.
4. **Search:** Quick, "pressure vessels", India. It takes about 5–10 minutes.
   - The run events show "Tender for pressure vessel found…" from **tender18.com**. This proves Render can read tender18; if not, report the reader error.
   - Leads include at least one **"Buyer · own tender"** with a due date (tender listings change daily) and contractor leads with quotes.
   - There are no duplicate companies and no "Utility" or "Pipeline builder" labels.
5. **Emails:** up to 3 demo emails, to hritikdebnath00@gmail.com only.
   - The tender lead's email says "I came across your tender for … (closing …)".
   - Every email has "We also supply …".
6. **Reply test:** the user replies "set a meeting". The app should email 3 slots (10:00–18:00 IST); the user replies with one; the app should book a Calendar event with a Meet link.
7. Report:
   - leads (name, role, why, source);
   - email states;
   - anything that differs from the local test (doc 22 §3.17).

## 6. Rollback
- **Code:** Render dashboard → service → Deploys → previous deploy (`5df6b51`) → **Rollback**. No git change is needed. The new table stays; old code ignores it.
- Do not drop the table or force-push without the user's approval.

## 7. Known limits (tell the user; not deploy blockers)
- **Gulf:** few tender buyers, because Gulf tenders mostly hide the buyer; leads come mainly from award news. India is the strongest.
- **Known misses in the claims set:**
  - HPCL "six refinery reactors" (a reactor is a pressure vessel; the words differ);
  - MES (the agency name is on a separate line).
- **AI translations:** the AI's local-language product names are not checked (one wrong Arabic name seen). They can miss local pages but cannot create a lead alone.
- **Free tiers:**
  - Groq: about 7k tokens a minute and 200k a day; a busy AI parks a reply thread in review → click Retry;
  - Tavily: 1,000 searches a month;
  - Resend: shared by local and Render (same key and receiving domain).
- **Quality check:** `npx vitest run src/mvp/research/eval/claims.test.ts` replays 53 hand-labelled real claims. `EVAL_LIVE=1` also asks the live AI (about a day of Groq free tokens). Add each new false lead the client reports as a labelled row before fixing it.
