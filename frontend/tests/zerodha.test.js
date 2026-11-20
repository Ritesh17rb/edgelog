import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../../supabase/functions/zerodha/handler.js";
import {
  digest,
  normalizeExecutions,
  seal,
  unseal,
  sessionExpiry,
  indiaDay,
} from "../../supabase/functions/zerodha/core.js";

const owner = "11111111-1111-4111-8111-111111111111";
const secret = Buffer.alloc(32, 19).toString("base64");
const config = {
  appOrigin: "https://journal.example",
  ownerId: owner,
  clientId: "TEST01",
  apiKey: "test-api-key",
  apiSecret: "test-api-secret",
  redirectUrl:
    "https://journal.example/dashboard/integrations/zerodha/callback",
  encryptionKey: secret,
};
const fill = (override = {}) => ({
  trade_id: "1",
  order_id: "11",
  exchange: "NSE",
  tradingsymbol: "TEST",
  product: "MIS",
  transaction_type: "BUY",
  quantity: 2,
  average_price: 100,
  fill_timestamp: "2026-10-29 09:15:00",
  ...override,
});

test("Kite timestamps use IST, executions stay current-day, and token encryption binds the owner", async () => {
  const now = Date.parse("2026-10-29T08:00:00Z");
  const [row] = normalizeExecutions([fill()], owner, "TEST01", now);
  assert.equal(row.executed_at, "2026-10-29T03:45:00.000Z");
  assert.equal(row.execution_key, "2026-10-29:NSE:11:1");
  for (const value of [
    fill({ quantity: 0 }),
    fill({ average_price: -1 }),
    fill({ transaction_type: "OTHER" }),
    fill({ fill_timestamp: "2026-10-28 09:15:00" }),
    fill({ fill_timestamp: "2026-10-29 19:15:00" }),
  ])
    assert.throws(() => normalizeExecutions([value], owner, "TEST01", now));
  assert.throws(() =>
    normalizeExecutions([fill(), fill()], owner, "TEST01", now),
  );
  assert.equal(indiaDay(Date.parse("2026-10-29T20:00:00Z")), "2026-10-30");
  assert.equal(sessionExpiry(now), "2026-10-30T00:30:00.000Z");
  const ciphertext = await seal("test-session-value", owner, secret);
  assert.ok(!ciphertext.includes("test-session-value"));
  assert.equal(await unseal(ciphertext, owner, secret), "test-session-value");
  await assert.rejects(() => unseal(ciphertext, "different-owner", secret));
  await assert.rejects(() =>
    unseal(ciphertext, owner, Buffer.alloc(32, 20).toString("base64")),
  );
});

