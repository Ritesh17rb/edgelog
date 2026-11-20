# Zerodha Personal integration

This first version connects one Zerodha Personal app to one authorised Supabase user. It imports today's executions into a review inbox and creates journal trades only after the user selects a complete position and confirms net P&L. It does not place orders, fetch paid market data, provide historic trade-book backfill, or manage broker alerts yet. Existing Markets charts and price alerts continue independently.

## 1. Database

In Supabase SQL Editor, create a new query and run **the entire** `supabase/migrations/003_zerodha.sql` file once. Migrations 001 and 002 should already have been applied. RLS is included in the SQL; do not disable it. The migration is transactional and additive. It is not intended to be run repeatedly after it succeeds.

It adds two server-only tables (encrypted broker sessions and login state) and a user-owned execution inbox. Browser roles cannot read broker tokens, insert/edit execution snapshots, or write the execution-to-trade links directly. The journal RPC checks ownership, INR account currency, unlinked fills, balanced quantities, product/instrument identity and position direction. It creates the trade and links the fills in one transaction.

## 2. Create the Zerodha app

Use your deployed journal's final HTTPS URL. Ensure the host serves the SPA for nested URLs (the repository includes Cloudflare Pages/Vercel SPA configuration).

| Field | Value |
| --- | --- |
| Type | Personal — Free |
| App name | EdgeLog |
| Client ID | Your actual Zerodha client ID |
| Redirect URL | `https://YOUR-HOST/dashboard/integrations/zerodha/callback` |
| Postback URL | Leave blank; this version uses manual sync |
| Description | Personal trading journal for importing executions and reviewing trading performance. |

Save the app's API key and secret directly into Supabase's server secrets. Do not paste credentials into chat, commit them, or use frontend `VITE_*` variables for them. The callback URL's origin must match `APP_ORIGIN` and its path must match the exact path above. Local testing can use `http://localhost:5173/dashboard/integrations/zerodha/callback` if accepted by your Kite app configuration; use that same origin to access the frontend.

## 3. Configure server secrets

In Supabase Dashboard → Edge Functions → Secrets, set:

| Name | Value |
| --- | --- |
| `APP_ORIGIN` | Your frontend origin only, e.g. `https://YOUR-HOST`, without a trailing slash |
| `ZERODHA_OWNER_USER_ID` | Your journal user's UUID from Supabase Authentication → Users, not the email |
| `ZERODHA_CLIENT_ID` | The exact client ID entered in the Kite app |
| `ZERODHA_API_KEY` | The Kite app API key |
| `ZERODHA_API_SECRET` | The Kite app API secret |
| `ZERODHA_REDIRECT_URL` | The exact redirect URL registered above |
| `ZERODHA_TOKEN_ENCRYPTION_KEY` | Random 32-byte key encoded as Base64 |

Generate the encryption key locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and paste it into Secrets. Do not save the output in tracked files. Losing/changing this encryption key requires reconnecting the broker. Supabase supplies its own URL and service-role key inside the function environment automatically. Never put the service-role key into the frontend.

`supabase/functions/.env.example` lists placeholders only. A local `.env.local` secret file remains ignored by Git.

## 4. Deploy the Edge Function

From the repository root, with Supabase CLI authenticated to your project:

```powershell
npx supabase login
npx supabase functions deploy zerodha --project-ref YOUR_PROJECT_REF
```

Deploy the entire function folder, including `index.ts`, `handler.js` and `core.js`. The checked-in `supabase/config.toml` sets `verify_jwt = false` for this function because it performs **its own mandatory** bearer-token verification with `auth.getUser()` on every action. This is not an unauthenticated function. It also restricts operations to `ZERODHA_OWNER_USER_ID` and the configured frontend origin. Keep those checks intact.

No new frontend environment variables are needed. Build/deploy the updated frontend using the existing Supabase URL and publishable key. No additional paid data subscription is required for this workflow; normal Supabase free-tier quotas still apply.

This version only reads broker executions. Zerodha permits account-read endpoints from any IP; its static-IP requirement applies to API order placement. A paid static-IP server is therefore not needed for this import workflow. See [Zerodha's static-IP guidance](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/static-ip).

## 5. Use and verify

1. Sign in to EdgeLog as the configured owner and open **Integrations**.
2. Select **Connect Zerodha** and authorise on the real Kite website. The journal never asks for your broker password or TOTP.
3. The callback consumes a ten-minute, single-use state tied to your Supabase user. It verifies the returned Zerodha client ID, encrypts the access token with AES-GCM and stores it server-side. The short-lived request token is removed from the browser URL immediately.
4. Return to Integrations and select **Preview today’s trades**. Verify instrument, side, quantity, price and IST execution time.
5. Import selected fills. Repeating the import skips identical client/day/exchange/order/trade identifiers and never overwrites saved fills or journal edits.
6. Select matching entry/exit fills in the inbox, choose an INR account (or create one), enter final net P&L including all charges, and confirm the position. Each complete position gets its own journal record. Partial fills can be combined; separate round trips must be journaled separately.
7. Edit the resulting trade to add strategy, risk, screenshots and reflections. Refresh/reimport to verify it stays linked. Moving the trade to the bin retains its execution links; restore it rather than importing it again.
8. Check the same page on a phone. Confirm another Supabase user cannot connect the owner's broker or see their execution inbox.
9. Disconnect and verify the stored session is removed while imported records remain. The app also attempts broker-side token revocation; if it cannot confirm that, it tells you to revoke the API session in Kite.

Kite sessions expire at 6 AM IST the next day and may be invalidated earlier by the broker. Reconnect when prompted. Fetching/importing requires a valid session; reviewing saved fills and creating journal entries does not. The import endpoint re-fetches executions from Kite, so browser-provided prices, quantities, client IDs and user IDs are never trusted.

Kite's trade book exposes today's fills. Import each trading day to build a durable history. Historical candle access is not historical account trade history. Overnight positions can be journaled once both sides have been saved on their respective days. Existing manually logged trades are not automatically matched; leave overlapping fills in the inbox to avoid double counting. Fees and final net P&L are not inferred from fills, especially for derivatives.

For 2–3 separate Zerodha accounts, each client needs their own Personal app credentials. This initial deployment intentionally enables only one configured owner; it does not share their broker session with other journal users. Multi-account onboarding is a later extension.

## Validation

`npm test` in `frontend` includes deterministic server-handler, token-encryption, timestamp, owner-isolation and database import tests. Browser integration tests mock Kite/Edge Function responses without making broker requests or placing orders. A real login/import smoke test is still required after configuring and deploying to your Supabase project. Zerodha does not offer a sandbox.

References: [Kite authentication](https://kite.trade/docs/connect/v3/user/), [daily trades](https://kite.trade/docs/connect/v3/orders/), [Personal pricing](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/what-are-the-charges-for-kite-apis), [Supabase function authentication](https://supabase.com/docs/guides/functions/auth).
