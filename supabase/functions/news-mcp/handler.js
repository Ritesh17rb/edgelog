import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createNewsService, NewsError } from "./service.js";
import { createMcpServer, callAppTool } from "./mcp.js";

export function createHandler({ admin, config, fetcher }) {
  const origins = new Set(
    [
      config.appOrigin,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5174",
    ].filter(Boolean),
  );
  return async (request) => {
    const origin = request.headers.get("origin");
    const headers = {
      Vary: "Origin",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Headers":
        "authorization,apikey,content-type,x-client-info,mcp-protocol-version,mcp-session-id",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Expose-Headers": "mcp-session-id",
    };
    if (origin && !origins.has(origin))
      return Response.json(
        { error: "Origin not allowed." },
        { status: 403, headers },
      );
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST")
      return Response.json(
        { error: "Use POST for this stateless MCP endpoint." },
        { status: 405, headers: { ...headers, Allow: "POST,OPTIONS" } },
      );
    try {
      const token = request.headers
        .get("authorization")
        ?.match(/^Bearer (.+)$/i)?.[1];
      if (!token)
        throw new NewsError(
          "Sign in to use news research.",
          401,
          "unauthorized",
        );
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data?.user)
        throw new NewsError(
          "Your session expired. Please sign in again.",
          401,
          "unauthorized",
        );
      if (Number(request.headers.get("content-length")) > 16000)
        throw new NewsError("Request is too large.", 413);
      const reader = request.body?.getReader();
      let raw = "";
      let size = 0;
      const decoder = new TextDecoder();
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 16000) {
              await reader.cancel();
              throw new NewsError("Request is too large.", 413);
            }
            raw += decoder.decode(value, { stream: true });
          }
          raw += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new NewsError("Invalid JSON request.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new NewsError("Invalid request.");
      const service = createNewsService({
        admin,
        userId: data.user.id,
        config,
        fetcher,
      });
      const isApp = new URL(request.url).pathname.endsWith("/app");
      if (isApp) {
        if (body.action === "status")
          return Response.json(service.status(), { headers });
        const actions = {
          feed: "search_news",
          library: "get_saved_articles",
          save: "save_article",
          like: "like_article",
          summarize: "summarize_article",
          research: "research_latest",
        };
        const name = actions[body.action];
        if (!name) throw new NewsError("Unknown news action.");
        const args =
          body.args &&
          typeof body.args === "object" &&
          !Array.isArray(body.args)
            ? body.args
            : {};
        return Response.json(await callAppTool(service, name, args), {
          headers,
        });
      }
      const server = createMcpServer(service);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: 16000,
      });
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(request, {
          parsedBody: body,
        });
        // JSON mode fully buffers the protocol response; close request-local SDK resources.
        const bytes = await response.arrayBuffer();
        await server.close();
        return new Response(bytes, {
          status: response.status,
          headers: { ...Object.fromEntries(response.headers), ...headers },
        });
      } catch (error) {
        await server.close();
        throw error;
      }
    } catch (error) {
      return Response.json(
        {
          error: error.status
            ? error.message
            : "News research is temporarily unavailable.",
          code: error.code || "unavailable",
        },
        { status: error.status || 503, headers },
      );
    }
  };
}
