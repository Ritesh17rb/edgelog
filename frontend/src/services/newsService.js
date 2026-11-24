import { db } from "../lib/supabase";
async function invoke(action, args = {}) {
  const { data, error } = await db().functions.invoke("news-mcp/app", {
    body: { action, args },
  });
  if (error) {
    let detail;
    try {
      detail = await error.context?.json();
    } catch {
      /* Network or undeployed function. */
    }
    throw new Error(
      detail?.error ||
        "News is unavailable. Deploy the news-mcp function and complete its server setup, then retry.",
    );
  }
  return data;
}
export const newsService = {
  status: () => invoke("status"),
  feed: (args) => invoke("feed", args),
  library: () => invoke("library"),
  save: (articleId, value) => invoke("save", { articleId, value }),
  like: (articleId, value) => invoke("like", { articleId, value }),
  summarize: (articleId) => invoke("summarize", { articleId }),
  research: (query) => invoke("research", { query }),
};
