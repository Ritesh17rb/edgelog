import test from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "../api/gdelt.js";
function response() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}
test("GDELT relay rejects untrusted calls and validates a fixed provider request", async () => {
  let calls = 0;
  const relay = createRelay({
    token: "test-relay-token",
    fetcher: async (url) => {
      calls++;
      assert.equal(url.origin, "https://api.gdeltproject.org");
      assert.equal(url.searchParams.get("query"), "gold sourcelang:english");
      assert.equal(url.searchParams.get("maxrecords"), "20");
      return Response.json({ articles: [] });
    },
  });
  for (const [req, status] of [
    [{ method: "GET", headers: {} }, 405],
    [{ method: "POST", headers: {} }, 401],
    [{ method: "POST", headers: { authorization: "Bearer wrong" } }, 401],
    [
      {
        method: "POST",
        headers: { authorization: "Bearer test-relay-token" },
        body: { query: "gold", hours: 999, limit: 20 },
      },
      400,
    ],
  ]) {
    const res = response();
    await relay(req, res);
    assert.equal(res.statusCode, status);
  }
  assert.equal(calls, 0);
  const res = response();
  await relay(
    {
      method: "POST",
      headers: { authorization: "Bearer test-relay-token" },
      body: { query: "gold sourcelang:english", hours: 24, limit: 20 },
    },
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 1);
});
test("GDELT relay preserves throttling and rejects unreadable provider responses", async () => {
  for (const [fetcher, status] of [
    [async () => new Response("", { status: 429 }), 429],
    [async () => new Response("not JSON"), 502],
  ]) {
    const res = response();
    await createRelay({ token: "test-relay-token", fetcher })(
      {
        method: "POST",
        headers: { authorization: "Bearer test-relay-token" },
        body: { query: "gold", hours: 24, limit: 20 },
      },
      res,
    );
    assert.equal(res.statusCode, status);
  }
});
