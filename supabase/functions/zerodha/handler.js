import {
  CALLBACK_PATH,
  digest,
  indiaDay,
  normalizeExecutions,
  seal,
  sessionExpiry,
  unseal,
} from "./core.js";

class ApiError extends Error {
  constructor(message, status = 400, code = "request_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function database(result) {
  if (result.error)
    throw new ApiError(
      "Zerodha storage is unavailable. Apply migration 003 and check the function setup.",
      503,
      "setup_required",
    );
  return result.data;
}
export function createHandler({ admin, config, fetchImpl = fetch }) {
  return async function handler(request) {
    const origin = request.headers.get("Origin");
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
      "Access-Control-Allow-Headers":
        "authorization, apikey, x-client-info, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (origin === config.appOrigin)
      headers["Access-Control-Allow-Origin"] = origin;
    const respond = (value, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    try {
      if (origin && origin !== config.appOrigin)
        throw new ApiError("This app origin is not enabled.", 403);
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers });
      if (request.method !== "POST") throw new ApiError("Use POST.", 405);
      const authorization = request.headers.get("Authorization") || "";
      if (!authorization.startsWith("Bearer "))
        throw new ApiError("Please sign in again.", 401, "unauthorized");
      const { data, error } = await admin.auth.getUser(authorization.slice(7));
      if (error || !data?.user)
        throw new ApiError("Please sign in again.", 401, "unauthorized");
      const uid = data.user.id;
      if (Number(request.headers.get("Content-Length")) > 100000)
        throw new ApiError("Request too large.", 413);
      const text = await request.text();
      if (text.length > 100000) throw new ApiError("Request too large.", 413);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ApiError("Invalid request.");
      }
      if (
        !body ||
        ![
          "status",
          "connect",
          "exchange",
          "preview",
          "import",
          "disconnect",
        ].includes(body.action)
      )
        throw new ApiError("Unknown action.");
      const configured = [
        "appOrigin",
        "ownerId",
        "clientId",
        "apiKey",
        "apiSecret",
        "redirectUrl",
        "encryptionKey",
      ].every((k) => config[k]);
      if (!configured || uid !== config.ownerId) {
        if (body.action === "status")
          return respond({
            configured: false,
            reason: configured ? "not_enabled" : "setup_required",
            connected: false,
          });
        throw new ApiError(
          configured
            ? "Zerodha is not enabled for this journal account."
            : "Finish the Zerodha server setup first.",
          403,
          configured ? "not_enabled" : "setup_required",
        );
      }
      const callback = new URL(config.redirectUrl);
      if (
        callback.origin !== config.appOrigin ||
        callback.pathname !== CALLBACK_PATH ||
        callback.search ||
        callback.hash ||
        (callback.protocol !== "https:" &&
          !["localhost", "127.0.0.1"].includes(callback.hostname))
      )
        throw new ApiError(
          "Invalid server callback configuration.",
          503,
          "setup_required",
        );
      async function kite(path, token, options = {}) {
        let response;
        try {
          response = await fetchImpl("https://api.kite.trade" + path, {
            ...options,
            signal: AbortSignal.timeout(15000),
            headers: {
              "X-Kite-Version": "3",
              ...(token
                ? { Authorization: "token " + config.apiKey + ":" + token }
                : {}),
              ...options.headers,
            },
          });
        } catch {
          throw new ApiError("Zerodha did not respond. Please retry.", 502);
        }
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new ApiError("Unexpected response from Zerodha.", 502);
        }
        if (response.status === 403 || payload.error_type === "TokenException")
          throw new ApiError(
            "Your Zerodha session expired. Connect again.",
            409,
            "session_expired",
          );
        if (!response.ok || payload.status !== "success")
          throw new ApiError(
            "Zerodha could not complete this request. Please retry or reconnect.",
            502,
          );
        return payload.data;
      }
      if (body.action === "connect") {
        const state = crypto.randomUUID() + crypto.randomUUID();
        database(
          await admin
            .from("zerodha_auth_states")
            .upsert({
              user_id: uid,
              state_hash: await digest(state),
              expires_at: new Date(Date.now() + 600000).toISOString(),
            }),
        );
        const url = new URL("https://kite.zerodha.com/connect/login");
        url.searchParams.set("v", "3");
        url.searchParams.set("api_key", config.apiKey);
        url.searchParams.set(
          "redirect_params",
          new URLSearchParams({ state }).toString(),
        );
        return respond({ url: url.href });
      }
      if (body.action === "exchange") {
        if (
          typeof body.state !== "string" ||
          body.state.length > 200 ||
          typeof body.requestToken !== "string" ||
          !/^[a-zA-Z0-9_-]{1,200}$/.test(body.requestToken)
        )
          throw new ApiError(
            "Invalid broker callback. Start a new connection.",
          );
        // DELETE RETURNING atomically consumes the owner-bound, expiring state.
        const states = database(
          await admin
            .from("zerodha_auth_states")
            .delete()
            .eq("user_id", uid)
            .eq("state_hash", await digest(body.state))
            .gt("expires_at", new Date().toISOString())
            .select("user_id"),
        );
        if (!states?.length)
          throw new ApiError(
            "This connection attempt expired or was already used. Connect again.",
            400,
            "invalid_state",
          );
        const session = await kite("/session/token", null, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            api_key: config.apiKey,
            request_token: body.requestToken,
            checksum: await digest(
              config.apiKey + body.requestToken + config.apiSecret,
            ),
          }),
        });
        if (
          session?.user_id !== config.clientId ||
          typeof session?.access_token !== "string" ||
          !session.access_token
        )
          throw new ApiError(
            "This Zerodha account does not match the configured client ID.",
            403,
          );
        const expiresAt = sessionExpiry();
        database(
          await admin
            .from("zerodha_sessions")
            .upsert({
              user_id: uid,
              client_id: config.clientId,
              encrypted_token: await seal(
                session.access_token,
                uid,
                config.encryptionKey,
              ),
              connected_at: new Date().toISOString(),
              expires_at: expiresAt,
            }),
        );
        return respond({
          connected: true,
          clientId: config.clientId,
          expiresAt,
        });
      }
      const session = database(
        await admin
          .from("zerodha_sessions")
          .select("*")
          .eq("user_id", uid)
          .maybeSingle(),
      );
      const connected = Boolean(
        session &&
        session.client_id === config.clientId &&
        Date.parse(session.expires_at) > Date.now(),
      );
      if (body.action === "status")
        return respond({
          configured: true,
          connected,
          clientId: config.clientId,
          expiresAt: session?.expires_at || null,
        });
      if (body.action === "disconnect") {
        database(
          await admin.from("zerodha_sessions").delete().eq("user_id", uid),
        );
        database(
          await admin.from("zerodha_auth_states").delete().eq("user_id", uid),
        );
        let revoked = !session;
        if (session) {
          try {
            await kite(
              "/session/token?" +
                new URLSearchParams({
                  api_key: config.apiKey,
                  access_token: await unseal(
                    session.encrypted_token,
                    uid,
                    config.encryptionKey,
                  ),
                }),
              null,
              { method: "DELETE" },
            );
            revoked = true;
          } catch {
            /* Local removal succeeds even if the expired broker session cannot be revoked. */
          }
        }
        return respond({ disconnected: true, revoked });
      }
      if (!connected)
        throw new ApiError(
          "Connect to Zerodha to fetch today's executions.",
          409,
          "session_expired",
        );
      let token;
      try {
        token = await unseal(
          session.encrypted_token,
          uid,
          config.encryptionKey,
        );
      } catch {
        throw new ApiError(
          "Your broker session cannot be read. Disconnect and connect again.",
          409,
          "session_expired",
        );
      }
      let rows;
      try {
        rows = normalizeExecutions(
          await kite("/trades", token),
          uid,
          config.clientId,
        );
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError(e.message, 502);
      }
      if (body.action === "preview")
        return respond({
          day: indiaDay(),
          clientId: config.clientId,
          executions: rows.map(({ user_id, ...row }) => row),
        });
      if (
        !Array.isArray(body.keys) ||
        !body.keys.length ||
        body.keys.length > 500 ||
        body.keys.some((k) => typeof k !== "string" || k.length > 300) ||
        new Set(body.keys).size !== body.keys.length
      )
        throw new ApiError("Select between 1 and 500 executions.");
      const selected = rows.filter((row) =>
        body.keys.includes(row.execution_key),
      );
      if (selected.length !== body.keys.length)
        throw new ApiError(
          "Some executions are no longer in today's trade book. Refresh the preview.",
          409,
        );
      // Re-fetch from Kite; never trust browser-supplied prices, quantities or ownership.
      const inserted = database(
        await admin
          .from("broker_executions")
          .upsert(selected, {
            onConflict: "user_id,client_id,execution_key",
            ignoreDuplicates: true,
          })
          .select("id"),
      );
      return respond({
        imported: inserted.length,
        skipped: selected.length - inserted.length,
      });
    } catch (error) {
      // Never return/log upstream responses, credentials or raw database errors.
      return respond(
        {
          error:
            error instanceof ApiError
              ? error.message
              : "The broker connection is unavailable. Check the server setup and retry.",
          code: error instanceof ApiError ? error.code : "server_error",
        },
        error instanceof ApiError ? error.status : 500,
      );
    }
  };
}
