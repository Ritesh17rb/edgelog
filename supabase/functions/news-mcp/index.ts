import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { createHandler } from "./handler.js";
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
Deno.serve(
  createHandler({
    admin,
    config: {
      appOrigin: Deno.env.get("NEWS_APP_ORIGIN") || Deno.env.get("APP_ORIGIN"),
      newsApiKey: Deno.env.get("THENEWSAPI_API_KEY"),
      openaiKey: Deno.env.get("OPENAI_API_KEY"),
      openaiModel: Deno.env.get("OPENAI_MODEL"),
      newsLimit: Math.min(
        100,
        Math.max(1, Number(Deno.env.get("NEWS_ARTICLES_PER_REQUEST")) || 3),
      ),
    },
  }),
);
