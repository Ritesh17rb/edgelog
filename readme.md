# EdgeLog

**Build your edge.**

A private, responsive trading journal for a small group of traders. React/Vite frontend, Supabase Postgres and password authentication, and private screenshots in Supabase Storage.

## Implemented in this foundation

- Individual Supabase email/password sessions; failed logins are never treated as successful demo logins.
- Password recovery and password updates.
- Per-user database isolation through Row Level Security, including composite foreign keys that prevent linking another user's account or strategy.
- Live/demo/prop accounts with separate currencies.
- Trade creation, editing, open/closed status, broker-reported net P&L, initial risk and calculated realised R.
- Device-local trade drafts, optional execution details, psychology and reflections.
- Private PNG/JPEG/WebP screenshots through authenticated Supabase Storage.
- Journal search, account/result/review/date filters, pagination, recoverable deletion and restoration.
- Consistent analytics across the full matching trade history, closed trades only. Decimal arithmetic, drawdown, expectancy, profit factor, streaks, R and breakdowns.
- Monthly calendar and daily plans/reflections, including no-trade days.
- Strategy, mistake and note libraries.
- Persistent timezone/currency preferences and a complete paginated JSON data export.
- Desktop, tablet and phone navigation, dark/light appearance and lazy page loading.

## 1. Create the Supabase database

Create a Supabase project. In its SQL editor, run [001_journal.sql](supabase/migrations/001_journal.sql) **once on a new database**. This creates the schema, constraints, indexes and access policies.

Use a separate development project before importing real records.

For a private 2–3 person deployment, create the users in Supabase Authentication and disable public signups in the dashboard. The app's registration page will then report that signups are disabled. Each user gets their own private records; this release does not share journals between users.

In Authentication URL Configuration:
- Set Site URL to your deployed frontend origin.
- Allow your deployed origin followed by /reset-password as a redirect URL.
- During development also allow http://localhost:5173/reset-password.

For immediate email/password registration, open **Authentication → Sign In / Providers → Email**, turn **Confirm email** off, and save. New accounts then receive a session immediately and open the dashboard without a verification email. The frontend already supports this flow. `supabase/config.toml` disables confirmation for local Supabase too; it does not change the hosted project's settings.

Configure custom SMTP for real invitation and password recovery emails. Supabase's built-in email sender is intended for testing and restricts recipients. Password recovery still uses an email link.

## 2. Run the frontend

Google sign-in is available on login and registration after configuring the Google provider in Supabase. See [the Google sign-in setup guide](docs/google-sign-in.md). Google credentials stay in Supabase; the frontend uses the same two variables below.

Requirements: Node 22.12+ and npm.

From frontend/:

    npm ci

Copy .env.example to .env.local and fill in:

    VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY

Use the project's publishable key (or legacy anon key). **Never put a secret/service-role key in a VITE_ variable.** These values are bundled into the browser. RLS is what protects database access.

    npm run dev

Open the URL printed by Vite. Create a trading account before logging your first trade. Screenshots require the private storage migration in step 3.

When Supabase is not configured, the sign-in page displays setup instructions and disables submission. There is no silent demo backend or fake authentication.

## 3. Configure private Supabase Storage (free plan)

Cloudflare R2 and its billing setup are no longer required. The active app uses Supabase Storage alongside the existing database and authentication.

In your existing Supabase project's SQL Editor, run [002_private_storage.sql](supabase/migrations/002_private_storage.sql). This creates a private journal-images bucket, limits images to PNG/JPEG/WebP under 5 MB, and creates owner-folder policies for uploads, downloads and deletion. The storage migration is safe to rerun. Do not rerun 001_journal.sql on an existing database.

The frontend needs only the same Supabase URL and publishable key already configured. There is no extra image API key, Worker URL or payment setup. Images live under the signed-in user's UUID. Downloads require authentication and become temporary browser blob URLs.

Keep the project on Supabase Free. Its published allowance is currently 1 GB file storage, with separate transfer quotas. Monitor Usage and archive or remove images as you approach the allowance. Free storage is finite; this app does not activate billing or upgrade plans.

Detached screenshots are currently retained so recoverable trades are not broken. Image compression and orphan cleanup remain follow-ups. JSON exports contain image keys rather than image files; back up storage separately.

Documentation:
- https://supabase.com/pricing
- https://supabase.com/docs/guides/storage/security/access-control

## 4. Deploy the frontend on Vercel

