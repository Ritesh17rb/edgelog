# News and the EdgeLog MCP server

EdgeLog includes a responsive news reading room at `/dashboard/news` and an authenticated, stateless MCP endpoint. Its seven tools search financial news, retrieve provider excerpts, read the user's library, save/unsave, like/unlike, summarise an excerpt, and research a question using OpenAI web search. Sources and research timestamps accompany briefings. Sharing sends the original publisher URL or copies a sourced briefing.

## Architecture

The React page invokes `news-mcp/app` with the current Supabase session. The Edge Function verifies that session with Supabase Auth on every request. App operations use an official MCP SDK client connected to the same MCP server through an in-memory transport; there is one tool implementation for the app and external MCP clients. External clients use the standard Streamable HTTP transport at `/functions/v1/news-mcp`.

Production fetches GDELT through the app's Vercel `/api/gdelt` relay because GDELT throttled Supabase's shared egress address during live verification. The relay accepts only a separate internal bearer token and validated search parameters; it never receives user sessions, journal records or OpenAI credentials. Provider rate limits are respected, not retried through rotating hosts. Shared pacing and persistent feed caching remain in Supabase. Direct fetching is available when the optional relay configuration is absent.

The research desk sends one question at a time to the `research_latest` tool. That tool calls the OpenAI Responses API with web search enabled. It does not currently run an autonomous multi-tool conversation, access trade records, or save articles based on model output. Save and like actions are explicit user operations. External AI hosts can discover and combine the MCP tools themselves.

MCP is the interface; GDELT supplies keyless news discovery and OpenAI supplies summaries and web research. There is no scraping of search result pages, no browser-exposed provider key, and no dependency on the legacy Express backend.

The feed uses GDELT's DOC 2.0 API with English-language financial-topic queries, date ranges and up to 20 headlines per request by default. No news-provider account or API key is required. Results include links, publisher domains, optional images and indexing times; publication times and article excerpts are not supplied. Namespaced article IDs and feed caches preserve earlier saved articles without mixing providers. The News API and Marketaux keys are no longer used. See [GDELT API documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) and [dataset usage terms](https://www.gdeltproject.org/about.html). Attribution to GDELT appears in the news page footer. Publisher article/image rights remain separate from GDELT dataset terms.

## Configure and deploy

1. Apply the additive migrations `supabase/migrations/004_news.sql` and `supabase/migrations/005_gdelt.sql` (only those not already applied) to the existing database. Do not rerun migrations 001–003. For a project with managed CLI access:

   ```powershell
   npx supabase db query --remote=YOUR_PROJECT_REF --file supabase/migrations/004_news.sql --yes
   npx supabase db query --remote=YOUR_PROJECT_REF --file supabase/migrations/005_gdelt.sql --yes
   ```

2. Use your existing [OpenAI API key](https://platform.openai.com/api-keys). Add these names in **Supabase Dashboard → Edge Functions → Secrets**:

   | Secret | Purpose |
   | --- | --- |
   | `OPENAI_API_KEY` | Excerpt summaries and OpenAI web research |
   | `NEWS_APP_ORIGIN` | Exact frontend origin, e.g. `https://edgelog-iota-six.vercel.app`. Falls back to `APP_ORIGIN` if unset; the separate setting preserves broker integration configuration. |
   | `OPENAI_MODEL` | Optional; defaults to `gpt-6-luna`. Overrides must support the Responses API and its `web_search` tool in your OpenAI project. |
   | `NEWS_ARTICLES_PER_REQUEST` | Optional; defaults to 20 GDELT results per query (maximum 100 in this app). |
   | `NEWS_GDELT_RELAY_URL` | Optional Supabase secret: the app's `https://YOUR_ORIGIN/api/gdelt` endpoint. |
   | `NEWS_GDELT_FETCH_TOKEN` | Internal random token, set identically in Supabase secrets and Vercel production environment variables. Never use a user session or provider API key here. Required when enabling the relay. |

   Never put provider keys in a `VITE_` variable, Git, or chat. No paid subscription is activated by deploying this code. Provider eligibility, quotas, billing, and model availability depend on your accounts.

3. Deploy only this function:

   ```powershell
   npx supabase functions deploy news-mcp --remote=YOUR_PROJECT_REF --use-api --no-verify-jwt --yes
   ```

   Gateway JWT verification is disabled because the handler explicitly verifies each user bearer token through Supabase Auth, accommodating Supabase's current signing keys. This is not an anonymous function.

4. Build/deploy the existing frontend as usual. No additional frontend environment variables are required.

The feed is available without a news API key. OpenAI is needed only for AI features. Headline-only cards offer **Research story**, which prepares a question without making an AI request. Users explicitly submit **Research the web** to spend research credits. Existing saved articles with excerpts still support excerpt summaries. Direct MCP summary requests for headline-only articles return `no_excerpt` without an AI call.

Use a project key with Responses API access, an available model and API billing/credits. Web search incurs provider tool charges in addition to model usage; check [OpenAI pricing](https://developers.openai.com/api/docs/pricing). The default model is selected for low cost, with capped outputs, cached summaries/research and strict daily allowances. Model overrides do not trigger automatic fallback to a more expensive model. This implementation does not activate billing for you. The Gemini key is no longer used.

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

- Feed queries are cached across users for 10 minutes and fetched on demand. A database lease paces provider cache misses at least five seconds apart across users/instances; a busy request waits once, checks the cache again, and otherwise asks the user to retry. There is no background schedule or guarantee of immediate breaking-news coverage. The app shows retrieval and indexing times separately, and publication times for older saved articles where available.
- GDELT results store headline metadata, publisher links, images where available and `indexed_at`; `published_at` is null. The UI explicitly labels indexing dates. Headlines are never treated as article excerpts. Existing provider excerpts retain their summary behavior; no article scraping is performed.
- Summary responses are shared for up to 24 hours. OpenAI web research responses are generated on demand and cached for 10 minutes under a user-specific key; they are never shared across users. The original research time remains visible. Requests set `store: false`. Source URLs and citation character spans are returned; the UI renders prominent clickable citations in the answer and a source list. Unsearched, incomplete and uncited research responses are rejected. Excerpt summaries use a separate OpenAI cache namespace. Research allows at most one built-in tool call per generation, with a low search context. The default model uses no reasoning effort and caps output at 600 tokens for summaries and 1,200 for research.
- Reading-list rows belong to their authenticated user and are protected by RLS. Shared article metadata is readable only by signed-in users; provider caches, budget rows and all privileged functions are server-only. Trade journals are not supplied to providers.
- Budget counters are atomic and persistent: 30 feed cache misses/user/day, 80 feed calls globally/day, 20 summary generations/user/day, 100 summary generations globally/day, 3 web research generations/user/day and 10 web research generations globally/day. A failed provider request still consumes a counter. These are application limits, separate from provider billing limits; adjust only with an explicit budget decision. Day boundaries follow the database's current date.
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
npm run test:browser -- --grep "news saves|mobile news|news outages|GDELT headlines"
npm run build
```

Tests exercise actual SDK client/server interoperability, authentication and origin rejection, provider failures, caching, budgets, save/like isolation, RLS and mobile/desktop UI behavior. Provider HTTP responses are mocked; live GDELT access can be checked with `python scripts/smoke_news.py --feed` (creates and deletes a temporary Auth user, makes no AI calls). Model generation still requires configured OpenAI access.
