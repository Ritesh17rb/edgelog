# Google sign-in for EdgeLog

The login and registration pages include **Continue with Google**. Supabase handles Google's authorization and the returned session. Successful sign-in opens the dashboard; cancelled sign-in stays on the login page with an error. Email/password sign-in remains available. No new frontend environment variables are needed.

Google is currently disabled in the connected Supabase project. Until enabled, the button explains that email sign-in is available instead.

## Configure the Google provider

1. In [Google Auth Platform](https://console.cloud.google.com/auth/clients), configure your consent screen for EdgeLog and create an OAuth client with the **Web application** type. If the consent screen is in testing, add the Google accounts that will use the app as test users. Choose the audience appropriate to your intended users.
2. Add `https://edgelog-iota-six.vercel.app` to **Authorized JavaScript origins**. For local development, also add the exact origin you use, such as `http://localhost:5173` or `http://127.0.0.1:5173`.
3. In Supabase Dashboard, open **Authentication → Sign In / Providers → Google** and copy the project's callback URL into Google's **Authorized redirect URIs**. It has the form `https://YOUR_PROJECT.supabase.co/auth/v1/callback`. Use the Supabase callback here; the frontend login URL belongs in the Supabase redirect allowlist below.
4. Save the Google **Client ID** and **Client Secret** in Supabase's Google provider settings, enable Google, and save. Keep the client secret in Supabase; never put it in a `VITE_` variable, Git, or chat.
5. In Supabase **Authentication → URL Configuration**, set **Site URL** to `https://edgelog-iota-six.vercel.app`. Add `https://edgelog-iota-six.vercel.app/login` to **Redirect URLs**. Add the corresponding `/login` URLs for any local origins you use. Keep `/reset-password` redirects configured for password recovery.

Use the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Changing these Google provider settings does not require another frontend build.

## Verify

Open the production login page, choose Continue with Google, select an allowed Google account, and confirm you return to the dashboard. Refresh to verify the session persists, sign out, and confirm cancelling Google sign-in leaves the app signed out. Verify the user's private journal and account isolation using separate users. Do not assume existing password accounts and Google accounts will link without checking the project's identity settings.

Automated browser tests cover the Google authorization handoff, successful session return, cancelled login, disabled provider, and provider outages with mocked responses. They do not log in to a real Google account.

Reference: [Supabase's Google sign-in setup](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
