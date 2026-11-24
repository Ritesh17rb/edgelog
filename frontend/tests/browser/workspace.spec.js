import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("price alerts persist, pause, trigger across routes, and fire once", async ({
  page,
}) => {
  await fixtures(page);
  await marketEmbedFixture(page);
  await page.clock.install();
  let price = 3900;
  await page.route("https://api.gold-api.com/price/XAU", (route) =>
    route.fulfill({
      json: {
        symbol: "XAU",
        currency: "USD",
        price,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
  await page.goto("/dashboard/markets");
  await page.getByRole("button", { name: "Open price alerts" }).click();
  await page.getByLabel("Target price (USD)").fill("4000");
  await page.getByRole("button", { name: "Create alert", exact: true }).click();
  const card = page.locator(".price-alert-card");
  await expect(card).toContainText("3,900 USD");
  await card.getByRole("button", { name: "Pause", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Open price alerts" }).click();
  await expect(card).toContainText("paused");
  await card.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(card).toContainText("3,900 USD");
  price = 4100;
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Journal", exact: true })
    .click();
  await page.clock.runFor(31000);
  await expect(page.locator(".price-alert-toast")).toContainText(
    "XAUUSD: 4,100 USD",
  );
  await page.getByRole("button", { name: "Dismiss alert" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Markets", exact: true })
    .click();
  await page.getByRole("button", { name: "Open price alerts" }).click();
  await expect(card).toContainText("triggered");
  await expect(card).toContainText("Triggered at 4,100 USD");
  await page.clock.runFor(31000);
  await expect(page.locator(".price-alert-toast")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Open price alerts" }).click();
  await expect(card).toContainText("triggered");
  await card.getByRole("button", { name: "Rearm", exact: true }).click();
  await expect(page.locator(".price-alert-toast")).toBeVisible();
  await card.getByRole("button", { name: "Delete XAUUSD alert" }).click();
  await expect(card).toHaveCount(0);
});

test("mobile alerts reject stale prices and retry without false alarms", async ({
  page,
}) => {
  await fixtures(page);
  await marketEmbedFixture(page);
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = false;
  await page.route("https://api.gold-api.com/price/XAU", (route) =>
    fail
      ? route.fulfill({ status: 503, body: "Unavailable" })
      : route.fulfill({
          json: {
            symbol: "XAU",
            price: 5000,
            updatedAt: new Date(Date.now() - 3600000).toISOString(),
          },
        }),
  );
  await page.goto("/dashboard/markets");
  await page.getByRole("button", { name: "Open price alerts" }).click();
  await page.getByLabel("Target price (USD)").fill("4000");
  await page.getByRole("button", { name: "Create alert", exact: true }).click();
  await expect(page.locator(".price-alert-card")).toContainText(
    "No fresh price",
  );
  await expect(page.locator(".price-alert-toast")).toHaveCount(0);
  await expect(
    page.getByText("Forex alerts need a separate live feed", { exact: false }),
  ).toBeVisible();
  expect(
    await page
      .getByLabel("Alert instrument")
      .locator("option")
      .allTextContents(),
  ).not.toContain("EURUSD");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/alerts-mobile.png",
    fullPage: true,
  });
  fail = true;
  await page.clock.runFor(31000);
  await expect(page.locator(".price-alert-card")).toContainText(
    "Price feed unavailable",
  );
  await expect(page.locator(".price-alert-toast")).toHaveCount(0);
});
const owner = "11111111-1111-4111-8111-111111111111";
const account = {
  id: "33333333-3333-4333-8333-333333333333",
  user_id: owner,
  name: "Trading account",
  currency: "USD",
  kind: "Demo",
  starting_balance: 10000,
  created_at: "2026-01-01",
};
const user = {
  id: owner,
  email: "trader@example.com",
  role: "authenticated",
  aud: "authenticated",
  user_metadata: { name: "Test Trader" },
  created_at: "2026-01-01",
};
async function fixtures(page, { signedIn = true } = {}) {
  const rows = {
    accounts: [account],
    profiles: [
      {
        id: owner,
        name: "Test Trader",
        currency: "USD",
        timezone: "Asia/Kolkata",
      },
    ],
    trades: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        user_id: owner,
        account_id: account.id,
        instrument: "EURUSD",
        direction: "Long",
        status: "Closed",
        traded_at: "2026-10-20T08:00:00Z",
        closed_at: "2026-10-20T10:00:00Z",
        net_pnl: 125,
        initial_risk: 50,
        reviewed: false,
        details: { session: "London", images: [] },
        deleted_at: null,
      },
    ],
    strategies: [],
    mistakes: [],
    notes: [],
    daily_reviews: [],
    broker_executions: [],
  };
  if (signedIn)
    await page.addInitScript(
      ({ user }) => {
        const encode = (v) =>
          btoa(JSON.stringify(v))
            .replaceAll("=", "")
            .replaceAll("+", "-")
            .replaceAll("/", "_");
        const token =
          encode({ alg: "HS256", typ: "JWT" }) +
          "." +
          encode({
            sub: user.id,
            exp: Math.floor(Date.now() / 1000) + 3600,
            role: "authenticated",
          }) +
          ".test";
        localStorage.setItem(
          "sb-journal-test-auth-token",
          JSON.stringify({
            access_token: token,
            refresh_token: "test-refresh",
            token_type: "bearer",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            expires_in: 3600,
            user,
          }),
        );
      },
      { user },
    );
  await page.route("https://journal-test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname.includes("/auth/v1/token"))
      return route.fulfill({
        status: 400,
        json: {
          error: "invalid_grant",
          error_description: "Invalid login credentials",
        },
      });
    if (url.pathname.includes("/auth/v1/user"))
      return route.fulfill({ json: user });
    if (url.pathname.includes("/auth/v1/logout"))
      return route.fulfill({ status: 204 });
    const table = url.pathname.split("/").pop();
    let data = rows[table] || [];
    const object = req.headers().accept?.includes("vnd.pgrst.object");
    if (req.method() === "GET") {
      for (const [key, value] of url.searchParams) {
        if (value.startsWith("eq."))
          data = data.filter((r) => String(r[key]) === value.slice(3));
        if (value === "is.null") data = data.filter((r) => r[key] == null);
        if (value === "not.is.null") data = data.filter((r) => r[key] != null);
      }
      return route.fulfill({ json: object ? data[0] || null : data });
    }
    const input = req.postDataJSON();
    if (req.method() === "POST") {
      const item = {
        ...input,
        id: input.id || crypto.randomUUID(),
        user_id: owner,
        deleted_at: null,
      };
      rows[table].push(item);
      return route.fulfill({ status: 201, json: object ? item : [item] });
    }
    if (req.method() === "PATCH") {
      const id = url.searchParams.get("id")?.slice(3),
        item = rows[table].find((r) => r.id === id);
      if (item) Object.assign(item, input);
      return route.fulfill({ json: object ? item : [item] });
    }
    return route.fulfill({ json: [] });
  });
  return rows;
}

async function newsFixture(
  page,
  { configured = true, failResearch = false, headlineOnly = false } = {},
) {
  const article = {
    id: "news-1",
    title: "Central bank holds rates as markets assess inflation",
    source: "Example Financial News",
    url: "https://example.com/markets/rates",
    description:
      "Policymakers kept rates unchanged while outlining their outlook for inflation and economic growth.",
    published_at: "2026-11-24T08:00:00Z",
  };
  const items = [];
  if (headlineOnly) {
    article.description = "";
    article.published_at = null;
    article.indexed_at = "2026-11-24T08:00:00Z";
  }
  const calls = [];
  await page.route(
    "https://journal-test.supabase.co/functions/v1/news-mcp/app",
    async (route) => {
      const { action, args } = route.request().postDataJSON();
      calls.push({ action, args });
      if (action === "status")
        return route.fulfill({
          json: { news: true, ai: true, provider: "gdelt" },
        });
      if (action === "library") return route.fulfill({ json: { items } });
      if (action === "feed")
        return configured
          ? route.fulfill({
              json: {
                articles: [
                  article,
                  {
                    ...article,
                    id: "news-2",
                    title: "Gold traders look ahead to economic data",
                  },
                ],
                fetchedAt: "2026-11-24T08:01:00Z",
                cached: false,
              },
            })
          : route.fulfill({
              status: 503,
              json: {
                error: "GDELT is temporarily unavailable. Please retry.",
              },
            });
      if (action === "save" || action === "like") {
        let row = items.find((i) => i.article_id === args.articleId);
        if (!row) {
          row = {
            article_id: args.articleId,
            article,
            saved: false,
            liked: false,
          };
          items.push(row);
        }
        row[action === "save" ? "saved" : "liked"] = args.value;
        return route.fulfill({
          json: { articleId: args.articleId, value: args.value },
        });
      }
      if (action === "research" && failResearch)
        return route.fulfill({
          status: 502,
          json: {
            error:
              "No verifiable web sources were returned. Try a more specific question.",
          },
        });
      return route.fulfill({
        json: {
          answer:
            action === "research"
              ? "The official statement confirms unchanged rates."
              : "The excerpt reports that rates were unchanged.",
          sources: [{ title: "Original statement", url: article.url }],
          citations:
            action === "research"
              ? [
                  {
                    start: 4,
                    end: 22,
                    url: article.url,
                    title: "Original statement",
                  },
                ]
              : [],
          researchedAt: "2026-11-24T08:02:00Z",
          kind: action === "research" ? "web_research" : "excerpt_summary",
        },
      });
    },
  );
  return { article, calls };
}
test("news saves and likes survive reload, summaries identify excerpts, and research includes sources", async ({
  page,
}) => {
  await fixtures(page);
  const { article, calls } = await newsFixture(page);
  await page.goto("/dashboard/news");
  await expect(
    page.getByRole("heading", { name: "A wider perspective. A sharper edge." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save " + article.title, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Like " + article.title, exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Saved", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: article.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Like " + article.title, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "AI summary", exact: true }).click();
  await expect(
    page.getByText(
      "Based on the publisher excerpt; the full article was not read.",
    ),
  ).toBeVisible();
  await page
    .getByLabel("What’s on your radar?")
    .fill("What are the latest central bank updates?");
  await page
    .getByRole("button", { name: "Research the web", exact: true })
    .click();
  await expect(page.locator(".news-research .news-answer")).toContainText(
    "official statement",
  );
  await expect(page.locator(".news-research .news-answer a")).toHaveAttribute(
    "href",
    article.url,
  );
  await expect(
    page
      .locator(".news-research")
      .getByRole("link", { name: "Original statement", exact: false }),
  ).toHaveAttribute("href", article.url);
  expect(calls.some((c) => c.action === "research")).toBe(true);
  await page
    .getByRole("button", { name: "Save " + article.title, exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "A little less noise. A reading list of your own.",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/news-desktop.png",
    fullPage: true,
  });
});
test("mobile news fits viewport, filters topics, and presents research errors honestly", async ({
  page,
}) => {
  await fixtures(page);
  const { calls } = await newsFixture(page, { failResearch: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/news");
  await page
    .getByRole("button", { name: "Gold & metals", exact: true })
    .click();
  await expect
    .poll(() => calls.filter((c) => c.action === "feed").at(-1)?.args.query)
    .toBe("gold | silver");
  await page.getByLabel("Search news", { exact: true }).fill("inflation");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect
    .poll(() => calls.filter((c) => c.action === "feed").at(-1)?.args.query)
    .toBe("inflation");
  await page
    .getByLabel("What’s on your radar?")
    .fill("What happened today in gold?");
  await page
    .getByRole("button", { name: "Research the web", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "No verifiable web sources",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/news-mobile.png",
    fullPage: true,
  });
});
test("news outages show a retry without invented stories and leave research available", async ({
  page,
}) => {
  await fixtures(page);
  await newsFixture(page, { configured: false });
  await page.goto("/dashboard/news");
  await expect(page.getByRole("alert")).toContainText(
    "GDELT is temporarily unavailable",
  );
  await expect(page.locator(".news-card")).toHaveCount(0);
  await page
    .getByLabel("What’s on your radar?")
    .fill("Latest gold market context");
  await expect(
    page.getByRole("button", { name: "Research the web", exact: true }),
  ).toBeEnabled();
});
test("GDELT headlines label indexing dates and prepare research without automatically spending credits", async ({
  page,
}) => {
  await fixtures(page);
  const { calls } = await newsFixture(page, { headlineOnly: true });
  await page.goto("/dashboard/news");
  await expect(
    page.locator(".news-card").first().locator("time"),
  ).toContainText("Indexed");
  await expect(
    page.getByRole("button", { name: "AI summary", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Research story", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("What’s on your radar?")).toHaveValue(
    /Research the latest context for this headline/,
  );
  expect(
    calls.some(
      (call) => call.action === "research" || call.action === "summarize",
    ),
  ).toBe(false);
  await expect(
    page.getByRole("link", { name: "GDELT", exact: true }),
  ).toHaveAttribute("href", "https://www.gdeltproject.org/");
  await page
    .getByRole("button", { name: "Research the web", exact: true })
    .click();
  await expect(page.locator(".news-research .news-answer")).toContainText(
    "official statement",
  );
});

async function brokerFixture(
  page,
  rows,
  { configured = true, connected = true, expired = false } = {},
) {
  const executions = [
    {
      client_id: "TEST01",
      execution_key: "2026-10-29:NSE:11:1",
      trade_id: "1",
      order_id: "11",
      exchange: "NSE",
      instrument: "TEST",
      product: "MIS",
      side: "BUY",
      quantity: 2,
      price: 100,
      executed_at: "2026-10-29T04:00:00Z",
    },
    {
      client_id: "TEST01",
      execution_key: "2026-10-29:NSE:12:2",
      trade_id: "2",
      order_id: "12",
      exchange: "NSE",
      instrument: "TEST",
      product: "MIS",
      side: "SELL",
      quantity: 2,
      price: 110,
      executed_at: "2026-10-29T05:00:00Z",
    },
  ];
  const calls = [];
  await page.route(
    "https://journal-test.supabase.co/functions/v1/zerodha",
    async (route) => {
      const input = route.request().postDataJSON();
      calls.push(input);
      if (input.action === "status")
        return route.fulfill({
          json: {
            configured,
            connected: configured && connected,
            clientId: "TEST01",
            expiresAt: "2026-10-30T00:30:00Z",
            reason: configured ? null : "setup_required",
          },
        });
      if (input.action === "preview")
        return route.fulfill(
          expired
            ? {
                status: 409,
                json: {
                  error: "Your Zerodha session expired. Connect again.",
                  code: "session_expired",
                },
              }
            : { json: { day: "2026-10-29", executions } },
        );
      if (input.action === "import") {
        let imported = 0;
        for (const row of executions.filter((r) =>
          input.keys.includes(r.execution_key),
        )) {
          if (
            rows.broker_executions.some(
              (r) => r.execution_key === row.execution_key,
            )
          )
            continue;
          rows.broker_executions.push({
            id: crypto.randomUUID(),
            user_id: owner,
            ...row,
            linked_trade_id: null,
          });
          imported++;
        }
        return route.fulfill({
          json: { imported, skipped: input.keys.length - imported },
        });
      }
      if (input.action === "exchange") {
        connected = true;
        return route.fulfill({ json: { connected: true } });
      }
      if (input.action === "disconnect") {
        connected = false;
        return route.fulfill({ json: { disconnected: true, revoked: true } });
      }
      if (input.action === "connect")
        return route.fulfill({
          json: {
            url: "https://kite.zerodha.com/connect/login?v=3&api_key=test-key&redirect_params=state%3Dtest-state",
          },
        });
      return route.fulfill({
        status: 400,
        json: { error: "Unexpected action" },
      });
    },
  );
  await page.route(
    "https://journal-test.supabase.co/rest/v1/rpc/journal_zerodha_executions",
    async (route) => {
      const input = route.request().postDataJSON();
      expect(input.p_execution_ids).toHaveLength(2);
      expect(Number(input.p_net_pnl)).toBe(0);
      expect(
        rows.accounts.find((a) => a.id === input.p_account_id).currency,
      ).toBe("INR");
      const id = crypto.randomUUID();
      rows.trades.push({
        id,
        user_id: owner,
        account_id: input.p_account_id,
        instrument: "NSE:TEST",
        direction: "Long",
        status: "Closed",
        traded_at: executions[0].executed_at,
        closed_at: executions[1].executed_at,
        net_pnl: 0,
        reviewed: false,
        deleted_at: null,
        details: {
          importSource: "Zerodha",
          quantity: 2,
          entryPrice: 100,
          exitPrice: 110,
          images: [],
        },
      });
      rows.broker_executions
        .filter((r) => input.p_execution_ids.includes(r.id))
        .forEach((r) => {
          r.linked_trade_id = id;
        });
      return route.fulfill({ json: id });
    },
  );
  return calls;
}

test("Zerodha previews, imports once, and journals reviewed fills into an INR account", async ({
  page,
}) => {
  const rows = await fixtures(page);
  await brokerFixture(page, rows);
  await page.goto("/dashboard/integrations");
  await expect(page.getByText("Client TEST01", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Preview today’s trades" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("body *"))
          .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
          .map((el) => ({
            tag: el.tagName,
            class: el.className,
            right: el.getBoundingClientRect().right,
          }))
          .slice(0, 15),
      ),
    )
    .toEqual([]);
  await page.screenshot({
    path: "test-results/zerodha-preview-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Import selected (2)" }).click();
  await expect(page.getByRole("status")).toContainText("2 executions imported");
  await expect(
    page.getByRole("button", { name: "Import selected (0)" }),
  ).toBeDisabled();
  const inbox = page.getByRole("region", { name: "Import inbox" });
  await inbox.getByLabel("Select execution 1", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Create journal trade" }),
  ).toBeDisabled();
  await inbox.getByLabel("Select execution 2", { exact: true }).check();
  await page.getByRole("button", { name: "Create INR account" }).click();
  await page.getByLabel("Broker-reported net P&L (INR)").fill("0");
  await page.getByLabel("I confirm these fills", { exact: false }).check();
  await page.getByRole("button", { name: "Create journal trade" }).click();
  await expect(page).toHaveURL(/\/dashboard\/trade\//);
  await expect(page.getByRole("heading", { name: "NSE:TEST" })).toBeVisible();
  await expect(page.getByText("Zerodha", { exact: true })).toBeVisible();
  expect(rows.broker_executions).toHaveLength(2);
  expect(rows.broker_executions.every((r) => r.linked_trade_id)).toBe(true);
  await page.goto("/dashboard/integrations");
  await expect(
    page.getByText("0 pending executions", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview today’s trades" }).click();
  await expect(
    page.getByRole("button", { name: "Import selected (0)" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Zerodha disconnected");
  expect(rows.broker_executions).toHaveLength(2);
});

test("Zerodha callback consumes its token once and removes it from the address bar", async ({
  page,
}) => {
  const rows = await fixtures(page);
  const calls = await brokerFixture(page, rows, { connected: false });
  await page.goto(
    "/dashboard/integrations/zerodha/callback?request_token=test-request-token&state=test-state&status=success",
  );
  await expect(page.getByRole("status")).toContainText("Zerodha connected");
  await expect(page).toHaveURL(/\/callback$/);
  expect(calls.filter((c) => c.action === "exchange")).toEqual([
    {
      action: "exchange",
      requestToken: "test-request-token",
      state: "test-state",
    },
  ]);
  await page.getByRole("link", { name: "Return to Integrations" }).click();
  await expect(
    page.getByRole("button", { name: "Preview today’s trades" }),
  ).toBeVisible();
});

test("Zerodha setup and expired sessions explain the next step on phones", async ({
  page,
}) => {
  const rows = await fixtures(page);
  await brokerFixture(page, rows, { configured: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard/integrations");
  await expect(
    page.getByRole("button", { name: "Connect Zerodha", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Apply migration 003", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await brokerFixture(page, rows, { expired: true });
  await page.reload();
  await page.getByRole("button", { name: "Preview today’s trades" }).click();
  await expect(page.getByRole("alert")).toContainText("session expired");
  await expect(
    page.getByRole("button", { name: "Connect Zerodha", exact: true }),
  ).toBeEnabled();
  expect(rows.broker_executions).toHaveLength(0);
  await page.screenshot({
    path: "test-results/zerodha-mobile.png",
    fullPage: true,
  });
});
test("email signup without confirmation opens the dashboard and persists the session", async ({
  page,
}) => {
  await fixtures(page, { signedIn: false });
  let signup;
  await page.route("**/auth/v1/signup**", async (route) => {
    signup = route.request().postDataJSON();
    await route.fulfill({
      json: {
        access_token: [
          Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
            "base64url",
          ),
          Buffer.from(
            JSON.stringify({
              sub: owner,
              exp: Math.floor(Date.now() / 1000) + 3600,
              role: "authenticated",
            }),
          ).toString("base64url"),
          "test",
        ].join("."),
        refresh_token: "test-signup-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user: { ...user, email_confirmed_at: new Date().toISOString() },
      },
    });
  });
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Test Trader");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: false }).fill("test-password-123");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(signup.email).toBe(user.email);
  expect(signup.data.name).toBe("Test Trader");
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  const session = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("sb-journal-test-auth-token")),
  );
  expect(session.user.id).toBe(owner);
});

test("Google sign-in is offered on login and registration and starts the correct OAuth flow", async ({
  page,
}) => {
  await fixtures(page, { signedIn: false });
  await page.route("**/auth/v1/settings", (route) =>
    route.fulfill({ json: { external: { google: true } } }),
  );
  await page.route("**/auth/v1/authorize?**", (route) =>
    route.fulfill({ contentType: "text/html", body: "Google sign-in handoff" }),
  );
  for (const path of ["/login", "/register"]) {
    await page.goto(path);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(
      /journal-test\.supabase\.co\/auth\/v1\/authorize/,
    );
    const url = new URL(page.url());
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe(
      "http://127.0.0.1:5174/login",
    );
    expect(url.searchParams.get("prompt")).toBe("select_account");
  }
});

test("disabled Google provider keeps users on the form with email sign-in available", async ({
  page,
}) => {
  await fixtures(page, { signedIn: false });
  await page.route("**/auth/v1/settings", (route) =>
    route.fulfill({ json: { external: { google: false } } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Google sign-in isn't available yet",
  );
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("sb-journal-test-auth-token"),
    ),
  ).toBeNull();
});

test("Google provider outages can be retried without creating a session", async ({
  page,
}) => {
  await fixtures(page, { signedIn: false });
  await page.route("**/auth/v1/settings", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/login");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Google sign-in is unavailable right now",
  );
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeEnabled();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("Google OAuth return restores the session and opens the dashboard", async ({
  page,
}) => {
  await fixtures(page, { signedIn: false });
  const googleUser = { ...user, user_metadata: { full_name: "Google Trader" } };
  await page.route("**/auth/v1/user", (route) =>
    route.fulfill({ json: googleUser }),
  );
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token =
    encode({ alg: "HS256", typ: "JWT" }) +
    "." +
    encode({
      sub: owner,
      exp: Math.floor(Date.now() / 1000) + 3600,
      role: "authenticated",
    }) +
    ".test";
  const hash = new URLSearchParams({
    access_token: token,
    refresh_token: "test-refresh",
    expires_in: "3600",
    token_type: "bearer",
  });
  await page.goto("/login#" + hash);
  await expect(page).toHaveURL(/\/dashboard$/);
  const session = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("sb-journal-test-auth-token")),
  );
  expect(session.user.id).toBe(owner);
  expect(session.user.user_metadata.full_name).toBe("Google Trader");
  expect(new URL(page.url()).hash).toBe("");
});

test("cancelled Google OAuth returns show an error and do not authenticate", async ({
  page,
}) => {
  await fixtures(page, { signedIn: false });
  for (const suffix of [
    "#error=access_denied&error_description=Sign-in+cancelled",
    "?error=access_denied&error_description=Sign-in+cancelled",
  ]) {
    await page.goto("/login" + suffix);
    await expect(page.getByRole("alert")).toContainText("Sign-in cancelled");
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeEnabled();
  }
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  for (const path of ["/forgot-password", "/reset-password"]) {
    await page.goto(path);
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toHaveCount(0);
  }
});

test("failed passwords never create an authenticated session", async ({
  page,
}) => {
  await fixtures(page, { signedIn: false });
  await page.goto("/login");
  await page.getByLabel("Email address").fill("trader@example.com");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid login credentials",
  );
  await expect(page).toHaveURL(/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/login/);
});
test("account-separated overview renders without overflow on desktop, tablet and mobile", async ({
  page,
}) => {
  await fixtures(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["tablet", 820, 1180],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "A clearer view of your trading." }),
    ).toBeVisible();
    await expect(
      page.getByText("$125.00", { exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/overview-" + name + ".png",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByText("Accounts", { exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A place for every account." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("creates, edits, deletes and restores a zero-result trade", async ({
  page,
}) => {
  const rows = await fixtures(page);
  await page.goto("/dashboard/add-trade");
  await page.getByLabel("Trading account").selectOption(account.id);
  await page.getByLabel("Instrument", { exact: true }).fill("BTCUSD");
  await page.getByLabel("Broker-reported net P&L").fill("0");
  await page.getByLabel("Initial risk amount").fill("25");
  await page.getByLabel("Mark as reviewed").check();
  await page.getByRole("button", { name: "Save trade", exact: true }).click();
  await expect(page).toHaveURL(/journal/);
  expect(rows.trades).toHaveLength(2);
  expect(rows.trades[1].net_pnl).toBe("0.00");
  expect(rows.trades[1].reviewed).toBe(true);
  const id = rows.trades[1].id;
  await page.goto("/dashboard/trade/" + id + "/edit");
  await page.getByLabel("Broker-reported net P&L").fill("-50");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/journal/);
  expect(rows.trades[1].net_pnl).toBe("-50.00");
  await page.goto("/dashboard/trade/" + id);
  await page.getByRole("button", { name: "Delete trade", exact: true }).click();
  await page.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(page).toHaveURL(/journal/);
  await expect(page.getByText("BTCUSD", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Recently deleted" }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  expect(rows.trades[1].deleted_at).toBe(null);
  await page.getByRole("button", { name: "Back to journal" }).click();
  await expect(page.getByText("BTCUSD", { exact: true })).toBeVisible();
});
test("drafts survive reload and daily reviews save", async ({ page }) => {
  const rows = await fixtures(page);
  await page.goto("/dashboard/add-trade");
  await page.getByLabel("Instrument", { exact: true }).fill("XAUUSD");
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await page.reload();
  await expect(page.getByLabel("Instrument", { exact: true })).toHaveValue(
    "XAUUSD",
  );
  await page.goto("/dashboard/review?day=2026-10-20");
  await page
    .getByLabel("Before the session")
    .fill("Only take the planned setup.");
  await page
    .getByLabel("One adjustment for tomorrow")
    .fill("Wait for confirmation.");
  await page.getByRole("button", { name: "Save daily review" }).click();
  await expect(page.getByRole("status")).toContainText("Review saved");
  expect(rows.daily_reviews[0].plan).toBe("Only take the planned setup.");
});

test("all workspace pages fit a phone and libraries support keyboard dismissal", async ({
  page,
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const path of [
    "journal",
    "statistics",
    "calendar",
    "accounts",
    "review",
    "settings",
    "strategies",
    "mistakes",
    "notes",
    "add-trade",
  ]) {
    await page.goto("/dashboard/" + path);
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/dashboard/strategies");
  await page.getByRole("button", { name: "Add strategy" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Strategy name").fill("Opening range");
  await page.getByRole("button", { name: "Save strategy" }).click();
  await page.getByRole("button", { name: /Opening range/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("different account currencies are never combined", async ({ page }) => {
  const rows = await fixtures(page);
  const second = {
    ...account,
    id: "55555555-5555-4555-8555-555555555555",
    currency: "INR",
    name: "Indian account",
  };
  rows.accounts.push(second);
  rows.trades.push({
    ...rows.trades[0],
    id: "66666666-6666-4666-8666-666666666666",
    account_id: second.id,
    net_pnl: 5000,
  });
  await page.goto("/dashboard");
  await expect(
    page.getByText("$125.00", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("$5,125.00", { exact: true })).toHaveCount(0);
  await page.getByLabel("Trading account").selectOption(second.id);
  await expect(
    page.getByText("₹5,000.00", { exact: true }).first(),
  ).toBeVisible();
});

test("appearance settings persist and System follows the device", async ({
  page,
}) => {
  await fixtures(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/dashboard/settings");
  await expect(
    page.getByRole("radio", { name: "System", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.getByRole("radio", { name: "Light", exact: true }).check();
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("radio", { name: "Dark", exact: true }).check();
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "Dark", exact: true }),
  ).toBeChecked();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.getByRole("radio", { name: "System", exact: true }).check();
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass("dark");
  expect(
    await page.locator(".workspace-sidebar nav a").allTextContents(),
  ).toEqual([
    "Overview",
    "Markets",
    "Journal",
    "Calendar",
    "Analytics",
    "Playbook",
    "Daily review",
    "Mistakes",
    "Notes",
    "Accounts",
    "Integrations",
    "Settings",
  ]);
  await expect(
    page
      .locator(".workspace-sidebar")
      .getByRole("button", { name: /appearance|sign out/i }),
  ).toHaveCount(0);
  await expect(page.locator(".sidebar-bottom")).toHaveCount(0);
  await page.screenshot({
    path: "test-results/settings-appearance-desktop.png",
    fullPage: true,
  });
});
test("mobile avatar menu supports profile, Escape, outside dismissal and sign out", async ({
  page,
}) => {
  await fixtures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  const trigger = page.getByRole("button", {
    name: "Account options",
    exact: true,
  });
  await trigger.click();
  await expect(
    page.getByRole("navigation", { name: "Account options" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.locator(".metric-grid").click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.getByRole("link", { name: "Profile & settings" }).click();
  await expect(page).toHaveURL(/settings/);
  await expect(
    page.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/settings-appearance-mobile.png",
    fullPage: true,
  });
  await trigger.click();
  await page.screenshot({ path: "test-results/account-menu-mobile.png" });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/login/);
});

test("private screenshot uploads and authenticated downloads use Supabase Storage", async ({
  page,
}) => {
  const rows = await fixtures(page);
  const png = await readFile("tests/fixtures/chart.png");
  let uploaded = false,
    downloaded = false;
  await page.route(
    "https://journal-test.supabase.co/storage/v1/**",
    async (route) => {
      const req = route.request();
      expect(req.headers().authorization).toMatch(/^Bearer /);
      if (req.method() === "POST") {
        expect(new URL(req.url()).pathname).toContain(
          "/object/journal-images/" + owner + "/",
        );
        uploaded = true;
        return route.fulfill({
          status: 200,
          json: { Key: "journal-images/sample", Id: "sample-id" },
        });
      }
      if (req.method() === "GET") {
        downloaded = true;
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          body: png,
        });
      }
      return route.fulfill({ json: [] });
    },
  );
  await page.goto("/dashboard/add-trade");
  await page.getByLabel("Trading account").selectOption(account.id);
  await page.getByLabel("Instrument", { exact: true }).fill("XAUUSD");
  await page.getByLabel("Broker-reported net P&L").fill("25");
  await page
    .getByLabel("Choose screenshots")
    .setInputFiles("tests/fixtures/chart.png");
  await page.getByRole("button", { name: "Save trade", exact: true }).click();
  await expect(page).toHaveURL(/journal/);
  expect(uploaded).toBe(true);
  expect(rows.trades[1].details.images[0]).toMatch(
    new RegExp("^supabase:" + owner + "/"),
  );
  await page.goto("/dashboard/trade/" + rows.trades[1].id);
  await page.waitForFunction(() => {
    const image = document.querySelector(".trade-screenshot");
    return image?.complete && image.naturalWidth > 0;
  });
  expect(downloaded).toBe(true);
});
test("missing screenshot bucket explains setup without saving a partial trade", async ({
  page,
}) => {
  const rows = await fixtures(page);
  await page.route("https://journal-test.supabase.co/storage/v1/**", (route) =>
    route.fulfill({
      status: 400,
      json: {
        statusCode: "404",
        error: "Bucket not found",
        message: "Bucket not found",
      },
    }),
  );
  await page.goto("/dashboard/add-trade");
  await page.getByLabel("Trading account").selectOption(account.id);
  await page.getByLabel("Instrument", { exact: true }).fill("XAUUSD");
  await page.getByLabel("Broker-reported net P&L").fill("25");
  await page
    .getByLabel("Choose screenshots")
    .setInputFiles("tests/fixtures/chart.png");
  await page.getByRole("button", { name: "Save trade", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "002_private_storage.sql",
  );
  expect(rows.trades).toHaveLength(1);
});

test("an empty workspace shows empty states instead of sample trades", async ({
  page,
}) => {
  const rows = await fixtures(page);
  for (const records of Object.values(rows)) records.length = 0;
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "First, create a trading account" }),
  ).toBeVisible();
  await expect(page.locator(".metric-grid")).toHaveCount(0);
  await page.goto("/dashboard/journal");
  await expect(
    page.getByRole("heading", { name: "No trades found", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".trade-table tbody tr")).toHaveCount(0);
  await page.goto("/dashboard/statistics");
  await expect(
    page.getByRole("heading", { name: "No closed trades in this period" }),
  ).toBeVisible();
  await expect(page.getByText("EURUSD", { exact: true })).toHaveCount(0);
});
test("failed trade requests show a retryable error instead of fabricated results", async ({
  page,
}) => {
  await fixtures(page);
  await page.route(
    "https://journal-test.supabase.co/rest/v1/trades?**",
    (route) =>
      route.fulfill({
        status: 500,
        json: { message: "Test database unavailable" },
      }),
  );
  await page.goto("/dashboard");
  await expect(page.getByRole("alert")).toContainText(
    "Test database unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".metric-grid")).toHaveCount(0);
});

async function marketEmbedFixture(page, { blocked = false } = {}) {
  await page.route(
    "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js",
    (route) => {
      if (blocked) return route.abort();
      return route.fulfill({
        contentType: "application/javascript",
        body: `
          (() => {
          const script=document.currentScript;
   const config=JSON.parse(script.textContent);
   window.__marketConfigs ||= [];
   window.__marketConfigs.push(config);
   const frame=document.createElement('iframe');
   frame.srcdoc='<html><body><p>External chart test fixture</p></body></html>';
          script.parentElement.querySelector('.tradingview-widget-container__widget').append(frame);
          })();
  `,
      });
    },
  );
}
test("Markets saves a watchlist, changes provider/timeframe, and follows the app theme", async ({
  page,
}) => {
  await fixtures(page);
  await marketEmbedFixture(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/dashboard/markets");
  await expect(
    page.getByRole("heading", { name: "Markets", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".market-chart-host iframe")).toHaveCount(1);
  await page.getByLabel("Chart symbol").selectOption("BITSTAMP:BTCUSD");
  await page.getByLabel("Chart timeframe").selectOption("15");
  await page
    .getByRole("button", {
      name: "Save selected symbol to watchlist",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.locator(".market-symbol-choice")).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel("Chart symbol")).toHaveValue("BITSTAMP:BTCUSD");
  await expect(page.getByLabel("Chart timeframe")).toHaveValue("15");
  await expect(
    page.getByRole("button", {
      name: "Remove selected symbol from watchlist",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() => page.evaluate(() => window.__marketConfigs?.at(-1)?.theme))
    .toBe("dark");
  await expect(page.locator(".market-chart-host iframe")).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__marketConfigs?.at(-1)?.symbol))
    .toBe("BITSTAMP:BTCUSD");
  await page.getByLabel("Search market symbols").fill("Gold");
  await expect(page.locator(".market-symbol-choice")).toHaveCount(1);
  await page.locator(".market-symbol-choice").click();
  await expect(page.getByLabel("Chart symbol")).toHaveValue("OANDA:XAUUSD");
  await page.screenshot({
    path: "test-results/markets-desktop.png",
    fullPage: true,
  });
});
test("Markets fits a phone, expands the chart and prefills trade entry without overwriting another draft", async ({
  page,
}) => {
  await fixtures(page);
  await marketEmbedFixture(page);
  await page.goto("/dashboard/add-trade");
  await page.getByLabel("Instrument", { exact: true }).fill("GBPJPY");
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Markets", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Chart symbol").selectOption("OANDA:XAUUSD");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Expand chart", exact: true }).click();
  await expect(page.locator(".market-terminal")).toHaveClass(/expanded/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".market-terminal")).not.toHaveClass(/expanded/);
  await page.screenshot({
    path: "test-results/markets-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "Log XAUUSD trade", exact: true })
    .click();
  await expect(page.getByLabel("Instrument", { exact: true })).toHaveValue(
    "XAUUSD",
  );
  await page.goto("/dashboard/add-trade");
  await expect(page.getByLabel("Instrument", { exact: true })).toHaveValue(
    "GBPJPY",
  );
});
test("a blocked market embed shows a retryable error without simulated candles", async ({
  page,
}) => {
  await fixtures(page);
  await marketEmbedFixture(page, { blocked: true });
  await page.goto("/dashboard/markets");
  await expect(page.getByRole("alert")).toContainText(
    "The chart couldn’t connect.",
  );
  await expect(page.locator(".market-chart-host iframe")).toHaveCount(0);
  await page.unroute(
    "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js",
  );
  await marketEmbedFixture(page);
  await page.getByRole("button", { name: "Retry chart", exact: true }).click();
  await expect(page.locator(".market-chart-host iframe")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("desktop sidebar collapses to working icon links and remembers its width", async ({
  page,
}) => {
  await fixtures(page);
  await marketEmbedFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  const sidebar = page.locator(".workspace-sidebar");
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox()).width))
    .toBe(232);
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .press("Enter");
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox()).width))
    .toBe(76);
  await expect(
    page.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar.locator(".brand-text")).toBeHidden();
  const markets = page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Markets", exact: true });
  await expect(markets).toBeVisible();
  await markets.press("Enter");
  await expect(page).toHaveURL(/markets/);
  await expect
    .poll(async () =>
      Math.round((await page.locator(".workspace-body").boundingBox()).x),
    )
    .toBe(76);
  await page.reload();
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox()).width))
    .toBe(76);
  await page.screenshot({
    path: "test-results/sidebar-collapsed-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Expand sidebar", exact: true })
    .press("Space");
  await expect
    .poll(async () => Math.round((await sidebar.boundingBox()).width))
    .toBe(232);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Collapse sidebar", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
});
test("a saved desktop collapse keeps the mobile navigation fully labelled", async ({
  page,
}) => {
  await fixtures(page);
  await page.addInitScript(() =>
    localStorage.setItem("sidebar-collapsed", "true"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("button", { name: "Expand sidebar", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByText("Overview", { exact: true })).toBeVisible();
  await expect(nav.getByText("Markets", { exact: true })).toBeVisible();
  await expect
    .poll(async () =>
      Math.round(
        (await page.locator(".workspace-sidebar").boundingBox()).width,
      ),
    )
    .toBe(250);
  await page.screenshot({
    path: "test-results/sidebar-collapsed-mobile-menu.png",
  });
  await nav.getByRole("link", { name: "Journal", exact: true }).click();
  await expect(page).toHaveURL(/journal/);
  await expect(
    page.getByRole("button", { name: "Open navigation", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("top navigation stays pinned while scrolling and sidebar controls stay inside the sidebar", async ({
  page,
}) => {
  await fixtures(page);
  for (const viewport of [
    { width: 1440, height: 700 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/dashboard/settings");
    await expect(
      page.getByRole("heading", { name: "Make it yours." }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 700));
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    await expect
      .poll(async () =>
        Math.round((await page.locator(".workspace-topbar").boundingBox()).y),
      )
      .toBe(0);
    await expect(
      page.getByRole("button", { name: "Account options", exact: true }),
    ).toBeInViewport();
    await expect(
      page.locator(".workspace-topbar .desktop-sidebar-toggle"),
    ).toHaveCount(0);
    if (viewport.width > 767) {
      await page
        .locator(".workspace-sidebar")
        .getByRole("button", { name: "Collapse sidebar", exact: true })
        .click();
      await expect
        .poll(async () =>
          Math.round((await page.locator(".workspace-topbar").boundingBox()).x),
        )
        .toBe(76);
      await page
        .locator(".workspace-sidebar")
        .getByRole("button", { name: "Expand sidebar", exact: true })
        .click();
    }
  }
});
test("market terminal places the watchlist to the right and lets the chart reclaim that space", async ({
  page,
}) => {
  await fixtures(page);
  await marketEmbedFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard/markets");
  await expect(page.locator(".market-chart-host iframe")).toHaveCount(1);
  const chart = page.locator(".market-chart-panel"),
    watchlist = page.getByRole("complementary", { name: "Market symbols" });
  const initial = await chart.boundingBox(),
    right = await watchlist.boundingBox();
  expect(right.x).toBeGreaterThan(initial.x);
  expect(Math.abs(right.y - initial.y)).toBeLessThan(2);
  expect(
    (await page.locator(".market-chart-host").boundingBox()).height,
  ).toBeGreaterThan(650);
  await page
    .getByRole("button", { name: "Hide watchlist", exact: true })
    .click();
  await expect(watchlist).toHaveCount(0);
  expect((await chart.boundingBox()).width).toBeGreaterThan(
    initial.width + 200,
  );
  await page
    .getByRole("button", { name: "Show watchlist", exact: true })
    .click();
  await expect(watchlist).toBeVisible();
  await page
    .locator(".workspace-sidebar")
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect
    .poll(async () =>
      Math.round(
        (await page.locator(".workspace-sidebar").boundingBox()).width,
      ),
    )
    .toBe(76);
  await page.screenshot({ path: "test-results/market-terminal-desktop.png" });
});
