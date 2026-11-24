import { timingSafeEqual } from "node:crypto";

export const config = { maxDuration: 60 };
// An authenticated server-to-server relay. It never receives user sessions or AI keys.
export function createRelay({ token, fetcher = fetch }) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Use POST." });
    }
    const received = Buffer.from(req.headers.authorization || ""),
      expected = Buffer.from("Bearer " + (token || ""));
    if (
      !token ||
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    )
      return res.status(401).json({ error: "Unauthorized." });
    let input = req.body;
    try {
      if (typeof input === "string") input = JSON.parse(input);
    } catch {
      return res.status(400).json({ error: "Invalid request." });
    }
    if (
      !input ||
      typeof input.query !== "string" ||
      input.query.length > 500 ||
      !Number.isInteger(input.hours) ||
      input.hours < 1 ||
      input.hours > 168 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      return res.status(400).json({ error: "Invalid request." });
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    Object.entries({
      query: input.query,
      mode: "ArtList",
      format: "json",
      timespan: input.hours + "h",
      maxrecords: input.limit,
      sort: "DateDesc",
    }).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    try {
      const response = await fetcher(url, {
        headers: {
          "User-Agent":
            "EdgeLog-News/1.0 (+https://edgelog-iota-six.vercel.app)",
        },
        signal: AbortSignal.timeout(35000),
      });
      if (!response.ok)
        return res
          .status(response.status === 429 ? 429 : 502)
          .json({ error: "GDELT is temporarily unavailable." });
      const result = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        (Object.keys(result).length && !Array.isArray(result.articles))
      )
        return res.status(502).json({ error: "Invalid provider response." });
      return res.status(200).json(result);
    } catch {
      return res
        .status(502)
        .json({ error: "GDELT is temporarily unavailable." });
    }
  };
}
export default async function handler(req, res) {
  return createRelay({ token: process.env.NEWS_GDELT_FETCH_TOKEN })(req, res);
}
