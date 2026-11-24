import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHandler } from "../handler.js";
import {
  createNewsService,
  normalizeArticle,
  parseOpenAIResponse,
} from "../service.js";
import { callAppTool } from "../mcp.js";

const article = {
  uuid: "article-1",
  title: "Central bank publishes outlook",
  url: "https://publisher.example/story",
  source: "Example Publisher",
  description: "The bank kept rates unchanged.",
  published_at: "2026-11-24T08:00:00Z",
};
function fixture() {
  const rows = { news_articles: [], news_cache: [], news_library: [] },
    budgets = new Map();
  const admin = {
    auth: {
      getUser: async (token) => ({
        data: { user: token === "valid" ? { id: "alice" } : null },
        error: null,
      }),
    },
    rpc: async (name, p) => {
      if (name === "news_consume_budget") {
        const count = budgets.get(p.p_bucket) || 0;
        if (count >= p.p_limit) return { data: false };
        budgets.set(p.p_bucket, count + 1);
        return { data: true };
      }
      if (name === "news_set_preference") {
        let row = rows.news_library.find(
          (r) => r.user_id === p.p_user && r.article_id === p.p_article,
        );
        if (!row) {
          row = {
            user_id: p.p_user,
            article_id: p.p_article,
            saved: false,
            liked: false,
          };
          rows.news_library.push(row);
        }
        row[p.p_field] = p.p_value;
        return { data: null };
      }
    },
    from(name) {
      let filters = [],
        single = false;
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        maybeSingle() {
          single = true;
          return q;
        },
        upsert(value) {
          for (const row of Array.isArray(value) ? value : [value]) {
            const key = name === "news_cache" ? "key" : "id";
            const existing = rows[name].find((r) => r[key] === row[key]);
            if (existing) Object.assign(existing, row);
            else rows[name].push({ ...row });
          }
          return Promise.resolve({ data: null });
        },
        then(resolve, reject) {
          let data = rows[name]
            .filter((r) => filters.every((f) => f(r)))
            .map((r) => ({
              ...r,
              ...(name === "news_library"
                ? {
                    article: rows.news_articles.find(
                      (a) => a.id === r.article_id,
                    ),
                  }
                : {}),
            }));
          return Promise.resolve({
            data: single ? data[0] || null : data,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { admin, rows, budgets };
}
const config = {
  appOrigin: "https://app.example",
  marketauxKey: "test-marketaux",
  openaiKey: "test-openai",
};
test("normalization rejects unsafe URLs, bad dates and strips markup", () => {
  assert.equal(
    normalizeArticle({ ...article, url: "javascript:alert(1)" }),
    null,
  );
  assert.equal(normalizeArticle({ ...article, published_at: "bad" }), null);
  assert.equal(
    normalizeArticle({ ...article, title: "<script>bad</script> title" }).title,
    "bad title",
  );
});
test("SDK client interoperates with authenticated stateless HTTP MCP and discovers seven tools", async () => {
  const { admin } = fixture();
  const handler = createHandler({ admin, config });
  const client = new Client({ name: "test-external-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL("https://server.example/news-mcp"),
    {
      requestInit: { headers: { Authorization: "Bearer valid" } },
      fetch: (url, options) => handler(new Request(url, options)),
    },
  );
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 7);
    assert.ok(tools.some((t) => t.name === "research_latest"));
    const result = await client.callTool({
      name: "get_saved_articles",
      arguments: {},
    });
    assert.deepEqual(result.structuredContent, { items: [] });
  } finally {
    await client.close();
  }
});
test("handler rejects anonymous, expired-token, cross-origin, malformed and oversized requests", async () => {
  const { admin } = fixture();
  const handler = createHandler({ admin, config });
  for (const [headers, body, status] of [
    [{}, "{}", 401],
    [{ Authorization: "Bearer invalid" }, "{}", 401],
    [{ Origin: "https://evil.example" }, "{}", 403],
    [{ Authorization: "Bearer valid" }, "{", 400],
    [{ Authorization: "Bearer valid" }, "a".repeat(16001), 413],
  ]) {
    const response = await handler(
      new Request("https://server.example/news-mcp/app", {
        method: "POST",
        headers,
        body,
      }),
    );
    assert.equal(response.status, status);
  }
});
test("news fetch uses provider filters, caches across users and excludes unsafe articles", async () => {
  const { admin, rows } = fixture();
  let calls = 0;
  const fetcher = async (url) => {
    calls++;
    assert.equal(url.searchParams.get("limit"), "3");
    assert.equal(url.searchParams.get("search"), "gold");
    assert.ok(url.searchParams.has("published_after"));
    return Response.json({
      data: [article, { ...article, uuid: "bad", url: "javascript:alert(1)" }],
    });
  };
  const alice = createNewsService({ admin, config, userId: "alice", fetcher });
  assert.equal(
    (await callAppTool(alice, "search_news", { query: "gold", hours: 24 }))
      .articles.length,
    1,
  );
  const bob = createNewsService({ admin, config, userId: "bob", fetcher });
  assert.equal((await bob.search({ query: "gold" })).cached, true);
  assert.equal(calls, 1);
  assert.equal(rows.news_articles.length, 1);
  await assert.rejects(
    () => callAppTool(alice, "search_news", { hours: 999 }),
    (e) => e.status === 400,
  );
});
test("MCP save and like preserve one another and isolate user libraries", async () => {
  const { admin, rows } = fixture();
  rows.news_articles.push(normalizeArticle(article));
  const alice = createNewsService({ admin, config, userId: "alice" }),
    bob = createNewsService({ admin, config, userId: "bob" });
  await callAppTool(alice, "save_article", {
    articleId: "article-1",
    value: true,
  });
  await callAppTool(alice, "like_article", {
    articleId: "article-1",
    value: true,
  });
  const item = (await alice.library()).items[0];
  assert.equal(item.saved, true);
  assert.equal(item.liked, true);
  assert.deepEqual((await bob.library()).items, []);
  await callAppTool(alice, "save_article", {
    articleId: "article-1",
    value: false,
  });
  assert.equal((await alice.library()).items[0].liked, true);
});
test("OpenAI research enables live search, preserves citations, and enforces atomic budgets", async () => {
  const { admin, budgets } = fixture();
  let grounded = false;
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer test-openai");
    assert.equal(body.store, false);
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.tool_choice, "required");
    assert.equal(body.max_tool_calls, 1);
    assert.equal(body.max_output_tokens, 1200);
    assert.equal(body.reasoning.effort, "none");
    assert.equal(body.tools[0].search_context_size, "low");
    grounded =
      body.tools?.[0]?.type === "web_search" &&
      body.tools[0].external_web_access === true;
    return Response.json({
      status: "completed",
      output: [
        { type: "web_search_call", status: "completed" },
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "The bank announced its decision.",
              annotations: [
                {
                  type: "url_citation",
                  start_index: 0,
                  end_index: 31,
                  url: "https://centralbank.example/statement",
                  title: "Official statement",
                },
              ],
            },
          ],
        },
      ],
    });
  };
  const service = createNewsService({
    admin,
    config,
    userId: "alice",
    fetcher,
  });
  const result = await callAppTool(service, "research_latest", {
    query: "Latest central bank news",
  });
  assert.equal(grounded, true);
  assert.equal(result.sources.length, 1);
  assert.equal(result.kind, "web_research");
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].start, 0);
  budgets.set("research:user:alice", 3);
  await assert.rejects(
    () => service.research({ query: "Gold news this morning" }),
    (e) => e.status === 429,
  );
  budgets.clear();
  const noSources = createNewsService({
    admin,
    config,
    userId: "alice",
    fetcher: async () =>
      Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Unverified answer" }],
          },
        ],
      }),
  });
  await assert.rejects(
    () => noSources.research({ query: "Gold today" }),
    (e) => e.code === "no_sources",
  );
});
test("research cache avoids repeated charges and stays scoped to its owner", async () => {
  const { admin } = fixture();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({
      status: "completed",
      output: [
        { type: "web_search_call", status: "completed" },
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Source",
              annotations: [
                {
                  type: "url_citation",
                  start_index: 0,
                  end_index: 6,
                  url: "https://source.example",
                  title: "Source",
                },
              ],
            },
          ],
        },
      ],
    });
  };
  const alice = createNewsService({ admin, config, userId: "alice", fetcher });
  await alice.research({ query: "Gold news today" });
  assert.equal(
    (await alice.research({ query: "Gold news today" })).cached,
    true,
  );
  assert.equal(calls, 1);
  await createNewsService({ admin, config, userId: "bob", fetcher }).research({
    query: "Gold news today",
  });
  assert.equal(calls, 2);
});
test("OpenAI summaries omit web search, honor model override and reuse cache", async () => {
  const { admin, rows } = fixture();
  rows.news_articles.push(normalizeArticle(article));
  let calls = 0;
  const service = createNewsService({
    admin,
    userId: "alice",
    config: { ...config, openaiModel: "custom-model" },
    fetcher: async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.equal(body.model, "custom-model");
      assert.equal(body.tools, undefined);
      assert.equal(body.tool_choice, undefined);
      assert.equal(body.store, false);
      assert.ok(body.input.includes(article.description));
      return Response.json({
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "The excerpt says rates were unchanged.",
              },
            ],
          },
        ],
      });
    },
  });
  const result = await service.summarize({ articleId: "article-1" });
  assert.equal(result.kind, "excerpt_summary");
  assert.equal(result.sources[0].url, article.url);
  await service.summarize({ articleId: "article-1" });
  assert.equal(calls, 1);
});
test("response parsing rejects incomplete, refused, unsafe and unsearched answers and preserves multipart offsets", () => {
  for (const result of [
    { status: "incomplete", output: [] },
    { status: "failed", output: [] },
    {
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "Unable" }],
        },
      ],
    },
  ]) {
    assert.throws(
      () => parseOpenAIResponse(result, false),
      (e) => e.code === "incomplete_answer",
    );
  }
  const parts = [
    { type: "output_text", text: "First paragraph." },
    {
      type: "output_text",
      text: "Source",
      annotations: [
        {
          type: "url_citation",
          start_index: 0,
          end_index: 6,
          url: "https://source.example",
          title: "Source",
        },
        {
          type: "url_citation",
          start_index: 0,
          end_index: 6,
          url: "javascript:alert(1)",
        },
        {
          type: "url_citation",
          start_index: -1,
          end_index: 100,
          url: "https://source.example",
        },
      ],
    },
  ];
  const response = {
    status: "completed",
    output: [
      { type: "web_search_call", status: "completed" },
      { type: "message", role: "assistant", content: parts },
    ],
  };
  const parsed = parseOpenAIResponse(response, true);
  assert.equal(parsed.answer, "First paragraph.\nSource");
  assert.equal(parsed.citations[0].start, 17);
  assert.equal(parsed.citations.length, 1);
  assert.equal(parsed.sources.length, 1);
  assert.throws(
    () =>
      parseOpenAIResponse(
        { ...response, output: response.output.slice(1) },
        true,
      ),
    (e) => e.code === "no_sources",
  );
});
test("missing keys, provider errors and blocked AI do not produce fabricated news", async () => {
  const { admin } = fixture();
  const empty = createNewsService({ admin, config: {}, userId: "alice" });
  await assert.rejects(
    () => empty.search(),
    (e) => e.code === "news_not_configured",
  );
  await assert.rejects(
    () => empty.research({ query: "Gold news today" }),
    (e) => e.code === "ai_not_configured",
  );
  const failed = createNewsService({
    admin,
    config,
    userId: "alice",
    fetcher: async () => new Response("rate limit", { status: 429 }),
  });
  await assert.rejects(
    () => failed.search(),
    (e) => e.code === "provider_unavailable",
  );
});