// Minimal stateful PostgREST double: exercises handler logic without broker/network writes.
function mockAdmin() {
  const tables = {
    zerodha_auth_states: [],
    zerodha_sessions: [],
    broker_executions: [],
  };
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.mode = "select";
    }
    select() {
      return this;
    }
    eq(k, v) {
      this.filters.push((r) => r[k] === v);
      return this;
    }
    gt(k, v) {
      this.filters.push((r) => r[k] > v);
      return this;
    }
    delete() {
      this.mode = "delete";
      return this;
    }
    upsert(rows, options = {}) {
      this.mode = "upsert";
      this.values = Array.isArray(rows) ? rows : [rows];
      this.options = options;
      return this;
    }
    maybeSingle() {
      this.single = true;
      return this;
    }
    then(resolve, reject) {
      return Promise.resolve()
        .then(() => {
          const list = tables[this.table];
          let data = list.filter((r) => this.filters.every((f) => f(r)));
          if (this.mode === "delete")
            tables[this.table] = list.filter((r) => !data.includes(r));
          if (this.mode === "upsert") {
            data = [];
            for (const row of this.values) {
              const keys = (this.options.onConflict || "user_id").split(",");
              const existing = list.find((r) =>
                keys.every((k) => r[k] === row[k]),
              );
              if (existing && this.options.ignoreDuplicates) continue;
              const saved = existing
                ? Object.assign(existing, row)
                : { id: crypto.randomUUID(), ...row };
              if (!existing) list.push(saved);
              data.push(saved);
            }
          }
          return { data: this.single ? data[0] || null : data, error: null };
        })
        .then(resolve, reject);
    }
  }
  return {
    tables,
    auth: {
      getUser: async (token) => ({
        data: {
          user:
            token === "test-owner"
              ? { id: owner }
              : token === "test-other"
                ? { id: "other-user" }
                : null,
        },
        error: null,
      }),
    },
    from: (name) => new Query(name),
  };
}
function request(
  action,
  extra = {},
  token = "test-owner",
  origin = config.appOrigin,
) {
  return new Request("https://functions.example/zerodha", {
    method: "POST",
    headers: {
      Origin: origin,
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...extra }),
  });
}
test("broker handler rejects unauthenticated users, other owners, disallowed origins and state replay", async () => {
  const admin = mockAdmin();
  let exchanged = 0;
  const handler = createHandler({
    admin,
    config,
    fetchImpl: async () => {
      exchanged++;
      return Response.json({
        status: "success",
        data: { user_id: config.clientId, access_token: "test-broker-session" },
      });
    },
  });
  assert.equal((await handler(request("connect", {}, "invalid"))).status, 401);
  assert.equal(
    (await handler(request("connect", {}, "test-other"))).status,
    403,
  );
  assert.equal(
    (
      await handler(
        request("connect", {}, "test-owner", "https://attacker.example"),
      )
    ).status,
    403,
  );
  const status = await (
    await handler(request("status", {}, "test-other"))
  ).json();
  assert.equal(status.reason, "not_enabled");
  const login = await (await handler(request("connect"))).json();
  const url = new URL(login.url),
    state = new URLSearchParams(url.searchParams.get("redirect_params")).get(
      "state",
    );
  assert.equal(url.origin, "https://kite.zerodha.com");
  assert.equal(
    admin.tables.zerodha_auth_states[0].state_hash,
    await digest(state),
  );
  assert.equal(
    (
      await handler(
        request("exchange", { state: "invalid", requestToken: "test-request" }),
      )
    ).status,
    400,
  );
  assert.equal(exchanged, 0);
  const result = await handler(
    request("exchange", { state, requestToken: "test-request" }),
  );
  assert.equal(result.status, 200);
  assert.ok(!(await result.text()).includes("test-broker-session"));
  assert.equal(exchanged, 1);
  assert.ok(
    !admin.tables.zerodha_sessions[0].encrypted_token.includes(
      "test-broker-session",
    ),
  );
  assert.equal(
    (
      await handler(
        request("exchange", { state, requestToken: "test-request" }),
      )
    ).status,
    400,
  );
  assert.equal(exchanged, 1);
  assert.equal(
    (await (await handler(request("status"))).json()).connected,
    true,
  );
});
test("import re-fetches broker fills, ignores injected values, preserves duplicates and expires sessions", async () => {
  const admin = mockAdmin();
  admin.tables.zerodha_sessions.push({
    user_id: owner,
    client_id: config.clientId,
    encrypted_token: await seal("test-broker-session", owner, secret),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  });
  const rows = [
    fill({ fill_timestamp: new Date(Date.now() - 10000).toISOString() }),
  ];
  let fetches = 0;
  const handler = createHandler({
    admin,
    config,
    fetchImpl: async (url, options) => {
      assert.equal(
        options.headers.Authorization,
        "token " + config.apiKey + ":test-broker-session",
      );
      assert.equal(url, "https://api.kite.trade/trades");
      fetches++;
      return Response.json({ status: "success", data: rows });
    },
  });
  const preview = await (await handler(request("preview"))).json();
  assert.equal(preview.executions[0].user_id, undefined);
  const body = {
    keys: [preview.executions[0].execution_key],
    user_id: "attacker",
    price: 999999,
  };
  assert.deepEqual(await (await handler(request("import", body))).json(), {
    imported: 1,
    skipped: 0,
  });
  assert.deepEqual(await (await handler(request("import", body))).json(), {
    imported: 0,
    skipped: 1,
  });
  assert.equal(admin.tables.broker_executions[0].price, 100);
  assert.equal(admin.tables.broker_executions[0].user_id, owner);
  assert.equal(fetches, 3);
  assert.equal(
    (await handler(request("import", { keys: ["unknown"] }))).status,
    409,
  );
  admin.tables.zerodha_sessions[0].expires_at = new Date(
    Date.now() - 1000,
  ).toISOString();
  assert.equal((await handler(request("preview"))).status, 409);
});
test("expired state and mismatched broker client never create a session", async () => {
  const admin = mockAdmin();
  admin.tables.zerodha_auth_states.push({
    user_id: owner,
    state_hash: await digest("old-state"),
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  const handler = createHandler({
    admin,
    config,
    fetchImpl: async () =>
      Response.json({
        status: "success",
        data: { user_id: "WRONG", access_token: "test-wrong-session" },
      }),
  });
  assert.equal(
    (
      await handler(
        request("exchange", {
          state: "old-state",
          requestToken: "test-request",
        }),
      )
    ).status,
    400,
  );
  admin.tables.zerodha_auth_states[0].expires_at = new Date(
    Date.now() + 60000,
  ).toISOString();
  assert.equal(
    (
      await handler(
        request("exchange", {
          state: "old-state",
          requestToken: "test-request",
        }),
      )
    ).status,
    403,
  );
  assert.equal(admin.tables.zerodha_sessions.length, 0);
});
