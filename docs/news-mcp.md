# News and the EdgeLog MCP server

EdgeLog includes a responsive news reading room at `/dashboard/news` and an authenticated, stateless MCP endpoint. Its seven tools search financial news, retrieve provider excerpts, read the user's library, save/unsave, like/unlike, summarise an excerpt, and research a question using OpenAI web search. Sources and research timestamps accompany briefings. Sharing sends the original publisher URL or copies a sourced briefing.

## Architecture

The React page invokes `news-mcp/app` with the current Supabase session. The Edge Function verifies that session with Supabase Auth on every request. App operations use an official MCP SDK client connected to the same MCP server through an in-memory transport; there is one tool implementation for the app and external MCP clients. External clients use the standard Streamable HTTP transport at `/functions/v1/news-mcp`.

The research desk sends one question at a time to the `research_latest` tool. That tool calls the OpenAI Responses API with web search enabled. It does not currently run an autonomous multi-tool conversation, access trade records, or save articles based on model output. Save and like actions are explicit user operations. External AI hosts can discover and combine the MCP tools themselves.

MCP is the interface; The News API supplies the feed and OpenAI supplies summaries and web research. There is no scraping of search result pages, no browser-exposed provider key, and no dependency on the legacy Express backend.

The feed uses The News API's `/v1/news/all` endpoint, available on its free plan. The default view filters business news; asset/topic searches use keyword queries across categories. Requests stay at three articles by default. Provider article IDs and feed cache keys are namespaced to keep older saved articles usable without mixing provider caches. The old Marketaux key is no longer used. See [provider documentation](https://www.thenewsapi.com/documentation) and [current free allowances](https://www.thenewsapi.com/pricing).

## Configure and deploy

1. Apply the additive migration `supabase/migrations/004_news.sql` to the existing database. Do not rerun migrations 001–003. For a project with managed CLI access:

   ```powershell
   npx supabase db query --remote=YOUR_PROJECT_REF --file supabase/migrations/004_news.sql --yes
   ```

2. Create a free [The News API account](https://www.thenewsapi.com/register) and use your existing [OpenAI API key](https://platform.openai.com/api-keys). Add these names in **Supabase Dashboard → Edge Functions → Secrets**:

   | Secret | Purpose |
   | --- | --- |
   | `THENEWSAPI_API_KEY` | Financial news feed |
   | `OPENAI_API_KEY` | Excerpt summaries and OpenAI web research |
   | `NEWS_APP_ORIGIN` | Exact frontend origin, e.g. `https://edgelog-iota-six.vercel.app`. Falls back to `APP_ORIGIN` if unset; the separate setting preserves broker integration configuration. |
   | `OPENAI_MODEL` | Optional; defaults to `gpt-6-luna`. Overrides must support the Responses API and its `web_search` tool in your OpenAI project. |
   | `NEWS_ARTICLES_PER_REQUEST` | Optional; defaults to 3, matching The News API’s free tier's per-request allowance. |

   Never put provider keys in a `VITE_` variable, Git, or chat. No paid subscription is activated by deploying this code. Provider eligibility, quotas, billing, and model availability depend on your accounts.

3. Deploy only this function:

   ```powershell
   npx supabase functions deploy news-mcp --remote=YOUR_PROJECT_REF --use-api --no-verify-jwt --yes
   ```

   Gateway JWT verification is disabled because the handler explicitly verifies each user bearer token through Supabase Auth, accommodating Supabase's current signing keys. This is not an anonymous function.

4. Build/deploy the existing frontend as usual. No additional frontend environment variables are required.

Missing provider keys produce an explicit setup state. Feed and research operate independently: OpenAI-only configuration still permits web research; The News API-only configuration permits reading/saving/liking news.

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

- Feed queries are cached across users for 10 minutes and fetched on demand. There is no background schedule or guarantee of immediate breaking-news coverage. The app shows retrieval and publication times separately.
- The News API results store headline metadata and supplied excerpts, not full article text. Summary output is explicitly labelled as an excerpt summary. Review your provider/publisher terms for display, images, retention and AI processing before enabling credentials for public use; API access does not automatically grant all reuse rights.
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
npm run test:browser -- --grep "news saves|mobile news|unconfigured news"
npm run build
```

Tests exercise actual SDK client/server interoperability, authentication and origin rejection, provider failures, caching, budgets, save/like isolation, RLS and mobile/desktop UI behavior. Provider HTTP responses are mocked; real news coverage and model access require a live smoke test after credentials are configured.
