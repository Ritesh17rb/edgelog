import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { createHandler } from "./handler.js";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
Deno.serve(
  createHandler({
    admin,
    config: {
      appOrigin: Deno.env.get("APP_ORIGIN"),
      ownerId: Deno.env.get("ZERODHA_OWNER_USER_ID"),
      clientId: Deno.env.get("ZERODHA_CLIENT_ID"),
      apiKey: Deno.env.get("ZERODHA_API_KEY"),
      apiSecret: Deno.env.get("ZERODHA_API_SECRET"),
      redirectUrl: Deno.env.get("ZERODHA_REDIRECT_URL"),
      encryptionKey: Deno.env.get("ZERODHA_TOKEN_ENCRYPTION_KEY"),
    },
  }),
);
