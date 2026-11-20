import { createClient } from "@supabase/supabase-js";
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabasePublishableKey = import.meta.env
  .VITE_SUPABASE_PUBLISHABLE_KEY;
export const isConfigured = Boolean(supabaseUrl && supabasePublishableKey);
export const supabase = isConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null;
export function db() {
  if (!supabase)
    throw new Error("Supabase is not configured. Follow readme.md.");
  return supabase;
}
export async function currentUser() {
  const { data, error } = await db().auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Please sign in again.");
  return data.user;
}
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}
