import {
  db,
  currentUser,
  unwrap,
  supabaseUrl,
  supabasePublishableKey,
} from "../lib/supabase";
export const userView = (user) =>
  user
    ? {
        ...user,
        _id: user.id,
        name:
          user.user_metadata?.name ||
          user.user_metadata?.full_name ||
          user.email?.split("@")[0],
      }
    : null;
export default {
  async getMe() {
    return userView(await currentUser());
  },
  async login(email, password) {
    return userView(
      unwrap(await db().auth.signInWithPassword({ email, password })).user,
    );
  },
  async loginWithGoogle() {
    const client = db();
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`,
      {
        headers: { apikey: supabasePublishableKey },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new Error(
        "Google sign-in is unavailable right now. Please try again or sign in with email.",
      );
    const settings = await response.json();
    if (!settings.external?.google)
      throw new Error(
        "Google sign-in isn't available yet. Please sign in with email for now.",
      );
    unwrap(
      await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/login",
          queryParams: { prompt: "select_account" },
        },
      }),
    );
  },
  async register(name, email, password) {
    const data = unwrap(
      await db().auth.signUp({ email, password, options: { data: { name } } }),
    );
    return data.session ? userView(data.user) : null;
  },
  async logout() {
    unwrap(await db().auth.signOut());
  },
  async updateProfile({ name, email, password }) {
    return userView(
      unwrap(
        await db().auth.updateUser({
          email,
          ...(password ? { password } : {}),
          data: { name },
        }),
      ).user,
    );
  },
  async resetPassword(email) {
    unwrap(
      await db().auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/reset-password",
      }),
    );
  },
};