Production frontend: [EdgeLog](https://edgelog-iota-six.vercel.app). Source: [Ritesh17rb/edgelog](https://github.com/Ritesh17rb/edgelog) (public). The Vercel project is connected to the repository's `main` branch with `frontend` as its root directory.

When ready, import the new repository into Vercel with these settings:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework Preset | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js | 22.x |

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as Vercel environment variables before building. Copy the values from your ignored local `frontend/.env.local`; do not commit that file. Never add broker secrets or a Supabase service-role key to frontend variables. The legacy `backend/` is not deployed.

`frontend/vercel.json` includes the SPA rewrite required for direct links to dashboard routes, password reset and the Zerodha callback. See [Vercel's Vite documentation](https://vercel.com/docs/frameworks/frontend/vite).

After the final domain is assigned, update Supabase Authentication's Site URL and allow `https://YOUR-DOMAIN/reset-password`. Keep the localhost reset redirect for development. Supabase database, storage and Edge Functions remain hosted on Supabase.

For Zerodha, also update `APP_ORIGIN` and `ZERODHA_REDIRECT_URL` in Supabase Edge Function secrets, and set the identical callback URL in the Kite app. See [the broker setup guide](docs/zerodha-setup.md). Existing local environment files are preserved; production URLs must match the final deployed origin.

Cloudflare Pages remains an alternative: use the same frontend build settings; `frontend/public/_redirects` supports its SPA routing.

## Zerodha trade import

The optional **Integrations → Zerodha** workflow supports the free Personal API: secure broker login, today's execution preview, duplicate-safe import into a Supabase inbox, and confirmed conversion of complete positions into INR journal trades. Secrets and encrypted broker sessions stay server-side. Run migration 003 and deploy/configure the Edge Function before connecting. See [the complete setup guide](docs/zerodha-setup.md). This initial version enables one configured journal owner and does not place orders or fetch paid market data.

## News and AI research through MCP

Open **News** for financial stories, topic/date searches, a synced saved/liked reading list, original-link sharing, excerpt summaries and an OpenAI web research desk. The authenticated Supabase `news-mcp` function exposes the same seven tools to standard MCP clients. Apply migration 004, deploy the function, and configure server-side Marketaux/OpenAI keys to enable the providers. Missing keys produce setup messages rather than fabricated stories. See [architecture, deployment and MCP connection instructions](docs/news-mcp.md).

## Price alerts

Open Markets and select the bell or the Alerts tab. Create up to 20 one-shot alerts for gold, silver or the supported crypto pairs, with an inclusive at/above or at/below USD level. Pause/resume, rearm, delete, and filter active/paused/triggered alerts. Definitions and trigger history are scoped to the signed-in account in this browser's local storage; they are not synced to Supabase or other devices. No migration, API key, card or paid account is needed.

Monitoring continues across journal routes while the signed-in app is open. It polls active symbols about every 30 seconds, rejects quotes older than two minutes or malformed responses, retries outages, and records the observed trigger price/time. It can trigger on the first valid sample if the condition is already satisfied. Brief moves between checks can be missed. It stops on logout, browser closure or device sleep, and browser background throttling can delay checks. No closed-app push/email/SMS delivery is provided. A Web Lock and storage events coordinate tabs where supported; keep one app tab open on browsers without Web Locks to avoid duplicate notifications.

Gold/silver use [Gold API's free public spot endpoint](https://gold-api.com/docs); crypto uses [Coinbase Exchange's public last-trade ticker](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker). These independent feeds may differ from the chart's OANDA/Bitstamp feed or your execution broker. Forex alerts are unavailable until a suitable live forex feed is configured. The chart embed does not supply quote data to our alert engine. Provider requests contain only the requested public instrument, never journal records or credentials.

In-app banners work without notification permission. Sound is optional and must be enabled by a user gesture each session. Desktop notifications are opt-in, require browser support/permission and HTTPS (or localhost), and do not enable closed-app monitoring. Mobile browser support varies. Local storage restrictions are surfaced as a session-only warning.

## Markets: forex, metals and crypto

The Markets page embeds TradingView's free Advanced Chart widget for a supported catalogue of forex pairs, gold/silver USD feeds and crypto pairs. Indian exchanges are not included in the chart selector. No TradingView API key, paid data subscription or extra Supabase migration is required.

- Search the instrument catalogue or select a symbol from the chart toolbar.
- Save a per-user watchlist, selected symbol and timeframe on this browser/device. These preferences are not synced between devices.
- The chart follows Light/Dark/System appearance and can expand to fill the workspace. Markets uses a chart-first terminal layout with compact controls and a collapsible right watchlist. The top navbar stays pinned; the left sidebar collapse button lives beside the logo, or below it in icon mode.
- Log trade opens a separate instrument-specific draft with the pair prefilled and the chart's provider recorded as a reference. Existing general drafts are preserved.
- The feed is hosted by TradingView. Provider branding and attribution remain visible. Quote availability and freshness are governed by that provider; broker/CFD prices can differ from the execution venue.
- No fake candles or fallback prices are generated. Network/content-blocker failures expose a retry action. A loaded iframe is not treated as proof of live ticks.
- Embedded chart tools are controlled by TradingView; changes made inside the widget are not automatically saved to the journal. The embedded prices do not calculate account P&L.
- Only the Markets route loads the external chart script. TradingView receives the displayed symbol and standard browser connection metadata; journal records, screenshots and Supabase credentials are not sent as widget configuration.

Browser tests stub the external embed so UI tests remain deterministic. The optional frontend/scripts/check-markets.mjs smoke check uses process-environment credentials and the actual provider chart. It makes no journal writes.

Provider documentation:
- https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/
- https://www.tradingview.com/widget-docs/faq/data/
- https://www.tradingview.com/widget-docs/markets/worldwide/

## Calculations and date semantics

net_pnl is the broker-reported final result, after all costs, in the account's currency. Optional fees and swap are reference fields and are **not subtracted again**. No universal price × lot-size calculation is assumed; contract specifications differ by instrument.

- Realised R = net P&L / initial risk. Missing initial risk produces no R value.
- Planned reward-to-risk is a different concept and is not inferred from realised R.
- Win rate = positive closed trades / all closed trades, including breakevens.
- Profit factor is undefined when gross loss is zero; the UI displays a dash.
- Breakevens break consecutive win/loss streaks.
- Drawdown is based on chronological closed-trade net results, not intratrade mark-to-market equity.
- Charts show cumulative net P&L, not a live account equity curve.
- Account currencies are never combined. No implicit exchange rate conversion.
- Analytics and calendar group by **exit date** in the configured journal timezone; the journal date filter uses entry date.
- Entry/edit datetime controls use the device timezone and save UTC timestamps. Details show the configured journal timezone.
- Trade list ordering is by entry time; analytics ordering is by close time.

Starting balances are stored but this release does not yet have a deposit/withdrawal ledger or true account-equity accounting.

## Tests

From frontend/:

    npm test
    npx playwright install chromium
    npm run test:browser
    npm run build

Unit tests cover financial calculations and execute the SQL migration in PGlite PostgreSQL, including anonymous access, cross-user reads/writes, foreign-key ownership, invalid closed trades and soft-delete recovery. PGlite provides meaningful PostgreSQL checks but does not replace testing against a real Supabase deployment.

Browser tests use **test-only network fixtures**, not live Supabase credentials. They cover failed login, protected routing, desktop/tablet/mobile layout, trade CRUD/recovery, drafts and daily reviews. Screenshots are written to frontend/test-results/.

Storage-policy tests run with npm test above and verify private bucket configuration and per-user image access.

## Existing data and legacy code

The previous Express/MongoDB/Cloudinary backend and old presentation components remain in the repository, but the active app does not use them. Do not run the old backend as part of this setup. Its custom authentication is not part of the new app.

Existing MongoDB data is **not automatically migrated**. Export it and preserve Cloudinary screenshots before any migration. Old records may have conflicting netPnl/profitLoss fields, missing dates, account identity or currency. Those values must be reconciled rather than guessed. Existing passwords are not migrated: invite users or reset their passwords in Supabase.

## Remaining roadmap

- Previewed, validated CSV import with duplicate detection.
- A safe migration tool for the actual legacy dataset after its format is available.
- Partial fills/exits and instrument-specific contract calculations.
- Deposit/withdrawal ledger and balance accounting.
- Linked mistake tags, strategy rule snapshots, weekly review summaries and checklist scoring.
- Screenshot compression/annotation, orphan cleanup, independent image backups.
- Audit history, stronger draft navigation protection and optional offline/PWA support.
- Broker integrations or optional AI extraction after the core data is reliable.

Local drafts are stored per user on that browser/device; selected image files must be reselected after a reload. Daily reviews save explicitly. JSON exports contain image keys, not image binaries. Back up the database and private bucket separately.

## Live data and sample cleanup

The application renders the signed-in user's Supabase records. Empty accounts and failed requests do not fall back to invented trades, statistics, charts or reflection text. Automated tests use separate fixtures under frontend/tests; these are not served by the application.

The earlier sample account and its labelled records were removed. A recovery copy and the retired chart images are in the ignored backups/ directory, outside the public app. The seeding command and chart generator have been removed.

The one-time frontend/scripts/remove-demo.mjs utility identifies only the original sample IDs and markers, preserves unrelated records, and makes a local recovery export before applying a cleanup. Credentials are read only from process environment variables.

## Keeping credentials out of Git

Local environment variants, key/credential files, private key formats, cloud credential directories, build output and Python caches are ignored. Sanitized .env.example templates remain versionable. Ignore rules do not protect files that were already tracked, so the credential guard also inspects actual Git index contents.

The local pre-commit guard is installed with:

    git config core.hooksPath .githooks

Run this once in each fresh clone. It requires Python and blocks commits if the staged content contains a recognized API token, private key, credential URL, hardcoded credential assignment or prohibited credential filename. It checks staged blobs, even when the working copy has subsequently been cleaned. Reports contain filenames and finding types, never credential values.

Manual checks from the repository root:

    python scripts/check_secrets.py
    python scripts/check_secrets.py --staged
    python scripts/check_secrets.py --history
    python -m unittest discover -s scripts -p test_check_secrets.py -v

The scanner is pattern-based and local hooks can be bypassed; it is a useful safeguard, not a guarantee that every possible credential format will be detected. Keep real values in ignored local environment files. Supabase publishable keys are intentionally present in the browser bundle at runtime; secret/service-role keys must never be placed in frontend environment variables.
