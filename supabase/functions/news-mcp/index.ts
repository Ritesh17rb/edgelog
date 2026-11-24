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
      appOrigin: Deno.env.get("APP_ORIGIN"),
      marketauxKey: Deno.env.get("MARKETAUX_API_KEY"),
      geminiKey: Deno.env.get("GEMINI_API_KEY"),
      geminiModel: Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash-lite",
      newsLimit: Math.min(
        100,
        Math.max(1, Number(Deno.env.get("NEWS_ARTICLES_PER_REQUEST")) || 3),
      ),
    },
  }),
);
