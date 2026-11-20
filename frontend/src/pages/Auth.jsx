import { useContext, useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { FiArrowRight } from "react-icons/fi";
import { FcGoogle } from "react-icons/fc";
import BrandMark from "../components/BrandMark";
import { AuthContext } from "../context/AuthContext";
import authService from "../services/authService";
import { db, isConfigured } from "../lib/supabase";
import { Field, Notice } from "../components/WorkspaceUI";
export default function Auth({ mode = "login" }) {
  const { login, register, user, loading } = useContext(AuthContext);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [params] = useSearchParams();
  const location = useLocation();
  const [googleBusy, setGoogleBusy] = useState(false);
  const navigate = useNavigate();
  const showGoogle = mode === "login" || mode === "register";
  const hashParams = new URLSearchParams(location.hash.slice(1));
  const callbackError =
    params.get("error_description") ||
    hashParams.get("error_description") ||
    (params.has("error") || hashParams.has("error")
      ? "Google sign-in was cancelled or could not be completed. Please try again."
      : null);
  useEffect(() => {
    if (showGoogle && user && !loading)
      navigate("/dashboard", { replace: true });
  }, [showGoogle, user, loading, navigate]);
  async function continueWithGoogle() {
    if (busy || googleBusy) return;
    setGoogleBusy(true);
    setError("");
    setMessage("");
    try {
      await authService.loginWithGoogle();
    } catch (failure) {
      setError(
        failure.message ||
          "Google sign-in could not be started. Please try again.",
      );
      setGoogleBusy(false);
    }
  }
  const titles = {
    login: "Welcome back.",
    register: "Build your trading journal.",
    forgot: "Reset your password.",
    reset: "Choose a new password.",
  };
  async function submit(e) {
    e.preventDefault();
    if (busy || googleBusy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "login") {
        await login(form.email, form.password);
        navigate("/dashboard");
      }
      if (mode === "register") {
        const result = await register(form.name, form.email, form.password);
        if (result) navigate("/dashboard");
        else
          setMessage("Check your email to confirm your account, then sign in.");
      }
      if (mode === "forgot") {
        await authService.resetPassword(form.email);
        setMessage(
          "If an account exists, a password reset email will arrive shortly.",
        );
      }
      if (mode === "reset") {
        const { error: failure } = await db().auth.updateUser({
          password: form.password,
        });
        if (failure) throw failure;
        setMessage("Password updated. You can return to your workspace.");
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Link className="brand" to="/">
          <span className="brand-icon">
            <BrandMark />
          </span>
          EdgeLog
        </Link>
        <div>
          <p className="eyebrow">TRADE WITH INTENTION</p>
          <h1>
            Your trades.
            <br />
            Your patterns.
            <br />
            <span>Your next chapter.</span>
          </h1>
          <p>
            A private place to record decisions, study your execution, and turn
            experience into insight.
          </p>
        </div>
        <small>PREPARE / EXECUTE / REFLECT</small>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <p className="eyebrow">YOUR PRIVATE WORKSPACE</p>
          <h2>{titles[mode]}</h2>
          <p className="muted">Every session is a chance to learn something.</p>
          {!isConfigured && (
            <Notice error="Setup required: add your Supabase URL and publishable key to frontend/.env.local. See readme.md." />
          )}
          {(error || callbackError) && (
            <Notice error={error || callbackError} />
          )}
          {message && (
            <p className="success" role="status">
              {message}
            </p>
          )}
          {showGoogle && (
            <>
              <button
                className="button google-sign-in"
                type="button"
                onClick={continueWithGoogle}
                disabled={busy || googleBusy || !isConfigured || loading}
                aria-busy={googleBusy}
              >
                <FcGoogle aria-hidden="true" />
                {googleBusy ? "Connecting to Google…" : "Continue with Google"}
              </button>
              <div className="auth-divider">
                <span>or continue with email</span>
              </div>
            </>
          )}
          {mode === "register" && (
            <Field label="Your name">
              <input
                autoComplete="name"
                name="name"
                required
                value={form.name}
                onChange={change}
              />
            </Field>
          )}
          {mode !== "reset" && (
            <Field label="Email address">
              <input
                type="email"
                autoComplete="email"
                name="email"
                required
                value={form.email}
                onChange={change}
              />
            </Field>
          )}
          {mode !== "forgot" && (
            <Field
              label={mode === "reset" ? "New password" : "Password"}
              hint={mode === "register" ? "Use at least 10 characters." : null}
            >
              <input
                type="password"
                name="password"
                required
                minLength={mode === "login" ? 1 : 10}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={form.password}
                onChange={change}
              />
            </Field>
          )}
          <button
            className="button primary"
            disabled={
              busy || googleBusy || !isConfigured || (mode === "reset" && !user)
            }
          >
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : mode === "register"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Update password"}
            <FiArrowRight />
          </button>
          {mode === "reset" && !user && (
            <p className="muted">
              Open the recovery link from your email to set a password.
            </p>
          )}
          {mode === "login" && (
            <Link className="text-link" to="/forgot-password">
              Forgot password?
            </Link>
          )}
          <p className="muted">
            {mode === "login" ? (
              <>
                New here?{" "}
                <Link className="text-link" to="/register">
                  Create an account
                </Link>
              </>
            ) : (
              <Link className="text-link" to="/login">
                Back to sign in
              </Link>
            )}
          </p>
          {mode === "reset" && user && (
            <Link className="text-link" to="/dashboard">
              Return to workspace
            </Link>
          )}
        </form>
      </div>
    </div>
  );
}
