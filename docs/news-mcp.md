# News and the EdgeLog MCP server

EdgeLog includes a responsive news reading room at `/dashboard/news` and an authenticated, stateless MCP endpoint. Its seven tools search financial news, retrieve provider excerpts, read the user's library, save/unsave, like/unlike, summarise an excerpt, and research a question using Google Search through Gemini. Sources and research timestamps accompany briefings. Sharing sends the original publisher URL or copies a sourced briefing.

## Architecture

The React page invokes `news-mcp/app` with the current Supabase session. The Edge Function verifies that session with Supabase Auth on every request. App operations use an official MCP SDK client connected to the same MCP server through an in-memory transport; there is one tool implementation for the app and external MCP clients. External clients use the standard Streamable HTTP transport at `/functions/v1/news-mcp`.

The research desk sends one question at a time to the `research_latest` tool. That tool calls Gemini with Google Search enabled. It does not currently run an autonomous multi-tool conversation, access trade records, or save articles based on model output. Save and like actions are explicit user operations. External AI hosts can discover and combine the MCP tools themselves.

MCP is the interface; Marketaux supplies the feed and Gemini supplies AI generation and Google Search grounding. There is no scraping of Google result pages, no browser-exposed provider key, and no dependency on the legacy Express backend.

## Configure and deploy

1. Apply the additive migration `supabase/migrations/004_news.sql` to the existing database. Do not rerun migrations 001–003. For a project with managed CLI access:

   ```powershell
   npx supabase db query --remote=YOUR_PROJECT_REF --file supabase/migrations/004_news.sql --yes
   ```

2. Create a [Marketaux API account](https://www.marketaux.com/) and a [Gemini API key](https://aistudio.google.com/apikey). Add these names in **Supabase Dashboard → Edge Functions → Secrets**:

   | Secret | Purpose |
   | --- | --- |
   | `MARKETAUX_API_KEY` | Financial news feed |
   | `GEMINI_API_KEY` | Excerpt summaries and Google-backed research |
   | `NEWS_APP_ORIGIN` | Exact frontend origin, e.g. `https://edgelog-iota-six.vercel.app`. Falls back to `APP_ORIGIN` if unset; the separate setting preserves broker integration configuration. |
   | `GEMINI_MODEL` | Optional; defaults to `gemini-3.5-flash-lite`. Use a model supporting `generateContent` and Google Search grounding in your account. |
   | `NEWS_ARTICLES_PER_REQUEST` | Optional; defaults to 3, matching the Marketaux free tier's per-request allowance. |

   Never put provider keys in a `VITE_` variable, Git, or chat. No paid subscription is activated by deploying this code. Provider eligibility, quotas, billing, and model availability depend on your accounts.

3. Deploy only this function:

   ```powershell
   npx supabase functions deploy news-mcp --remote=YOUR_PROJECT_REF --use-api --no-verify-jwt --yes
   ```

   Gateway JWT verification is disabled because the handler explicitly verifies each user bearer token through Supabase Auth, accommodating Supabase's current signing keys. This is not an anonymous function.

4. Build/deploy the existing frontend as usual. No additional frontend environment variables are required.

Missing provider keys produce an explicit setup state. Feed and research operate independently: Gemini-only configuration still permits web research; Marketaux-only configuration permits reading/saving/liking news.

Google Search grounding on the default model requires an eligible paid-tier Gemini project; the free generation tier alone does not enable this search capability. Check [Google's current model pricing](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite#pricing) before enabling it. This implementation does not activate billing for you.

## Connect an MCP client

URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/news-mcp`

Use Streamable HTTP and send `Authorization: Bearer <current-user-Supabase-access-token>` on every request. The token must belong to the signed-in user; service-role keys are never client credentials. A host using the official TypeScript SDK can connect as follows (variables must come from its secure runtime/session):

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'my-news-assistant', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), {
  requestInit: { headers: { Authorization: `Bearer ${userAccessToken}` } },
}));
const { tools } = await client.listTools();
const result = await client.callTool({
  name: 'search_news', arguments: { query: 'gold', hours: 24 },
});
await client.close();
```

This initial endpoint supports clients that can supply a Supabase user bearer token. It does **not** implement OAuth discovery/consent for one-click installation into ChatGPT or other external hosts. Such hosts may require a separate OAuth integration. Sessions expire normally; clients must refresh their Supabase sessions. Browser-origin requests are restricted to the configured app origin and explicit local development origins. Non-browser clients can omit Origin.

| Tool | Inputs |
| --- | --- |
| `search_news` | `query` (up to 200 characters), `hours` (1–168, default 24) |
| `get_article` | `articleId` returned by news search |
| `get_saved_articles` | None; returns up to 200 recent library entries with saved/liked flags |
| `save_article` | `articleId`, boolean `value` |
| `like_article` | `articleId`, boolean `value` |
| `summarize_article` | `articleId` |
| `research_latest` | `query` (5–1,200 characters) |

Only articles already ingested from the news provider can be saved/liked. Web research returns source links, not provider article IDs. Research briefings can be copied/shared; saving arbitrary web sources is a future extension.

## Freshness, privacy and operating limits

- Feed queries are cached across users for 10 minutes and fetched on demand. There is no background schedule or guarantee of immediate breaking-news coverage. The app shows retrieval and publication times separately.
- Marketaux results store headline metadata and supplied excerpts, not full article text. Summary output is explicitly labelled as an excerpt summary. Review your provider/publisher terms for display, images, retention and AI processing before enabling credentials for public use; API access does not automatically grant all reuse rights.
- Summary responses are shared for up to 24 hours. Google-grounded research responses are generated on demand, not persisted in the shared cache. Source links, grounding support metadata and Google search attribution are returned. Google attribution renders inside a sandboxed iframe without script or same-origin access.
- Reading-list rows belong to their authenticated user and are protected by RLS. Shared article metadata is readable only by signed-in users; provider caches, budget rows and all privileged functions are server-only. Trade journals are not supplied to providers.
- Budget counters are atomic and persistent: 30 feed cache misses/user/day, 80 feed calls globally/day, 20 AI generations/user/day and 100 AI generations globally/day. A failed provider request still consumes a counter. These are application limits, separate from provider billing limits; adjust only with an explicit budget decision. Day boundaries follow the database's current date.
- Saving and liking use a database function that changes only the selected preference, preventing concurrent operations from resetting one another. The UI shows the 200 most recently updated library entries.
- Cached rows are logically expired on reads. There is no automatic cleanup job in this version; operators should periodically remove expired `news_cache` rows and old `news_budgets` rows. Article/library retention is ongoing until explicitly deleted; account deletion cascades to that user's library. News images are loaded from publisher URLs with no referrer.
- The assistant separates facts from interpretation in its instructions, but AI output still requires source checking. Search indexing can lag events; apparent timing alone does not prove a market cause.

## Verification

```powershell
cd supabase/functions/news-mcp
npm ci
npm test
cd ../../../frontend
node --test tests/newsDatabase.test.js
npm run test:browser -- --grep "news saves|mobile news|unconfigured news"
npm run build
```

Tests exercise actual SDK client/server interoperability, authentication and origin rejection, provider failures, caching, budgets, save/like isolation, RLS and mobile/desktop UI behavior. Provider HTTP responses are mocked; real news coverage and model access require a live smoke test after credentials are configured.
